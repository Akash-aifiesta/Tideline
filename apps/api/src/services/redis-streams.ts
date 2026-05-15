import { redisStreamsClient, createReader } from '../lib/redis.js'
import { logger } from '../lib/logger.js'

const streamKey = (chatId: string) => `stream:chunks:${chatId}`

// ── Write ops ────────────────────────────────────────────────────────────────

export async function appendChunk(chatId: string, seq: number, content: string): Promise<void> {
  const t0 = performance.now()
  await redisStreamsClient.xadd(
    streamKey(chatId), '*',
    'seq', String(seq),
    'type', 'token',
    'content', content,
  )
  const xaddMs = Math.round(performance.now() - t0)
  logger.debug({ chatId, seq, xaddMs }, 'xadd')
}

export async function appendDone(chatId: string): Promise<void> {
  await redisStreamsClient.xadd(streamKey(chatId), '*', 'type', 'done')
}

export async function setStreamExpiry(chatId: string, ttlSeconds = 1800): Promise<void> {
  await redisStreamsClient.expire(streamKey(chatId), ttlSeconds)
}

// ── Read ops ─────────────────────────────────────────────────────────────────

export interface StreamEntry {
  id: string
  type: 'token' | 'done' | 'ping'
  seq?: number
  content?: string
}

export interface StreamChunk {
  seq: number
  content: string
}

/** Read all persisted chunks where seq > lastSeq (for replay on /resume). */
export async function readChunksSince(chatId: string, lastSeq: number): Promise<{ chunks: StreamChunk[]; lastId: string }> {
  const entries = await redisStreamsClient.xrange(streamKey(chatId), '-', '+')
  const chunks: StreamChunk[] = []
  let lastId = '0'
  for (const [id, fields] of entries) {
    lastId = id
    const obj = toObject(fields)
    if (obj.type !== 'token') continue
    const seq = Number(obj.seq)
    if (seq > lastSeq) chunks.push({ seq, content: obj.content ?? '' })
  }
  return { chunks, lastId }
}

/** Check whether a 'done' entry exists in the stream. */
export async function isStreamDone(chatId: string): Promise<boolean> {
  const entries = await redisStreamsClient.xrange(streamKey(chatId), '-', '+')
  return entries.some(([, fields]: [string, string[]]) => toObject(fields).type === 'done')
}

/**
 * Async generator that yields live entries from a Redis Stream via XREAD BLOCK.
 *
 * fromId = '0'  → read from the very beginning (catches any tokens written before
 *                  the SSE handler started — no race condition vs Pub/Sub).
 * fromId = <id> → read only entries appended after that stream ID (used post-replay).
 *
 * Uses BLOCK 15000 (15s timeout) so a timeout naturally triggers a heartbeat ping
 * without needing a separate setInterval. The caller receives { type: 'ping' } on
 * timeout and can forward it as an SSE ping event.
 *
 * Abort: call signal.abort() → the onabort handler disconnects the reader client,
 * which rejects the pending xread call; the catch block exits cleanly.
 */
export async function* readStreamLive(
  chatId: string,
  fromId: string,
  signal: AbortSignal,
): AsyncGenerator<StreamEntry> {
  const reader = createReader()

  signal.addEventListener('abort', () => {
    reader.disconnect()
  }, { once: true })

  let lastId = fromId
  try {
    while (!signal.aborted) {
      let result: [string, [string, string[]][]][] | null
      const xreadT0 = performance.now()
      try {
        // Cast needed because ioredis types for xread with BLOCK are loosely typed
        result = (await reader.xread(
          'BLOCK', '15000',
          'STREAMS', streamKey(chatId), lastId,
        )) as [string, [string, string[]][]][] | null
      } catch {
        // reader.disconnect() rejects the call when signal aborts
        break
      }

      const xreadMs = Math.round(performance.now() - xreadT0)
      if (!result) {
        // BLOCK timeout — emit heartbeat ping so SSE connection stays alive
        logger.debug({ chatId, xreadMs, outcome: 'timeout' }, 'xread block')
        yield { id: lastId, type: 'ping' }
        continue
      }

      const [, entries] = result[0]
      logger.debug({ chatId, xreadMs, entries: entries.length, outcome: 'entries' }, 'xread block')
      for (const [id, fields] of entries) {
        lastId = id
        const obj = toObject(fields)
        const entry: StreamEntry = {
          id,
          type: obj.type as StreamEntry['type'],
          seq: obj.seq ? Number(obj.seq) : undefined,
          content: obj.content,
        }
        yield entry
        if (entry.type === 'done') return
      }
    }
  } finally {
    reader.disconnect()
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toObject(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {}
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1]
  return obj
}
