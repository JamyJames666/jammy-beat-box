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
    const np = status.nowPlaying
    const playing = status.status === 'PLAYING'
    const srvPos = status.position ?? 0
    if (np.url !== songUrl) {
      setSongUrl(np.url); setLocalPos(srvPos); setLocalLen(np.length); stopTick()
    } else {
      setLocalLen(np.length)
      if (Math.abs(localPos - srvPos) > 3) setLocalPos(srvPos)
    }
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
    <div className="relative flex flex-col items-center z-10 w-full">

      {/* Big ambient glow — pulsing when playing */}
      <div
        className="absolute pointer-events-none transition-opacity duration-700"
        style={{
          top: -20,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 480,
          height: 480,
          background: active
            ? 'radial-gradient(circle, rgba(168,85,247,0.45) 0%, rgba(99,102,241,0.22) 40%, transparent 70%)'
            : 'radial-gradient(circle, rgba(80,40,120,0.15) 0%, transparent 70%)',
          filter: 'blur(60px)',
          borderRadius: '50%',
          zIndex: 0,
          animation: isPlaying ? 'pulse 3s ease-in-out infinite' : 'none',
        }}
      />

      {!active ? (
        <div className="flex flex-col items-center gap-5 py-12 z-10">
          <div
            className="rounded-3xl flex items-center justify-center"
            style={{ width: 340, height: 340, background: 'linear-gradient(135deg,#1a1a2e,#16162a)' }}
          >
            <Music size={72} style={{ color: '#333' }} />
          </div>
          <p className="text-white font-bold text-xl">Nothing playing</p>
          <p className="text-sm" style={{ color: '#555' }}>Add a song to get started</p>
        </div>
      ) : (
        <>
          {/* Album art */}
          <div className="relative z-10 mt-6 mb-6" style={{ width: 340 }}>
            {np?.thumbnailUrl ? (
              <img
                src={np.thumbnailUrl}
                alt={np.title}
                className="w-full rounded-3xl object-cover"
                style={{
                  height: 340,
                  boxShadow: '0 20px 80px rgba(0,0,0,0.8), 0 0 40px rgba(168,85,247,0.25)',
                }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div
                className="w-full rounded-3xl flex items-center justify-center"
                style={{ height: 340, background: 'linear-gradient(135deg,#2a1060,#1a1040)' }}
              >
                <Music size={72} style={{ color: '#7c3aed' }} />
              </div>
            )}

            {/* Animated bars — bottom right corner */}
            <div className={cn('absolute bottom-4 right-4 flex items-end gap-[3px] h-5', !isPlaying && 'opacity-0')}>
              <span className="block w-1 rounded-sm animate-bar"   style={{ background: 'rgba(255,255,255,0.8)' }} />
              <span className="block w-1 rounded-sm animate-bar-2" style={{ background: 'rgba(255,255,255,0.8)' }} />
              <span className="block w-1 rounded-sm animate-bar-3" style={{ background: 'rgba(255,255,255,0.8)' }} />
            </div>
          </div>

          {/* Title + artist */}
          <div className="text-center w-full px-6 z-10 mb-1" style={{ maxWidth: 380 }}>
            <p className="font-bold text-white leading-snug truncate" style={{ fontSize: 22 }} title={np?.title}>
              {np?.title ?? '—'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-1.5">
              <p className="text-base truncate" style={{ color: '#888' }}>{np?.artist ?? '—'}</p>
              {np?.source && <SourceBadge source={np.source} />}
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full px-6 z-10 mt-4 mb-5" style={{ maxWidth: 380 }}>
            <div
              ref={progressRef}
              onClick={handleSeek}
              className={cn('relative rounded-full overflow-hidden', active && 'cursor-pointer')}
              style={{ height: 5, background: 'rgba(255,255,255,0.12)' }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-1000"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #a855f7, #6366f1)',
                  boxShadow: '0 0 8px rgba(168,85,247,0.6)',
                }}
              />
            </div>
            <div className="flex justify-between text-xs mt-2" style={{ color: '#555' }}>
              <span>{fmtTime(localPos)}</span>
              <span>{fmtTime(localLen)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-6 z-10">
            <button
              onClick={handleStop}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 44, height: 44, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
              title="Stop"
            >
              <Square size={18} />
            </button>

            {/* Big play/pause */}
            <button
              onClick={handlePause}
              className="flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95"
              style={{
                width: 68, height: 68,
                background: '#fff',
                boxShadow: '0 0 0 8px rgba(168,85,247,0.20), 0 8px 32px rgba(0,0,0,0.5)',
              }}
            >
              {isPlaying
                ? <Pause size={24} style={{ color: '#000' }} />
                : <Play  size={24} style={{ color: '#000', marginLeft: 3 }} />}
            </button>

            <button
              onClick={handleSkip}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 44, height: 44, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
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
