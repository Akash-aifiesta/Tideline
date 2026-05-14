import type { ConnectionState } from '../state/chat-store.js'

const LABELS: Record<ConnectionState, string> = {
  idle:         'Ready',
  connected:    'Streaming',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting…',
  replaying:    'Replaying',
  resumed:      'Resumed',
  completed:    'Done',
  error:        'Error',
}

const ACTIVE: ConnectionState[] = ['connected', 'reconnecting', 'replaying', 'resumed']
const ERROR:  ConnectionState[] = ['error', 'disconnected']

interface Props {
  state: ConnectionState
}

export function ConnectionStatus({ state }: Props) {
  const isActive = ACTIVE.includes(state)
  const isError  = ERROR.includes(state)

  return (
    <div className={`status-pill ${isActive ? 'active' : ''} ${isError ? 'error' : ''}`}>
      <span className={`status-dot ${isActive ? 'pulse' : ''}`} />
      {LABELS[state]}
    </div>
  )
}
