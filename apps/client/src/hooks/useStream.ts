import { useCallback, useEffect, useRef, useState } from 'react'
import { type ChatStore, type ConnectionState, loadStore, saveStore, clearStore } from '../state/chat-store.js'
import { postStream, postResume, type SseEvent } from '../services/stream-client.js'

const MAX_RETRIES = 10
const BASE_DELAY_MS = 500

function backoff(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, 30_000)
}

export function useStream() {
  const [store, setStore] = useState<ChatStore>(() => loadStore())
  const abortRef = useRef<AbortController | null>(null)
  const retryRef = useRef(0)
  // Keep latest handleEvent in a ref so the mount effect doesn't go stale
  const handleEventRef = useRef<(e: SseEvent, isResume: boolean) => void>(() => {})

  const updateState = useCallback((patch: Partial<ChatStore>) => {
    setStore((prev) => {
      const next = { ...prev, ...patch }
      saveStore(next)
      return next
    })
  }, [])

  const handleEvent = useCallback((e: SseEvent, isResume: boolean) => {
    if (e.event === 'start') {
      try {
        const { chatId } = JSON.parse(e.data) as { chatId: string }
        updateState({ chatId, connectionState: 'connected' })
      } catch { /* ignore */ }
      return
    }

    if (e.event === 'token') {
      try {
        const { seq, content } = JSON.parse(e.data) as { seq: number; content: string }
        setStore((prev) => {
          if (seq <= prev.lastSeq) return prev  // deduplicate
          const next = {
            ...prev,
            lastSeq: seq,
            tokens: [...prev.tokens, content],
            connectionState: (isResume && prev.connectionState === 'replaying'
              ? 'replaying'
              : prev.connectionState) as ConnectionState,
          }
          saveStore(next)
          return next
        })
      } catch { /* ignore */ }
      return
    }

    if (e.event === 'replay_complete') {
      updateState({ connectionState: 'resumed' })
      return
    }

    if (e.event === 'done') {
      retryRef.current = 0
      updateState({ connectionState: 'completed' })
      return
    }
  }, [updateState])

  // Keep ref in sync so mount effect always calls the latest version
  useEffect(() => { handleEventRef.current = handleEvent }, [handleEvent])

  // On mount: if a previous chatId exists in localStorage, auto-resume.
  // This handles page reload mid-stream and revisiting a completed session.
  useEffect(() => {
    const saved = loadStore()
    if (!saved.chatId) return

    const ac = new AbortController()
    abortRef.current = ac
    updateState({ connectionState: 'replaying' })

    // Reload always starts with empty tokens, so replay from 0 to get the full stream back.
    // Mid-stream reconnects use lastSeq (handled by scheduleResume) to skip already-seen chunks.
    postResume(saved.chatId, 0, (e) => handleEventRef.current(e, true), ac.signal)
      .catch((err: unknown) => {
        if (ac.signal.aborted) return
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('404')) {
          // Stream expired — clear and let user start fresh
          clearStore()
          setStore({ chatId: null, lastSeq: 0, userMessage: null, tokens: [], connectionState: 'idle', errorMessage: null })
        } else {
          updateState({ connectionState: 'disconnected' })
          scheduleResumeRef.current(ac)
        }
      })

    return () => ac.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleResume = useCallback((prevAc: AbortController) => {
    if (prevAc.signal.aborted) return
    if (retryRef.current >= MAX_RETRIES) {
      updateState({ connectionState: 'error', errorMessage: 'Max retries exceeded' })
      return
    }

    const attempt = retryRef.current++
    const delay = backoff(attempt)
    updateState({ connectionState: 'reconnecting' })

    setTimeout(async () => {
      if (prevAc.signal.aborted) return

      const { chatId, lastSeq } = loadStore()
      if (!chatId) {
        updateState({ connectionState: 'error', errorMessage: 'Lost chatId — cannot resume' })
        return
      }

      updateState({ connectionState: 'replaying' })

      const ac = new AbortController()
      abortRef.current = ac

      try {
        await postResume(chatId, lastSeq, (e) => handleEvent(e, true), ac.signal)
        retryRef.current = 0
      } catch (err) {
        if (ac.signal.aborted) return
        updateState({ connectionState: 'disconnected' })
        scheduleResumeRef.current(ac)
      }
    }, delay)
  }, [handleEvent, updateState])

  // Keep scheduleResume in a ref so the mount effect and itself can call it
  // without creating circular deps
  const scheduleResumeRef = useRef(scheduleResume)
  useEffect(() => { scheduleResumeRef.current = scheduleResume }, [scheduleResume])

  const startStream = useCallback(async (message: string) => {
    abortRef.current?.abort()
    clearStore()
    retryRef.current = 0
    setStore({ chatId: null, lastSeq: 0, userMessage: message, tokens: [], connectionState: 'connected', errorMessage: null })

    const ac = new AbortController()
    abortRef.current = ac

    try {
      await postStream(message, null, (e) => handleEvent(e, false), ac.signal)
    } catch (err) {
      if (ac.signal.aborted) return
      updateState({ connectionState: 'disconnected' })
      scheduleResumeRef.current(ac)
    }
  }, [handleEvent, updateState])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    clearStore()
    setStore({ chatId: null, lastSeq: 0, userMessage: null, tokens: [], connectionState: 'idle', errorMessage: null })
  }, [])

  return { store, startStream, cancel }
}
