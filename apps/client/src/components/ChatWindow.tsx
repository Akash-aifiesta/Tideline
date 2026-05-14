import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react'
import { useStream } from '../hooks/useStream.js'
import { MessageList } from './MessageList.js'
import { ConnectionStatus } from './ConnectionStatus.js'
import { clearStore } from '../state/chat-store.js'


const HINTS = [
  'Explain distributed systems',
  'How does XREAD BLOCK work?',
  'What is Redis Streams?',
  'Describe the CAP theorem',
]

interface Props {
  onNewChat: () => void
}

export function ChatWindow({ onNewChat }: Props) {
  const [input, setInput] = useState('')
  const { store, startStream, cancel } = useStream()
  const { connectionState, tokens, userMessage } = store
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isActive = connectionState === 'connected'
    || connectionState === 'reconnecting'
    || connectionState === 'replaying'

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [input])

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault()
    const msg = input.trim()
    if (!msg || isActive) return
    setInput('')
    startStream(msg)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleNewChat() {
    cancel()
    clearStore()
    setInput('')
    onNewChat()
  }

  function handleHint(hint: string) {
    setInput(hint)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const showWelcome = !userMessage && tokens.length === 0 && connectionState === 'idle'

  return (
    <main className="main">
      {/* Top bar */}
      <div className="topbar">
        <span className="topbar-title">Stream Chat</span>
        <ConnectionStatus state={connectionState} />
      </div>

      {/* Messages */}
      <div className="messages">
        {showWelcome ? (
          <div className="welcome">
            <div className="welcome-icon">
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <path d="M13 3C8.6 3 5 6.6 5 11c0 2.8 1.4 5.2 3.5 6.7L7.5 22h11l-1-4.3C19.6 16.2 21 13.8 21 11c0-4.4-3.6-8-8-8z" fill="white" fillOpacity="0.9"/>
              </svg>
            </div>
            <h1>How can I help you?</h1>
            <p>A resumable streaming chat powered by Redis Streams and SSE. Disconnect mid-stream and resume exactly where you left off.</p>
            <div className="welcome-hints">
              {HINTS.map((h) => (
                <button key={h} className="hint-chip" onClick={() => handleHint(h)}>{h}</button>
              ))}
            </div>
          </div>
        ) : (
          <MessageList
            userMessage={userMessage}
            tokens={tokens}
            connectionState={connectionState}
          />
        )}
      </div>

      {/* Input */}
      <div className="input-area">
        <form onSubmit={handleSubmit}>
          <div className="input-wrap">
            <textarea
              ref={textareaRef}
              className="chat-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Stream Chat…"
              disabled={isActive}
            />
            {isActive ? (
              <button type="button" className="stop-btn" onClick={() => cancel()}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/>
                </svg>
              </button>
            ) : (
              <button type="submit" className="send-btn" disabled={!input.trim()}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 13V3M3 8l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </form>
        <div className="input-footer">
          Press <kbd style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>Enter</kbd> to send · <kbd style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>Shift+Enter</kbd> for new line
        </div>
      </div>
    </main>
  )
}
