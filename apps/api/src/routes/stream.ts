import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { v4 as uuid } from 'uuid'
import { logger } from '../lib/logger.js'
import { generateTokens } from '../lib/token-generator.js'
import { appendChunk, appendDone, setStreamExpiry, readStreamLive } from '../services/redis-streams.js'
import { createStream, updateSequence, setStatus, trackConnection, removeConnection } from '../services/stream-manager.js'

const INSTANCE_ID = process.env.RAILWAY_REPLICA_ID ?? process.env.INSTANCE_ID ?? 'local'

/**
 * Fire-and-forget generation loop.
 * Runs independently of the SSE connection — client disconnect does NOT stop it.
 * Each token is XADDed to Redis Streams; the SSE handler picks it up via XREAD BLOCK.
 */
async function startGeneration(chatId: string, message: string): Promise<void> {
  let seq = 0
  const t0 = performance.now()
  try {
    for await (const token of generateTokens(message)) {
      seq++
      await appendChunk(chatId, seq, token)
      await updateSequence(chatId, seq)
      logger.debug({ chatId, seq, instance: INSTANCE_ID }, 'chunk written')
    }
    const genMs = Math.round(performance.now() - t0)
    await appendDone(chatId)
    await setStreamExpiry(chatId)
    await setStatus(chatId, 'completed')
    logger.info({ chatId, totalTokens: seq, genMs, tokensPerSec: Math.round(seq / (genMs / 1000)) }, 'generation complete')
  } catch (err) {
    logger.error({ chatId, err }, 'generation failed')
    await setStatus(chatId, 'failed').catch(() => {})
  }
}

export const streamRoute = new Hono()

streamRoute.post('/', async (c) => {
  const requestId = c.req.header('x-request-id') ?? uuid()
  let body: { chatId?: string; message?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const message = body.message?.trim()
  if (!message) return c.json({ error: 'message is required' }, 400)

  const chatId = body.chatId ?? uuid()
  const clientId = uuid()

  logger.info({ requestId, chatId, clientId, instance: INSTANCE_ID }, 'POST /stream')

  const requestT0 = performance.now()
  await createStream(chatId, INSTANCE_ID)
  await trackConnection(chatId, clientId)

  // Start generation as a background task — NOT awaited.
  // It continues running even after this SSE response closes.
  startGeneration(chatId, message).catch(() => {})

  return streamSSE(c, async (stream) => {
    const ac = new AbortController()
    let firstTokenMs: number | null = null
    let tokensDelivered = 0

    stream.onAbort(() => {
      const lifetimeMs = Math.round(performance.now() - requestT0)
      logger.info({ chatId, clientId, tokensDelivered, lifetimeMs }, 'SSE client disconnected (generation continues)')
      ac.abort()
      removeConnection(chatId, clientId).catch(() => {})
    })

    // Send chatId first so the client can persist it before tokens arrive
    await stream.writeSSE({ event: 'start', data: JSON.stringify({ chatId }) })

    // XREAD BLOCK from '0' — reads ALL entries including any written before this
    // handler started (no Pub/Sub race condition). Heartbeat pings arrive on timeout.
    for await (const entry of readStreamLive(chatId, '0', ac.signal)) {
      if (entry.type === 'ping') {
        await stream.writeSSE({ event: 'ping', data: '{}' })
        continue
      }
      if (entry.type === 'done') {
        await stream.writeSSE({ event: 'done', data: '{}' })
        break
      }
      if (firstTokenMs === null) {
        firstTokenMs = Math.round(performance.now() - requestT0)
        logger.info({ chatId, clientId, firstTokenMs }, 'time-to-first-token')
      }
      tokensDelivered++
      await stream.writeSSE({
        event: 'token',
        data: JSON.stringify({ seq: entry.seq, content: entry.content }),
      })
    }

    const lifetimeMs = Math.round(performance.now() - requestT0)
    logger.info({ chatId, clientId, tokensDelivered, lifetimeMs, firstTokenMs }, 'SSE stream closed')
    removeConnection(chatId, clientId).catch(() => {})
  })
})
