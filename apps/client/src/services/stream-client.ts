export interface SseEvent {
  event: string
  data: string
}

/**
 * Parse a Server-Sent Events stream from a fetch ReadableStream.
 * EventSource only supports GET; since our endpoints are POST we use fetch directly.
 */
export async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  signal.addEventListener('abort', () => reader.cancel(), { once: true })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      let currentEvent = 'message'
      let currentData = ''

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trim()
        } else if (line.startsWith('data:')) {
          currentData = line.slice('data:'.length).trim()
        } else if (line === '') {
          // blank line — dispatch the event
          if (currentData !== '') {
            onEvent({ event: currentEvent, data: currentData })
          }
          currentEvent = 'message'
          currentData = ''
        }
      }
    }
  } catch (err) {
    if (!signal.aborted) throw err
  } finally {
    reader.cancel().catch(() => {})
  }
}

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export async function postStream(
  message: string,
  chatId: string | null,
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...(chatId ? { chatId } : {}) }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`/stream ${res.status}`)
  await parseSseStream(res.body, onEvent, signal)
}

export async function postResume(
  chatId: string,
  lastSequence: number,
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, lastSequence }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`/resume ${res.status}`)
  await parseSseStream(res.body, onEvent, signal)
}
