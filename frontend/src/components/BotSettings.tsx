import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, Settings, Check } from 'lucide-react'
import {
  getTextChannels,
  getAnnouncementChannel,
  setAnnouncementChannel,
  type Channel,
} from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  token: string
  guildId: string
}

export default function BotSettings({ token, guildId }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [current,  setCurrent]  = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  const load = useCallback(async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [chs, setting] = await Promise.all([
        getTextChannels(token, guildId),
        getAnnouncementChannel(token, guildId),
      ])
      setChannels(chs)
      setCurrent(setting.announcementChannelId)
    } catch {
      /* non-fatal — card still renders with empty list */
    } finally {
      setLoading(false)
    }
  }, [token, guildId])

  useEffect(() => { void load() }, [load])

  const handleChange = async (channelId: string) => {
    const value = channelId === '' ? null : channelId
    setCurrent(value)
    setSaving(true)
    setSaved(false)
    try {
      await setAnnouncementChannel(token, guildId, value)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      /* best-effort */
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Settings size={13} className="text-app-muted" />
        <h2 className="text-xs font-semibold text-app-muted uppercase tracking-widest">
          Bot Settings
        </h2>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-app-muted">
          Announcement channel
          <span className="ml-1.5 text-app-border font-normal">
            (where "added via web" messages go)
          </span>
        </label>

        {loading ? (
          /* Skeleton while channels load */
          <div className="h-8 w-52 rounded-lg bg-app-panel animate-pulse" />
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative w-fit">
              <select
                value={current ?? ''}
                onChange={e => handleChange(e.target.value)}
                disabled={saving}
                className={cn(
                  'appearance-none bg-app-panel border border-app-border rounded-lg',
                  'text-app-text text-sm pl-3 pr-8 py-1.5 cursor-pointer',
                  'focus:outline-none focus:border-app-accent hover:border-app-muted/50',
                  'transition-colors min-w-[200px]',
                  saving && 'opacity-60 cursor-not-allowed',
                )}
              >
                <option value="">⚡ Auto-detect (musicbot → system)</option>
                {channels.map(c => (
                  <option key={c.id} value={c.id}># {c.name}</option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none"
              />
            </div>

            {saved && (
              <span className="flex items-center gap-1 text-xs text-green-400 animate-fade-up">
                <Check size={12} /> Saved
              </span>
            )}
          </div>
        )}

        <p className="text-xs text-app-border leading-relaxed">
          When set to{' '}
          <strong className="text-app-muted">Auto-detect</strong>, the bot looks for a channel
          named <strong className="text-app-muted">#musicbot</strong> first, then falls back to the
          server's system channel.
        </p>
      </div>
    </div>
  )
}
