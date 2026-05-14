import { redisManager } from '../lib/redis.js'

export type StreamStatus = 'streaming' | 'completed' | 'failed'

export interface StreamMeta {
  status: StreamStatus
  currentSeq: string
  ownerInstance: string
  startedAt: string
}

const metaKey = (chatId: string) => `stream:${chatId}:meta`
const connKey = (chatId: string) => `stream:${chatId}:connections`

export async function createStream(chatId: string, instanceId: string): Promise<void> {
  await redisManager.hset(metaKey(chatId), {
    status: 'streaming',
    currentSeq: '0',
    ownerInstance: instanceId,
    startedAt: String(Date.now()),
  })
  // 60-minute absolute TTL on meta; cleanup job also handles this
  await redisManager.expire(metaKey(chatId), 3600)
}

export async function getStreamMeta(chatId: string): Promise<StreamMeta | null> {
  const data = await redisManager.hgetall(metaKey(chatId))
  if (!data || !data.status) return null
  return data as unknown as StreamMeta
}

export async function updateSequence(chatId: string, seq: number): Promise<void> {
  await redisManager.hset(metaKey(chatId), 'currentSeq', String(seq))
}

export async function setStatus(chatId: string, status: StreamStatus): Promise<void> {
  await redisManager.hset(metaKey(chatId), 'status', status)
}

export async function trackConnection(chatId: string, clientId: string): Promise<void> {
  await redisManager.hset(connKey(chatId), clientId, String(Date.now()))
}

export async function removeConnection(chatId: string, clientId: string): Promise<void> {
  await redisManager.hdel(connKey(chatId), clientId)
}

export async function heartbeat(chatId: string, clientId: string): Promise<void> {
  await redisManager.hset(connKey(chatId), clientId, String(Date.now()))
}

// Returns all stream meta keys older than cutoffMs that are completed
export async function getExpiredStreams(cutoffMs: number): Promise<string[]> {
  const keys = await redisManager.keys('stream:*:meta')
  const expired: string[] = []
  for (const key of keys) {
    const data = await redisManager.hgetall(key)
    if (
      data?.status === 'completed' &&
      data.startedAt &&
      Date.now() - Number(data.startedAt) > cutoffMs
    ) {
      // Extract chatId from key pattern stream:{chatId}:meta
      const chatId = key.slice('stream:'.length, key.length - ':meta'.length)
      expired.push(chatId)
    }
  }
  return expired
}

export async function deleteStream(chatId: string): Promise<void> {
  await redisManager.del(metaKey(chatId), connKey(chatId))
}
