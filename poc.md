# Task Ticket: Implement Resumable Streaming Chat System Using GLB + Redis Streams

## Objective

Build a resumable streaming chat infrastructure using:

* Global Load Balancer (GLB) for proxying and traffic distribution
* Stateless API servers for SSE streaming
* Redis Instance #1 as connection/session manager
* Redis Instance #2 using Redis Streams for chunk persistence + replay
* SSE (Server-Sent Events) for streaming transport
* Automatic client reconnect + stream resume support

The system must support:

* live streaming
* disconnect recovery
* replaying missed chunks
* reconnecting to active streams
* distributed horizontal scaling
* multi-instance stateless servers

---

# High-Level Architecture

```txt id="o7k3ze"
Client
  ↓
GLB / Reverse Proxy
  ↓
Stateless API Server Pool
  ↓
Redis #1 (Connection Manager)
  ↓
Redis #2 (Redis Streams)
```

---

# Core Concept

This architecture replaces Durable Objects with Redis-based coordination.

## Redis Responsibilities

### Redis Instance #1 — Connection Manager

Stores:

* active stream ownership
* stream metadata
* client connection state
* heartbeat timestamps
* stream lifecycle state

### Redis Instance #2 — Redis Streams

Stores:

* ordered stream chunks
* replay buffer
* append-only stream events
* stream completion markers

---

# Architecture Rules

## CRITICAL RULE

Streaming state MUST NOT live in server memory alone.

All authoritative stream state MUST exist in Redis.

This ensures:

* reconnect works across instances
* horizontal scaling works
* failover works
* replay survives server crashes

---

# Streaming Lifecycle

## Start Stream

```txt id="v2m4yr"
Client
  ↓
POST /stream
  ↓
API Server
  ↓
Create stream metadata in Redis #1
  ↓
Append chunks into Redis Streams
  ↓
SSE stream to client
```

---

# Disconnect Flow

If client disconnects:

```txt id="v5u0nc"
Client disconnected
  ↓
Server continues generation
  ↓
Chunks continue appending to Redis Stream
  ↓
Connection state updated in Redis #1
```

Generation MUST continue after disconnect.

---

# Resume Flow

```txt id="tr2fwp"
Client reconnects
  ↓
POST /resume
  ↓
Server reads Redis Stream
  ↓
Replay missing chunks
  ↓
Attach client to live stream
```

---

# API Contracts

# 1. POST /stream

Starts a new streaming session.

## Request

```json id="yr9qjv"
{
  "chatId": "optional-id",
  "message": "Explain distributed systems"
}
```

---

## Response

SSE stream.

Headers:

```txt id="0j5e6t"
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

---

## Example Events

```txt id="xz3v0f"
event: token
data: {"seq":1,"content":"Distributed"}

event: token
data: {"seq":2,"content":"systems"}
```

---

# 2. POST /resume

Reconnects to interrupted stream.

## Request

```json id="gg7q5v"
{
  "chatId": "abc123",
  "lastSequence": 24
}
```

---

## Resume Behavior

Server MUST:

1. replay all missing chunks
2. reconnect client to active stream
3. continue streaming live chunks

---

# Streaming Protocol

Use SSE only.

---

# Required SSE Events

## token

```txt id="0h9qtw"
event: token
data: {"seq":12,"content":"hello"}
```

---

## replay_complete

```txt id="3v0e2n"
event: replay_complete
data: {}
```

---

## done

```txt id="a1q4pz"
event: done
data: {}
```

---

## ping

Heartbeat every 15s.

```txt id="k6v5bo"
event: ping
data: {}
```

---

# Redis Design

# Redis Instance #1 — Connection Manager

## Purpose

Tracks:

* stream ownership
* active stream status
* reconnect state
* connected clients
* heartbeats

---

# Suggested Keys

## Stream Metadata

```txt id="q4h5ne"
stream:{chatId}:meta
```

Example:

```json id="2r7fmu"
{
  "status": "streaming",
  "currentSequence": 58,
  "ownerInstance": "api-node-2",
  "startedAt": 1710000000
}
```

---

## Active Connection

```txt id="x9k7td"
stream:{chatId}:connections
```

Stores:

* client IDs
* last heartbeat
* reconnect timestamps

---

# Redis Instance #2 — Redis Streams

## Purpose

Acts as:

* append-only replay log
* chunk persistence layer
* resumable event stream

---

# Redis Stream Naming

```txt id="2h0z4q"
stream:chunks:{chatId}
```

---

# Redis Stream Event Shape

Use `XADD`.

Example:

```txt id="o8j4qe"
XADD stream:chunks:abc123 * 
  seq 58
  type token
  content "hello"
```

---

# Completion Event

```txt id="1n5yok"
XADD stream:chunks:abc123 *
  type done
```

---

# Replay Logic

## On Resume

Given:

```json id="0l7kzr"
{
  "chatId": "abc123",
  "lastSequence": 50
}
```

Server MUST:

1. read Redis Stream
2. fetch all chunks where `seq > 50`
3. replay chunks
4. subscribe to live stream updates
5. continue streaming

---

# Live Stream Fanout

Recommended approach:

## Option A — Redis Pub/Sub (Recommended)

Use Pub/Sub for:

* real-time fanout
* notifying live subscribers

Redis Streams remain authoritative replay storage.

---

# Suggested Live Flow

```txt id="z3u1it"
Chunk generated
  ↓
XADD to Redis Stream
  ↓
PUBLISH live event
  ↓
Connected clients receive instantly
```

---

# Stream Generation Rules

## IMPORTANT

Generation MUST continue after disconnect.

Client connection lifecycle MUST NOT control generation lifecycle.

---

# Simulated Stream Engine

Implement simulated token generation.

Example:

```ts id="gx6t8p"
tokens = ["Hello", "this", "is", "a", "stream"]
```

Emit:

* 1 token every 50–150ms
* strictly ordered sequence numbers

---

# Client Requirements

Implement browser client demonstrating:

* live streaming
* reconnect handling
* replay support
* seamless resume

---

# Client State

Client MUST persist:

* `chatId`
* `lastSequenceReceived`

Use:

* memory
* localStorage fallback

---

# Reconnect Logic

On:

* SSE disconnect
* tab sleep/wake
* temporary network outage

Client MUST:

1. detect interruption
2. call `/resume`
3. provide `lastSequence`
4. replay missing chunks
5. continue live stream

---

# Client UI Requirements

## Chat Window

Incrementally render streamed chunks.

---

## Connection State

Show:

* connected
* reconnecting
* replaying
* resumed
* completed

---

## Replay Indicator

Optional replay status UI.

---

# Horizontal Scaling Requirements

System MUST support:

* multiple API instances
* reconnect landing on different server
* stateless server scaling

No sticky sessions allowed.

---

# Failure Handling

## API Server Crash

Reconnect MUST still work because:

* chunks persisted in Redis Streams
* metadata persisted in Redis

---

## Client Disconnect

Generation MUST continue.

---

## Redis Stream Persistence

Replay MUST survive:

* server restart
* reconnect
* temporary network failure

---

# Stream Retention Rules

| State           | Retention             |
| --------------- | --------------------- |
| Active stream   | live                  |
| Replay buffer   | 30 mins               |
| Archived stream | optional              |
| Expired stream  | cleanup automatically |

---

# Cleanup Requirements

Implement background cleanup for:

* expired streams
* stale connections
* completed sessions

---

# Reliability Requirements

## Ordering

Sequence numbers MUST be strictly increasing.

---

## Deduplication

Client MUST dedupe using:

```txt id="61h4sd"
seq
```

---

## Heartbeats

Emit `ping` every 15 seconds.

---

# Observability

Implement:

* structured logs
* request IDs
* reconnect metrics
* replay metrics
* stream duration metrics
* active stream metrics

---

# Suggested File Structure

```txt id="s0r8el"
/apps
  /api
    routes/
      stream.ts
      resume.ts

    services/
      stream-manager.ts
      replay-service.ts
      redis-streams.ts
      pubsub.ts

    lib/
      sse.ts
      redis.ts

  /client
    src/
      components/
      hooks/
      services/
      state/
```

---

# Technical Requirements

## Backend

* TypeScript
* Node.js
* Express/Fastify/Hono
* Redis
* Redis Streams
* SSE

---

## Client

* React or Next.js
* EventSource OR fetch streaming

---

# Acceptance Criteria

## Streaming

* ordered chunk delivery works

## Resume

* missed chunks replay correctly

## Live Continuation

* resumed client rejoins active stream

## Horizontal Scaling

* reconnect works across instances

## Reliability

* reconnect survives server restart

## UX

* reconnect appears seamless

## Ordering

* no duplicated chunks
* no ordering violations

---

# Deliverables

## Backend

* SSE streaming APIs
* Redis Streams integration
* reconnect/replay engine
* live pub/sub fanout
* stream coordinator

---

## Client

* chat UI
* reconnect handling
* replay support
* sequence tracking

---

## Documentation

* architecture notes
* reconnect flow
* local development setup
* Redis setup
* deployment instructions

---

# Stretch Goals (Optional)

* WebSocket transport
* Kafka replacement for Redis Streams
* multi-device resume
* stream cancellation API
* persistent transcript storage
* provider-backed LLM streaming
* adaptive retry strategy

---

# IMPORTANT IMPLEMENTATION NOTES

## Redis Streams Are The Source Of Truth

Replay MUST always come from Redis Streams.

Server memory is only a temporary optimization layer.

---

# IMPORTANT

## No Sticky Sessions

The system MUST work even if:

* `/stream` hits server A
* `/resume` hits server B

This is mandatory.

---

# Expected End-to-End Flow

```txt id="s4z8xo"
1. Client calls /stream
2. Server begins token generation
3. Chunks appended to Redis Stream
4. Client receives seq 1..50
5. Network disconnect occurs
6. Generation continues
7. Redis Stream stores seq 51..80
8. Client reconnects using /resume(lastSequence=50)
9. Missing chunks replayed
10. Client rejoins live stream
11. Stream completes
```
