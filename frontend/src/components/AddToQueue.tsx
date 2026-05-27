import { useState, type FormEvent } from 'react'
import { Plus, ChevronDown, Youtube, Music } from 'lucide-react'
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

type Tab = 'youtube' | 'spotify'

export default function AddToQueue({ token, guildId, channels, channelId, onChannelChange, onRefresh }: Props) {
  const [tab,     setTab]     = useState<Tab>('youtube')
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
      setStatus({ ok: true, msg: `Added ${res.added} song${res.added !== 1 ? 's' : ''} — ${res.first}` })
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
    <div className="card p-5 space-y-4">
      <h2 className="text-xs font-semibold text-app-muted uppercase tracking-widest">
        Add to queue
      </h2>

      {/* Tabs */}
      <div className="flex gap-1 bg-app-panel rounded-lg p-1 w-fit">
        {(['youtube', 'spotify'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              tab === t
                ? 'bg-app-accent text-white shadow-sm'
                : 'text-app-muted hover:text-app-text',
            )}
          >
            {t === 'youtube'
              ? <Youtube size={12} />
              : <Music    size={12} />}
            {t === 'youtube' ? 'YouTube' : 'Spotify'}
          </button>
        ))}
      </div>

      {/* Channel selector */}
      {channels.length > 0 && (
        <div className="relative w-fit">
          <select
            value={channelId}
            onChange={e => onChannelChange(e.target.value)}
            className="appearance-none bg-app-panel border border-app-border rounded-lg
                       text-app-text text-sm pl-3 pr-8 py-1.5 cursor-pointer
                       focus:outline-none focus:border-app-accent hover:border-app-muted/50
                       transition-colors min-w-[160px]"
          >
            {channels.map(c => (
              <option key={c.id} value={c.id}>🔊 {c.name}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2
                                             text-app-muted pointer-events-none" />
        </div>
      )}

      {/* Search input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          className="input flex-1"
          placeholder={
            tab === 'spotify'
              ? 'Spotify URL or track name…'
              : 'Song name or YouTube URL…'
          }
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

      {/* Status message */}
      {status && (
        <p className={cn(
          'text-xs animate-fade-up',
          status.ok ? 'text-app-muted' : 'text-app-danger',
        )}>
          {status.msg}
        </p>
      )}
    </div>
  )
}
