import { Wifi } from 'lucide-react'

export default function ReconnectingToast({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 animate-slide-down">
      <div className="card px-4 py-2.5 flex items-center gap-2 shadow-glow">
        <Wifi size={14} className="text-app-accent animate-pulse" />
        <span className="text-xs text-app-muted">Reconnecting…</span>
      </div>
    </div>
  )
}
