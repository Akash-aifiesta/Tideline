export type ConnectionState =
  | 'idle'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'replaying'
  | 'resumed'
  | 'completed'
  | 'error'

export interface ChatStore {
  chatId: string | null
  lastSeq: number
  userMessage: string | null
  tokens: string[]
  connectionState: ConnectionState
  errorMessage: string | null
}

// ── URL + localStorage persistence ───────────────────────────────────────
// URL:           ?chat=<chatId>&seq=<lastSeq>   (shareable / bookmarkable)
// localStorage:  userMessage                    (survives reload, not in URL)

const MSG_KEY = 'rsc:msg'

export function loadStore(): ChatStore {
  const params = new URLSearchParams(window.location.search)
  const chatId = params.get('chat') ?? null
  const lastSeq = Number(params.get('seq') ?? '0')
  const userMessage = chatId
    ? (localStorage.getItem(MSG_KEY) ?? null)
    : null
  return { chatId, lastSeq, userMessage, tokens: [], connectionState: 'idle', errorMessage: null }
}

export function saveStore(store: ChatStore): void {
  const params = new URLSearchParams(window.location.search)
  if (store.chatId) {
    params.set('chat', store.chatId)
    params.set('seq', String(store.lastSeq))
    if (store.userMessage) localStorage.setItem(MSG_KEY, store.userMessage)
  } else {
    params.delete('chat')
    params.delete('seq')
    localStorage.removeItem(MSG_KEY)
  }
  const newUrl = `${window.location.pathname}${params.size ? '?' + params.toString() : ''}`
  window.history.replaceState(null, '', newUrl)
}

export function clearStore(): void {
  localStorage.removeItem(MSG_KEY)
  window.history.replaceState(null, '', window.location.pathname)
}
