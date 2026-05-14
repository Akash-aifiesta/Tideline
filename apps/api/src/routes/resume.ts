import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { v4 as uuid } from 'uuid'
import { logger } from '../lib/logger.js'
import { readChunksSince, readStreamLive } from '../services/redis-streams.js'
import { getStreamMeta, trackConnection, removeConnection } from '../services/stream-manager.js'

const INSTANCE_ID = process.env.RAILWAY_REPLICA_ID ?? process.env.INSTANCE_ID ?? 'local'

export const resumeRoute = new Hono()

resumeRoute.post('/', async (c) => {
  const requestId = c.req.header('x-request-id') ?? uuid()
  let body: { chatId?: string; lastSequence?: number }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const { chatId, lastSequence } = body
  if (!chatId) return c.json({ error: 'chatId is required' }, 400)
  if (lastSequence == null || typeof lastSequence !== 'number') {
    return c.json({ error: 'lastSequence is required' }, 400)
  }

  const meta = await getStreamMeta(chatId)
  if (!meta) return c.json({ error: 'stream not found' }, 404)

  const clientId = uuid()
  logger.info({ requestId, chatId, clientId, lastSequence, instance: INSTANCE_ID }, 'POST /resume')

  await trackConnection(chatId, clientId)

  return streamSSE(c, async (stream) => {
    const ac = new AbortController()

    stream.onAbort(() => {
      logger.info({ chatId, clientId }, 'SSE client disconnected on resume')
      ac.abort()
      removeConnection(chatId, clientId).catch(() => {})
    })

    // ── Phase 1: replay missed chunks via XRANGE ──────────────────────────
    // XRANGE is a snapshot read — safe to do without holding a blocking connection.
    const { chunks, lastId } = await readChunksSince(chatId, lastSequence)
    let replayCount = 0
    for (const chunk of chunks) {
      await stream.writeSSE({
        event: 'token',
        data: JSON.stringify({ seq: chunk.seq, content: chunk.content }),
      })
      replayCount++
    }
    await stream.writeSSE({ event: 'replay_complete', data: '{}' })
    logger.info({ chatId, replayCount, fromSeq: lastSequence }, 'replay complete')

    // ── Phase 2: live continuation via XREAD BLOCK ────────────────────────
    // If stream already finished, XRANGE will have included the 'done' entry.
    // In that case meta.status is 'completed' by the time we check.
    if (meta.status === 'completed') {
      await stream.writeSSE({ event: 'done', data: '{}' })
      removeConnection(chatId, clientId).catch(() => {})
      return
    }

    // Resume from the last XRANGE entry ID (or '0' if nothing was in the stream yet).
    // XREAD BLOCK will deliver any entries appended AFTER lastId.
    const liveFromId = lastId !== '0' ? lastId : '0'

    for await (const entry of readStreamLive(chatId, liveFromId, ac.signal)) {
      if (entry.type === 'ping') {
        await stream.writeSSE({ event: 'ping', data: '{}' })
        continue
      }
      if (entry.type === 'done') {
        await stream.writeSSE({ event: 'done', data: '{}' })
        break
      }
      await stream.writeSSE({
        event: 'token',
        data: JSON.stringify({ seq: entry.seq, content: entry.content }),
      })
    }

    removeConnection(chatId, clientId).catch(() => {})
  })
})
