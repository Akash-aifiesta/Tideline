import { useRef } from 'react'
import type { ConnectionState } from '../state/chat-store.js'

interface Props {
  userMessage: string | null
  tokens: string[]
  connectionState: ConnectionState
}

const STREAMING: Set<ConnectionState> = new Set(['connected', 'replaying', 'resumed'])
const THINKING:  Set<ConnectionState> = new Set(['connected'])

function AssistantIcon() {
  return (
    <div className="assistant-avatar">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2C5.2 2 3 4.2 3 7c0 1.7.8 3.1 2 4.1L4.5 14h7l-.5-2.9C12.2 10.1 13 8.7 13 7c0-2.8-2.2-5-5-5z" fill="white" fillOpacity="0.9"/>
      </svg>
    </div>
  )
}

export function MessageList({ userMessage, tokens, connectionState }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const isStreaming = STREAMING.has(connectionState)
  const isThinking  = THINKING.has(connectionState) && tokens.length === 0
  const isReplaying = connectionState === 'replaying'

  if (!userMessage && tokens.length === 0 && connectionState === 'idle') {
    return null
  }

  return (
    <div className="messages-inner">
      {/* User message */}
      {userMessage && (
        <div className="message-row fade-up">
          <div className="user-message">{userMessage}</div>
        </div>
      )}

      {/* Assistant message */}
      {(tokens.length > 0 || isThinking || connectionState !== 'idle') && (
        <div className="message-row fade-up">
          <div className="assistant-row">
            <AssistantIcon />
            <div className="assistant-content">
              {isReplaying && tokens.length === 0 && (
                <div className="replay-badge">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M5 1v4l3 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                  replaying from Redis…
                </div>
              )}

              {isThinking && !isReplaying ? (
                <div className="thinking">
                  <span /><span /><span />
                </div>
              ) : (
                <p>
                  {tokens.join(' ')}
                  {isStreaming && <span className="cursor" />}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
