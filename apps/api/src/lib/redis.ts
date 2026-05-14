import { Redis } from 'ioredis'
import { logger } from './logger.js'

// Single REDIS_URL is used when deploying to Railway (one instance).
// Separate URLs are used locally or when running two dedicated instances.
const REDIS_URL =
  process.env.REDIS_URL ??
  process.env.REDIS_MANAGER_URL ??
  'redis://localhost:6379'

const STREAMS_URL =
  process.env.REDIS_URL ??
  process.env.REDIS_STREAMS_URL ??
  'redis://localhost:6380'

function createClient(url: string, name: string): Redis {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })
  client.on('connect', () => logger.info({ redis: name }, 'Redis connected'))
  client.on('error', (err: unknown) => logger.error({ redis: name, err }, 'Redis error'))
  return client
}

// Both point to the same instance when REDIS_URL is set (Railway free tier).
// Key prefixes keep the logical separation:
//   stream:{chatId}:meta        → connection manager
//   stream:{chatId}:connections → connection tracking
//   stream:chunks:{chatId}      → Redis Streams replay buffer
export const redisManager = createClient(REDIS_URL, 'manager')
export const redisStreamsClient = createClient(STREAMS_URL, 'streams')

// Blocking XREAD needs its own dedicated connection — calling disconnect()
// on it cancels an in-flight BLOCK when the SSE client disconnects.
export function createReader(): Redis {
  return new Redis(STREAMS_URL, { lazyConnect: false, maxRetriesPerRequest: null })
}

export async function connectAll(): Promise<void> {
  const targets = REDIS_URL === STREAMS_URL
    ? [redisManager]          // same instance — only connect once
    : [redisManager, redisStreamsClient]
  await Promise.all(targets.map((c) => c.connect()))
}
