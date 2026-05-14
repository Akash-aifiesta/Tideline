import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { v4 as uuid } from 'uuid'
import { connectAll } from './lib/redis.js'
import { logger } from './lib/logger.js'
import { streamRoute } from './routes/stream.js'
import { resumeRoute } from './routes/resume.js'
import { getExpiredStreams, deleteStream } from './services/stream-manager.js'

const INSTANCE_ID = process.env.RAILWAY_REPLICA_ID ?? process.env.INSTANCE_ID ?? 'local'
const PORT = Number(process.env.PORT ?? 3001)
const CLEANUP_INTERVAL_MS = 60_000       // run every 60 s
const STREAM_EXPIRY_MS = 30 * 60 * 1000 // 30 minutes

const app = new Hono()

app.use('*', cors({ origin: process.env.CORS_ORIGIN ?? '*' }))
app.use('*', honoLogger())

// Inject a request ID so logs can be correlated
app.use('*', async (c, next) => {
  c.req.raw.headers
  const id = c.req.header('x-request-id') ?? uuid()
  c.res.headers.set('x-request-id', id)
  await next()
})

app.get('/health', (c) =>
  c.json({ status: 'ok', instance: INSTANCE_ID, ts: Date.now() }),
)

app.route('/stream', streamRoute)
app.route('/resume', resumeRoute)

// ── Background cleanup ──────────────────────────────────────────────────────
function startCleanup(): void {
  setInterval(async () => {
    try {
      const expired = await getExpiredStreams(STREAM_EXPIRY_MS)
      for (const chatId of expired) {
        await deleteStream(chatId)
        logger.info({ chatId }, 'cleaned up expired stream')
      }
    } catch (err) {
      logger.error({ err }, 'cleanup error')
    }
  }, CLEANUP_INTERVAL_MS)
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await connectAll()
  startCleanup()
  serve({ fetch: app.fetch, port: PORT }, () => {
    logger.info({ port: PORT, instance: INSTANCE_ID }, 'API server started')
  })
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error')
  process.exit(1)
})
