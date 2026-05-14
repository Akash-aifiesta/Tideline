interface Props {
  onNewChat: () => void
}

export function Sidebar({ onNewChat }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect width="22" height="22" rx="6" fill="#10a37f"/>
          <path d="M11 5.5C8 5.5 6 7.5 6 10c0 1.5.7 2.8 1.8 3.7L7 17h8l-.8-3.3C15.3 12.8 16 11.5 16 10c0-2.5-2-4.5-5-4.5z" fill="white" fillOpacity="0.9"/>
        </svg>
        Stream Chat
      </div>

      <button className="new-chat-btn" onClick={onNewChat}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        New chat
      </button>

      <div className="sidebar-section">
        <div className="sidebar-label">Architecture</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
          <div>GLB → Cloud Run</div>
          <div>Redis Streams (XREAD)</div>
          <div>SSE · Resumable</div>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-badge">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" fill="#10a37f" fillOpacity="0.8"/>
          </svg>
          poc2 · local
        </div>
      </div>
    </aside>
  )
}
