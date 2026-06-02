import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square, Music } from 'lucide-react'
import { pause, resume, skip, stop, type PlayerStatus } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
}

export default function NowPlaying({ status, token, guildId, onRefresh }: Props) {
  const [localPos, setLocalPos] = useState(0)
  const [localLen, setLocalLen] = useState(0)
  const [songUrl,  setSongUrl]  = useState('')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }

  useEffect(() => {
    if (!status?.nowPlaying) { stopTick(); return }
    const np = status.nowPlaying; const playing = status.status === 'PLAYING'; const srvPos = status.position ?? 0
    if (np.url !== songUrl) { setSongUrl(np.url); setLocalPos(srvPos); setLocalLen(np.length); stopTick() }
    else { setLocalLen(np.length); if (Math.abs(localPos - srvPos) > 3) setLocalPos(srvPos) }
    if (playing && !tickRef.current) {
      const rate = status.speed ?? 1
      tickRef.current = setInterval(() => setLocalPos(p => Math.min(p + rate, np.length)), 1000)
    } else if (!playing) { stopTick() }
    return stopTick
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const isPlaying = status?.status === 'PLAYING'
  const active    = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np        = status?.nowPlaying ?? null
  const pct       = localLen > 0 ? Math.min(100, (localPos / localLen) * 100) : 0

  const handlePause = async () => { await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null); onRefresh() }
  const handleSkip  = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop  = async () => { await stop(token, guildId).catch(() => null); onRefresh() }

  const progressRef = useRef<HTMLDivElement>(null)
  const handleSeek  = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || localLen === 0) return
    const r = progressRef.current?.getBoundingClientRect(); if (!r) return
    const pos = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * localLen)
    setLocalPos(pos)
    const {seek: seekFn} = await import('@/lib/api')
    await seekFn(token, guildId, pos).catch(() => null)
    onRefresh()
  }, [active, localLen, token, guildId, onRefresh])

  return (
    <div className="relative flex flex-col items-center z-10">

      {/* Ambient glow behind art */}
      {active && (
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
          style={{
            top: 24,
            width: 280, height: 280,
            background: 'radial-gradient(circle, rgba(210,130,50,0.32) 0%, rgba(180,90,20,0.12) 45%, transparent 70%)',
            filter: 'blur(38px)',
            borderRadius: '50%',
            zIndex: 0,
          }} />
      )}

      {!active ? (
        <div className="flex flex-col items-center gap-4 py-10 z-10">
          <div className="w-48 h-48 rounded-2xl flex items-center justify-center"
            style={{ background: '#1c1c1c' }}>
            <Music size={44} style={{ color: '#444' }} />
          </div>
          <p className="text-white font-bold text-lg">Nothing playing</p>
          <p className="text-sm" style={{ color: '#666' }}>Add a song to get started</p>
        </div>
      ) : (
        <>
          {/* Album art */}
          <div className="relative z-10 mt-6 mb-5">
            {np?.thumbnailUrl ? (
              <img
                src={np.thumbnailUrl}
                alt={np.title}
                className="w-52 h-52 rounded-2xl object-cover"
                style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div className="w-52 h-52 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #2a2a2a, #1c1c1c)' }}>
                <Music size={40} style={{ color: '#555' }} />
              </div>
            )}
            {/* Playing bars */}
            <div className={cn('absolute bottom-3 right-3 flex items-end gap-[2px] h-4', !isPlaying && 'opacity-0')}>
              <span className="block w-[3px] rounded-sm animate-bar"   style={{ background: 'rgba(255,255,255,0.7)' }} />
              <span className="block w-[3px] rounded-sm animate-bar-2" style={{ background: 'rgba(255,255,255,0.7)' }} />
              <span className="block w-[3px] rounded-sm animate-bar-3" style={{ background: 'rgba(255,255,255,0.7)' }} />
            </div>
          </div>

          {/* Title + artist */}
          <div className="text-center w-full px-4 z-10 mb-5">
            <p className="font-bold text-white text-lg leading-snug truncate" title={np?.title}>
              {np?.title ?? '—'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-1">
              <p className="text-sm truncate" style={{ color: '#888' }}>{np?.artist ?? '—'}</p>
              {np?.source && <SourceBadge source={np.source} />}
            </div>
          </div>

          {/* Progress */}
          <div className="w-full px-4 z-10 mb-5">
            <div
              ref={progressRef}
              onClick={handleSeek}
              className={cn('relative h-1 rounded-full overflow-hidden', active && 'cursor-pointer')}
              style={{ background: '#333' }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-1000"
                style={{ width: `${pct}%`, background: '#a855f7' }}
              />
            </div>
            <div className="flex justify-between text-xs mt-1.5" style={{ color: '#666' }}>
              <span>{fmtTime(localPos)}</span>
              <span>{fmtTime(localLen)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-5 z-10">
            <button
              onClick={handleStop}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all"
              style={{ color: '#666' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#666' }}
              title="Stop"
            >
              <Square size={18} />
            </button>

            <button
              onClick={handlePause}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105"
              style={{ background: '#ffffff' }}
            >
              {isPlaying
                ? <Pause size={20} style={{ color: '#000' }} />
                : <Play  size={20} style={{ color: '#000', marginLeft: 2 }} />}
            </button>

            <button
              onClick={handleSkip}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all"
              style={{ color: '#666' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#666' }}
              title="Skip"
            >
              <SkipForward size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
