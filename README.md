# Tideline — Resumable Streaming Chat

A production-grade, distributed streaming infrastructure for LLM token delivery. Clients can disconnect and reconnect at any point without losing tokens — generation runs independently of client connections, and all tokens are replayed from Redis Streams on reconnect.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [How It Works](#how-it-works)
- [API Reference](#api-reference)
- [Redis Design](#redis-design)
- [Failure Modes & Recovery](#failure-modes--recovery)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [Design Decisions & Improvements](#design-decisions--improvements)

---

## Architecture Overview

```
                        ┌──────────────────────────────────────────┐
                        │              Client (Browser)            │
                        └──────────┬────────────────┬─────────────┘
                                   │ POST /stream    │ POST /resume
                                   ▼                 ▼
                        ┌──────────────────────────────────────────┐
                        │           Nginx (Load Balancer)          │
                        │         Round-robin · Port 80            │
                        └──────────────┬───────────────────────────┘
                                       │
                   ┌───────────────────┼───────────────────┐
                   ▼                                       ▼
        ┌──────────────────┐                   ┌──────────────────┐
        │      api-1       │                   │      api-2       │
        │   Hono (Node 22) │                   │   Hono (Node 22) │
        │   Port 3001      │                   │   Port 3001      │
        └────────┬─────────┘                   └────────┬─────────┘
                 │                                      │
        ┌────────▼──────────────────────────────────────▼────────┐
        │                      Redis                              │
        │                                                         │
        │   redis-manager (6379)      redis-streams (6380)        │
        │   ─────────────────────     ─────────────────────────   │
        │   stream:{id}:meta          stream:chunks:{id}          │
        │   stream:{id}:connections   (Redis Stream / XADD)       │
        └─────────────────────────────────────────────────────────┘
```

**Key principle:** API servers are fully stateless. All stream state lives in Redis. Any instance can serve any request.

---

## How It Works

### Starting a stream (`POST /stream`)

1. Client sends a message and an optional `chatId`.
2. Server creates stream metadata in Redis Manager and begins writing tokens to a Redis Stream via `XADD`.
3. Token generation runs **fire-and-forget** — it is completely decoupled from the SSE connection.
4. Server opens an SSE response and reads tokens live using `XREAD BLOCK`.
5. Every 15 seconds of silence, `XREAD BLOCK` times out and the server emits a `ping` to keep the connection alive.

### Reconnecting (`POST /resume`)

When a client disconnects and reconnects, it sends the last sequence number it received:

1. **Phase 1 — Replay:** Server calls `XRANGE` to fetch all chunks where `seq > lastSequence`. These are emitted immediately as `token` events, followed by a `replay_complete` event.
2. **Phase 2 — Live:** If the stream is still running, server switches to `XREAD BLOCK` from the last replayed position and continues delivering new tokens in real time.

Because token generation never stops on disconnect, there are no gaps — the replay always fills the exact window the client missed.

### SSE Event Stream

```
event: start
data: {"chatId":"abc123"}

event: token
data: {"seq":1,"content":"Hello"}

event: token
data: {"seq":2,"content":" world"}

event: ping
data: {}

event: replay_complete
data: {}

event: done
data: {}
```

---

## API Reference

### `GET /health`

```json
{ "status": "ok", "instance": "api-1", "ts": 1716000000000 }
```

### `POST /stream`

**Request:**
```json
{
  "chatId": "optional-uuid",
  "message": "Explain distributed systems"
}
```

**Response:** `text/event-stream` — emits `start`, `token`, `ping`, `done`

### `POST /resume`

**Request:**
```json
{
  "chatId": "abc123",
  "lastSequence": 24
}
```

**Response:** `text/event-stream` — emits `token` (replay), `replay_complete`, `token` (live), `ping`, `done`

---

## Redis Design

### Two Redis instances

| Instance | Port | Purpose | Key patterns |
|----------|------|---------|-------------|
| redis-manager | 6379 | Stream metadata & connection tracking | `stream:{id}:meta`, `stream:{id}:connections` |
| redis-streams | 6380 | Append-only token log | `stream:chunks:{id}` |

Separating concerns means high-throughput stream writes don't contend with metadata lookups. In production on Railway's free tier both point to the same Redis URL — namespacing via key prefixes provides isolation.

### redis-manager keys

**`stream:{chatId}:meta`** (Hash, 60-min TTL)
```
status         streaming | completed | failed
currentSeq     42
ownerInstance  api-1
startedAt      1716000000000
```

**`stream:{chatId}:connections`** (Hash, 60-min TTL)
```
{clientId}     {timestamp}
```

### redis-streams keys

**`stream:chunks:{chatId}`** (Redis Stream, 30-min TTL)

Each entry:
```
id      1716000000000-0   (auto-generated by Redis)
seq     42
type    token | done
content "Hello"
```

The `done` sentinel is written as the last entry. The reader generator yields entries until it sees `type: done` or the AbortSignal fires.

### Why Redis Streams (`XADD` / `XRANGE` / `XREAD BLOCK`)

- **Append-only**: tokens are never overwritten, replay is always accurate.
- **XRANGE**: O(N) range scan for replay — no client-side filtering needed.
- **XREAD BLOCK**: blocks until new data arrives, eliminating polling. The 15-second block timeout doubles as a heartbeat mechanism — no `setInterval` required.
- **Separate entry IDs and sequence numbers**: Redis IDs handle ordering; the `seq` field is the application-level counter the client tracks and sends on resume.

---

## Failure Modes & Recovery

| Failure | Impact | Recovery |
|--------|--------|---------|
| Client disconnects | SSE closes | `/resume` with `lastSequence` replays missed tokens |
| API instance crashes | In-flight SSE drops | Load balancer routes next request to healthy instance; all state is in Redis |
| Network outage | SSE drops | Same as client disconnect |
| Redis connection loss | ioredis retries (up to 3) | Auto-reconnect; `lazyConnect` prevents server crash on startup |
| Token generator panics | Stream stuck at `streaming` | Background cleanup marks expired streams and deletes metadata after 30 min |

---

## Local Development

### Prerequisites

- Node.js 22+
- pnpm
- Docker + Docker Compose

### Run everything with Docker

```bash
docker compose up --build
```

This starts:
- `redis-manager` on port 6379
- `redis-streams` on port 6380
- `api-1` on port 3001
- `api-2` on port 3002
- `nginx-glb` on port 80 (load balances to both API instances)

### Run API only (against local Redis)

```bash
pnpm install
pnpm --filter api dev
```

### Run Redis only

```bash
pnpm docker:redis
```

### Build

```bash
pnpm --filter api build   # Compiles TypeScript → dist/
pnpm --filter api start   # Runs compiled output
```

### Test a stream manually

```bash
# Start stream
curl -N -X POST http://localhost/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello world"}' | head -20

# Resume (replace chatId and lastSequence)
curl -N -X POST http://localhost/resume \
  -H "Content-Type: application/json" \
  -d '{"chatId":"abc123","lastSequence":5}'
```

---

## Deployment

Configured for [Railway.app](https://railway.app) via `railway.toml`.

```toml
[build]
  dockerfilePath = "apps/api/Dockerfile"

[deploy]
  healthcheckPath = "/health"
  healthcheckTimeout = 10
  restartPolicyType = "ON_FAILURE"
```

Railway injects `PORT` automatically. The server listens on `process.env.PORT` with a fallback to `3000`. The instance ID falls back to `RAILWAY_REPLICA_ID` when `INSTANCE_ID` is not set.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port (Railway auto-injects) |
| `INSTANCE_ID` | `RAILWAY_REPLICA_ID` | Identifies the server instance in logs and metadata |
| `REDIS_URL` | — | Single Redis URL (used when both manager and streams share one instance) |
| `REDIS_MANAGER_URL` | `redis://localhost:6379` | Metadata Redis |
| `REDIS_STREAMS_URL` | `redis://localhost:6380` | Streams Redis |
| `NODE_ENV` | `development` | `production` switches logging to JSON |
| `LOG_LEVEL` | `info` | Pino log level |

---

## Design Decisions & Improvements

### vs. a naive WebSocket implementation

A naive streaming approach buffers tokens in server memory. If the server restarts or the client disconnects, everything is lost. This system externalizes all state to Redis, so:
- Any server instance can resume any stream.
- Tokens survive server restarts.
- Horizontal scaling works without sticky sessions.

### vs. polling

Polling requires the client to repeatedly call the server and the server to re-query Redis on each poll. `XREAD BLOCK` holds a single open connection and delivers tokens the moment they arrive — lower latency, lower server load, and no thundering herd on reconnect.

### SSE over WebSockets

SSE is unidirectional (server → client), HTTP/1.1 compatible, and automatically reconnects at the transport layer. Since chat generation is unidirectional by nature, the additional complexity of WebSockets (bidirectional framing, ping/pong management, separate upgrade handshake) is unnecessary.

### Fire-and-forget generation

Token generation is kicked off in a `Promise` that is intentionally not `await`ed inside the route handler. The route handler returns the SSE stream immediately. Generation and delivery are fully decoupled — the generator writes to Redis regardless of whether any client is connected. This is what makes resumability possible with no extra coordination logic.

### Heartbeat via `XREAD BLOCK` timeout

Rather than setting up a `setInterval` to emit pings, the server simply sets a 15-second block timeout on `XREAD`. When no new tokens arrive within that window, the block returns an empty result, and the server emits a `ping` event. One mechanism handles both "wait for data" and "keep the connection alive."

### Background cleanup

A job runs every 60 seconds and removes metadata for streams that have been in `completed` state for more than 30 minutes. This prevents Redis memory from growing unboundedly in long-running deployments without requiring a separate worker process.

### Dual Redis instances (local) / shared Redis (production)

Locally, two separate Redis containers isolate metadata operations from high-throughput stream appends. In production on Railway's free tier, both `REDIS_MANAGER_URL` and `REDIS_STREAMS_URL` can point to the same instance — key prefixes (`stream:{id}:meta` vs `stream:chunks:{id}`) provide logical isolation without needing two paid services.
