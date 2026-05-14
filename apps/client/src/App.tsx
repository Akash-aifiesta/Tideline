import { useState } from 'react'
import { Sidebar } from './components/Sidebar.js'
import { ChatWindow } from './components/ChatWindow.js'

export default function App() {
  const [key, setKey] = useState(0)

  return (
    <div className="app">
      <Sidebar onNewChat={() => setKey((k) => k + 1)} />
      <ChatWindow key={key} onNewChat={() => setKey((k) => k + 1)} />
    </div>
  )
}
