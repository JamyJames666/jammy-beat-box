import { useState, type FormEvent } from 'react'
import { Plus, ChevronDown } from 'lucide-react'
import { play, type Channel } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  token: string
  guildId: string
  channels: Channel[]
  channelId: string
  onChannelChange: (id: string) => void
  onRefresh: () => void
}

export default function AddToQueue({ token, guildId, channels, channelId, onChannelChange, onRefresh }: Props) {
  const [query,   setQuery]   = useState('')
  const [loading, setLoading] = useState(false)
  const [status,  setStatus]  = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q || !guildId) return

    setLoading(true)
    setStatus(null)

    try {
      const res = await play(token, guildId, q, channelId || undefined)
      const pendingMsg = (res.pending ?? 0) > 0 ? ` · ${res.pending} lazy` : ''
      setStatus({ ok: true, msg: `Added ${res.added} songs (${res.queued ?? res.added} queued${pendingMsg}) — ${res.first}` })
      setQuery('')
      setTimeout(() => setStatus(null), 4000)
      onRefresh()
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Failed to add.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#888' }}>
        Add to queue
      </h2>

      {/* Channel selector */}
      {channels.length > 0 && (
        <div className="relative w-fit">
          <select
            value={channelId}
            onChange={e => onChannelChange(e.target.value)}
            className="appearance-none bg-app-panel border border-app-border rounded-lg
                       text-app-text text-sm pl-3 pr-8 py-1.5 cursor-pointer
                       focus:outline-none focus:border-app-accent
                       transition-colors min-w-[160px]"
          >
            {channels.map(c => (
              <option key={c.id} value={c.id}>🔊 {c.name}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2
                                             pointer-events-none" style={{ color: '#888' }} />
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          className="input flex-1"
          placeholder="Song name or link (YouTube or Spotify)…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="btn-primary flex items-center gap-1.5 px-4 py-2 whitespace-nowrap"
        >
          <Plus size={14} />
          {loading ? 'Adding…' : 'Add'}
        </button>
      </form>

      {status && (
        <p className={cn('text-xs animate-fade-up', status.ok ? 'text-app-muted' : 'text-app-danger')}>
          {status.msg}
        </p>
      )}
    </div>
  )
}
