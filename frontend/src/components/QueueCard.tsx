import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Shuffle, GripVertical, X, Music, Trash2, ListMusic,
  ChevronsUp, Search, ChevronLeft, ChevronRight, ListPlus,
} from 'lucide-react'
import { shuffle, clearQueue, move, remove, setVariant, flushPending, type TrackInfo } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

const PAGE_SIZE = 20

function getHighQualityThumb(url: string | null): string | null {
  if (!url) return null
  if (url.includes('ytimg.com') && url.includes('mqdefault')) {
    return url.replace('mqdefault', 'hqdefault')
  }
  return url
}

// ── Single sortable row ───────────────────────────────────────────────────────

interface RowProps {
  id: string
  item: TrackInfo
  displayNumber: number
  onRemove: () => void
  onMoveToTop: () => void
  onVariant: (suffix: string) => void
  draggable: boolean
}

function QueueRow({ id, item, displayNumber, onRemove, onMoveToTop, onVariant, draggable }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !draggable })

  const [thumbSrc, setThumbSrc] = useState<string | null>(getHighQualityThumb(item.thumbnailUrl))

  useEffect(() => {
    setThumbSrc(getHighQualityThumb(item.thumbnailUrl))
  }, [item.thumbnailUrl])

  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <li
      ref={setNodeRef}
      style={{
        ...style,
        background: isDragging ? '#2a1018' : 'rgba(32,14,20,0.5)',
        borderColor: isDragging ? '#f43f5e' : '#3d1726',
      }}
      className={cn(
        'flex items-center gap-3 rounded-xl px-4 py-3.5 border transition-all duration-150',
        isDragging ? 'opacity-40 z-10' : '',
      )}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = '#2a1018'
        ;(e.currentTarget as HTMLElement).style.borderColor = '#7c2d3f'
      }}
      onMouseLeave={e => {
        if (!isDragging) {
          ;(e.currentTarget as HTMLElement).style.background = 'rgba(32,14,20,0.5)'
          ;(e.currentTarget as HTMLElement).style.borderColor = '#3d1726'
        }
      }}
    >
      {/* Queue position */}
      <span className="text-xs tabular-nums w-6 text-right flex-shrink-0 font-mono font-bold"
        style={{ color: '#7a4a55' }}>
        {displayNumber}
      </span>

      {/* Drag handle */}
      {draggable && (
        <button
          className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none transition-colors"
          style={{ color: '#4a1a26' }}
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical size={16} />
        </button>
      )}

      {/* Thumbnail */}
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt=""
          loading="lazy"
          className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
          style={{ boxShadow: '0 2px 12px rgba(244,63,94,0.25)' }}
          onError={e => {
            const img = e.target as HTMLImageElement
            if (img.src.includes('ytimg.com') && img.src.includes('hqdefault')) {
              setThumbSrc(img.src.replace('hqdefault', 'mqdefault'))
            } else {
              setThumbSrc(null)
            }
          }}
        />
      ) : (
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#3d1020,#200e14)' }}
        >
          <Music size={20} style={{ color: '#f43f5e' }} />
        </div>
      )}

      {/* Title + artist */}
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold truncate leading-snug" style={{ color: '#fff5f7' }} title={item.title}>
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm truncate" style={{ color: '#c07080' }}>{item.artist}</p>
          {item.source && <SourceBadge source={item.source} />}
        </div>
      </div>

      {/* Variant buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {(['radio edit', 'lyric video'] as const).map(v => (
          <button
            key={v}
            onClick={() => onVariant(v)}
            className="text-[10px] px-2 py-0.5 rounded-full font-medium border transition-all"
            style={{ color: '#907080', borderColor: '#3d1726', background: 'transparent' }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLElement).style.borderColor = '#f43f5e'
              ;(e.currentTarget as HTMLElement).style.color = '#f43f5e'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.borderColor = '#3d1726'
              ;(e.currentTarget as HTMLElement).style.color = '#907080'
            }}
            title={`Find ${v} on YouTube`}
          >
            {v === 'radio edit' ? 'Radio' : 'Lyrics'}
          </button>
        ))}
      </div>

      {/* Duration */}
      <span className="text-sm flex-shrink-0 tabular-nums font-mono font-medium"
        style={{ color: '#905060' }}>
        {fmtTime(item.length)}
      </span>

      {/* Skip to top */}
      {displayNumber > 1 && (
        <button
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
          style={{ color: '#7a4a55', background: 'transparent' }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLElement).style.background = 'rgba(244,63,94,0.15)'
            ;(e.currentTarget as HTMLElement).style.color = '#f43f5e'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLElement).style.color = '#7a4a55'
          }}
          onClick={onMoveToTop}
          aria-label="Play next"
          title="Play next"
        >
          <ChevronsUp size={15} />
        </button>
      )}

      {/* Remove */}
      <button
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
        style={{ color: '#7a4a55', background: 'transparent' }}
        onMouseEnter={e => {
          ;(e.currentTarget as HTMLElement).style.background = 'rgba(244,63,94,0.15)'
          ;(e.currentTarget as HTMLElement).style.color = '#f43f5e'
        }}
        onMouseLeave={e => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLElement).style.color = '#7a4a55'
        }}
        onClick={onRemove}
        aria-label="Remove from queue"
      >
        <X size={15} />
      </button>
    </li>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────

interface Props {
  queue: TrackInfo[]
  token: string
  guildId: string
  onRefresh: () => void
  pendingCount?: number
  pendingPreview?: Array<{ title: string; artist: string }>
}

export default function QueueCard({
  queue, token, guildId, onRefresh, pendingCount = 0, pendingPreview = [],
}: Props) {
  const [optimisticQueue, setOptimisticQueue] = useState<TrackInfo[] | null>(null)
  const [search, setSearch]                   = useState('')
  const [page, setPage]                       = useState(0)
  const [bringingToQueue, setBringingToQueue] = useState(false)

  const displayQueue = optimisticQueue ?? queue

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const filteredItems = useMemo(() => {
    if (!search.trim()) return displayQueue.map((item, i) => ({ item, originalIndex: i }))
    const s = search.toLowerCase()
    return displayQueue
      .map((item, i) => ({ item, originalIndex: i }))
      .filter(({ item }) =>
        item.title.toLowerCase().includes(s) ||
        (item.artist ?? '').toLowerCase().includes(s),
      )
  }, [displayQueue, search])

  // Reset to first page whenever search changes
  useEffect(() => { setPage(0) }, [search])

  const isSearching = search.trim() !== ''
  const totalPages  = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const safePage    = Math.min(page, totalPages - 1)
  const pageItems   = filteredItems.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = parseInt(active.id as string)
    const newIndex = parseInt(over.id as string)
    if (isNaN(oldIndex) || isNaN(newIndex)) return

    setOptimisticQueue(arrayMove(displayQueue, oldIndex, newIndex))
    try {
      await move(token, guildId, oldIndex + 1, newIndex + 1)
    } catch {
      setOptimisticQueue(null)
    } finally {
      setOptimisticQueue(null)
      onRefresh()
    }
  }, [displayQueue, token, guildId, onRefresh])

  const handleShuffle = async () => {
    await shuffle(token, guildId).catch(() => null)
    onRefresh()
  }

  const handleClearQueue = async () => {
    await clearQueue(token, guildId).catch(() => null)
    onRefresh()
  }

  const handleRemove = async (originalIndex: number) => {
    setOptimisticQueue(displayQueue.filter((_, i) => i !== originalIndex))
    try {
      await remove(token, guildId, originalIndex + 1)
    } finally {
      setOptimisticQueue(null)
      onRefresh()
    }
  }

  const handleVariant = async (originalIndex: number, suffix: string) => {
    await setVariant(token, guildId, originalIndex + 1, suffix).catch(() => null)
    onRefresh()
  }

  const handleMoveToTop = async (originalIndex: number) => {
    const next = [...displayQueue]
    const [song] = next.splice(originalIndex, 1)
    next.unshift(song)
    setOptimisticQueue(next)
    try {
      await move(token, guildId, originalIndex + 1, 1)
    } finally {
      setOptimisticQueue(null)
      onRefresh()
    }
  }

  const handleBringToQueue = async () => {
    setBringingToQueue(true)
    try {
      await flushPending(token, guildId, 100)
      onRefresh()
    } catch {
      // non-fatal
    } finally {
      setBringingToQueue(false)
    }
  }

  return (
    <div className="card p-6 flex flex-col gap-4 min-h-[300px]">

      {/* Header */}
      <div className="flex items-center gap-3">
        <ListMusic size={15} className="flex-shrink-0" style={{ color: '#f43f5e' }} />
        <h2 className="text-xs font-semibold uppercase tracking-widest mr-auto">Queue</h2>
        {displayQueue.length > 0 && (
          <span className="text-xs bg-app-panel px-2.5 py-1 rounded-full border border-app-border tabular-nums"
            style={{ color: '#c07080' }}>
            {displayQueue.length} {displayQueue.length === 1 ? 'song' : 'songs'}
          </span>
        )}
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5"
          onClick={handleShuffle}
          disabled={displayQueue.length < 2}
        >
          <Shuffle size={13} /> Shuffle
        </button>
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5
                     text-app-danger hover:text-app-danger hover:bg-app-danger/10"
          onClick={handleClearQueue}
          disabled={displayQueue.length === 0}
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>

      {/* Search bar */}
      {displayQueue.length > 0 && (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: '#905060' }} />
          <input
            type="text"
            className="input pl-8 text-xs h-9"
            placeholder="Search queue…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{ color: '#905060' }}
              onClick={() => setSearch('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Queue list */}
      {displayQueue.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-12 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-app-panel flex items-center justify-center">
            <Music size={22} className="text-app-muted" />
          </div>
          <p className="text-sm text-app-muted">Queue is empty</p>
          <p className="text-xs" style={{ color: '#3d1726' }}>Add songs to get started</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <p className="text-sm text-app-muted">No results for "{search}"</p>
        </div>
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={isSearching ? [] : pageItems.map(({ originalIndex }) => String(originalIndex))}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-1.5 overflow-y-auto -mx-1 px-1 py-0.5"
                style={{ maxHeight: 'calc(100vh - 360px)', minHeight: '200px' }}>
                {pageItems.map(({ item, originalIndex }) => (
                  <QueueRow
                    key={`${item.url}-${originalIndex}`}
                    id={String(originalIndex)}
                    item={item}
                    displayNumber={originalIndex + 1}
                    draggable={!isSearching}
                    onRemove={() => handleRemove(originalIndex)}
                    onMoveToTop={() => handleMoveToTop(originalIndex)}
                    onVariant={suffix => handleVariant(originalIndex, suffix)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 border-t"
              style={{ borderColor: 'rgba(61,23,38,0.5)' }}>
              <span className="text-xs" style={{ color: '#905060' }}>
                Page {safePage + 1} of {totalPages}
                {isSearching && (
                  <span className="ml-1">({filteredItems.length} results)</span>
                )}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
                  style={{ color: '#c07080' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(244,63,94,0.15)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
                  style={{ color: '#c07080' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(244,63,94,0.15)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pending songs */}
      {pendingCount > 0 && (
        <div className="border-t pt-3 space-y-2" style={{ borderColor: 'rgba(61,23,38,0.5)' }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#c07080' }}>
              {pendingCount} more song{pendingCount !== 1 ? 's' : ''} loading as queue plays
            </p>
            <button
              onClick={handleBringToQueue}
              disabled={bringingToQueue}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider
                         px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#f97316,#f43f5e)', color: 'white' }}
            >
              <ListPlus size={11} />
              {bringingToQueue ? 'Loading…' : 'Bring to Queue'}
            </button>
          </div>
          {pendingPreview.map((s, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-lg opacity-50">
              <Music size={10} style={{ color: '#3d1726' }} className="flex-shrink-0" />
              <p className="text-xs text-app-muted truncate">
                {s.title}
                {s.artist ? <span style={{ color: '#3d1726' }}> · {s.artist}</span> : null}
              </p>
            </div>
          ))}
          {pendingCount > pendingPreview.length && (
            <p className="text-[10px] px-2" style={{ color: '#3d1726' }}>
              +{pendingCount - pendingPreview.length} more…
            </p>
          )}
        </div>
      )}
    </div>
  )
}
