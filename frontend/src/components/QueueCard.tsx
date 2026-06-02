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
  Shuffle, GripVertical, X, Music, Trash2, ListMusic, ImageIcon,
  ChevronsUp, Search, ListPlus,
} from 'lucide-react'
import { shuffle, clearQueue, move, remove, flushPending, refreshThumbnails, loadMoreSpotify, type TrackInfo } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

const PAGE_SIZE = 99999 // no pagination — one scrollable list

function getHighQualityThumb(url: string | null): string | null {
  if (!url) return null
  if (url.includes('ytimg.com') && url.includes('mqdefault')) {
    return url.replace('mqdefault', 'hqdefault')
  }
  return url
}

// Deterministic color gradient from title string
function titleToGradient(title: string): string {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  const hue2 = (hue + 40) % 360
  return `linear-gradient(135deg, hsl(${hue},55%,28%) 0%, hsl(${hue2},50%,20%) 100%)`
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowProps {
  id: string
  item: TrackInfo
  displayNumber: number
  onRemove: () => void
  onMoveToTop: () => void
  draggable: boolean
}

function QueueRow({ id, item, displayNumber, onRemove, onMoveToTop, draggable }: RowProps) {
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
      style={{ ...style }}
      className={cn(
        'flex items-center gap-3 px-3 py-3.5 rounded-xl transition-colors duration-100 group',
        isDragging ? 'opacity-40' : 'hover:bg-app-panel',
      )}
    >
      {/* Queue number */}
      <span className="text-xs tabular-nums w-5 text-right flex-shrink-0 font-mono"
        style={{ color: '#555' }}>
        {displayNumber}
      </span>

      {/* Drag handle */}
      {draggable && (
        <button
          className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: '#555' }}
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
      )}

      {/* Thumbnail */}
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt=""
          loading="lazy"
          className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
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
          style={{ background: titleToGradient(item.title ?? '') }}
        >
          <Music size={18} style={{ color: 'rgba(255,255,255,0.45)' }} />
        </div>
      )}

      {/* Title + artist */}
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold truncate text-white" title={item.title}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-sm truncate" style={{ color: '#888' }}>{item.artist}</p>
          {item.source && <SourceBadge source={item.source} />}
        </div>
      </div>

      {/* Duration */}
      <span className="text-xs flex-shrink-0 tabular-nums font-mono" style={{ color: '#666' }}>
        {fmtTime(item.length)}
      </span>

      {/* Skip to top */}
      {displayNumber > 1 && (
        <button
          className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
                     opacity-0 group-hover:opacity-100 transition-all hover:bg-app-border"
          style={{ color: '#888' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}
          onClick={onMoveToTop}
          title="Play next"
        >
          <ChevronsUp size={14} />
        </button>
      )}

      {/* Remove */}
      <button
        className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
                   opacity-0 group-hover:opacity-100 transition-all hover:bg-app-danger/20"
        style={{ color: '#888' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f43f5e' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}
        onClick={onRemove}
        title="Remove"
      >
        <X size={14} />
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
  spotifyHasMore?: boolean
}

export default function QueueCard({
  queue, token, guildId, onRefresh, pendingCount = 0, spotifyHasMore = false,
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

  const handleShuffle       = async () => { await shuffle(token, guildId).catch(() => null); onRefresh() }
  const handleClearQueue    = async () => { await clearQueue(token, guildId).catch(() => null); onRefresh() }
  const handleRefreshThumbs = async () => { await refreshThumbnails(token, guildId).catch(() => null); onRefresh() }

  const handleRemove = async (originalIndex: number) => {
    setOptimisticQueue(displayQueue.filter((_, i) => i !== originalIndex))
    try { await remove(token, guildId, originalIndex + 1) }
    finally { setOptimisticQueue(null); onRefresh() }
  }

  const handleMoveToTop = async (originalIndex: number) => {
    const next = [...displayQueue]
    const [song] = next.splice(originalIndex, 1)
    next.unshift(song)
    setOptimisticQueue(next)
    try { await move(token, guildId, originalIndex + 1, 1) }
    finally { setOptimisticQueue(null); onRefresh() }
  }

  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreMsg, setLoadMoreMsg] = useState<string | null>(null)

  const handleBringToQueue = async () => {
    setBringingToQueue(true)
    try { await flushPending(token, guildId, 9999); onRefresh() }
    catch { /* non-fatal */ }
    finally { setBringingToQueue(false) }
  }

  const handleLoadMore = async () => {
    setLoadingMore(true)
    setLoadMoreMsg(null)
    try {
      const res = await loadMoreSpotify(token, guildId)
      onRefresh()
      if (res.added > 0) {
        setLoadMoreMsg(`+${res.added} songs added`)
      } else {
        setLoadMoreMsg(res.message ?? 'No more songs found')
      }
      setTimeout(() => setLoadMoreMsg(null), 4000)
    } catch {
      setLoadMoreMsg('Failed — try again')
      setTimeout(() => setLoadMoreMsg(null), 3000)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="card flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 140px)' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-3 flex-shrink-0">
        <ListMusic size={14} className="flex-shrink-0 text-app-accent" />
        <h2 className="text-sm font-semibold">Up Next</h2>

        {/* Song count */}
        {displayQueue.length > 0 && (
          <span className="text-xs tabular-nums mr-auto" style={{ color: '#666' }}>
            {displayQueue.length} songs
          </span>
        )}
        {displayQueue.length === 0 && <span className="mr-auto" />}

        {/* Load Lazy Songs — always visible */}
        <button
          onClick={handleBringToQueue}
          disabled={bringingToQueue || pendingCount === 0}
          className={cn(
            'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95',
            pendingCount > 0 && !bringingToQueue && 'animate-lazy-ready',
          )}
          style={pendingCount > 0
            ? { background: 'rgba(168,85,247,0.20)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.40)' }
            : { background: 'transparent', color: '#444', border: '1px solid #333', cursor: 'default' }
          }
          title={pendingCount > 0 ? `Load ${pendingCount} more songs into queue` : 'No lazy songs waiting'}
        >
          <ListPlus size={12} />
          {bringingToQueue ? 'Loading…' : pendingCount > 0 ? `Load Lazy Songs (${pendingCount})` : 'Load Lazy Songs'}
        </button>

        {/* Load More from Spotify */}
        {spotifyHasMore && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95"
            style={{ background: 'rgba(29,185,84,0.15)', color: '#1db954', border: '1px solid rgba(29,185,84,0.35)' }}
            title="Fetch the next 200 songs from this Spotify playlist"
          >
            <ListPlus size={12} />
            {loadingMore ? 'Loading…' : 'More Spotify'}
          </button>
        )}

        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5"
          onClick={handleShuffle}
          disabled={displayQueue.length < 2}
        >
          <Shuffle size={12} /> Shuffle
          {pendingCount > 0 && (
            <span className="text-[10px] opacity-60" title={`Shuffles ${displayQueue.length} active + ${pendingCount} pending = ${displayQueue.length + pendingCount} total`}>
              ({displayQueue.length + pendingCount})
            </span>
          )}
        </button>
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5"
          onClick={handleRefreshThumbs}
          disabled={displayQueue.length === 0}
          title="Fetch missing album art from Deezer"
        >
          <ImageIcon size={12} />
        </button>
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5 hover:text-app-danger"
          onClick={handleClearQueue}
          disabled={displayQueue.length === 0}
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>

      {/* Load More result message — shown below the header for visibility */}
      {loadMoreMsg && (
        <div className="px-5 py-1.5 flex-shrink-0 text-xs font-medium animate-fade-up"
          style={{ color: loadMoreMsg.startsWith('+') ? '#1db954' : '#888', borderBottom: '1px solid #1a1a2a' }}>
          {loadMoreMsg}
        </div>
      )}

      {/* Search */}
      {displayQueue.length > 0 && (
        <div className="relative px-5 pb-3 flex-shrink-0">
          <Search size={12} className="absolute left-8 top-1/2 -translate-y-1/2" style={{ color: '#555' }} />
          <input
            type="text"
            className="input pl-7 text-xs h-8"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-7 top-1/2 -translate-y-1/2" style={{ color: '#555' }}
              onClick={() => setSearch('')}>
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Queue list — scrollable */}
      <div className="flex-1 overflow-y-auto px-2 min-h-0">
        {displayQueue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-14 h-14 rounded-xl bg-app-panel flex items-center justify-center">
              <Music size={22} style={{ color: '#555' }} />
            </div>
            <p className="text-sm" style={{ color: '#888' }}>Queue is empty</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <p className="text-sm" style={{ color: '#666' }}>No results for "{search}"</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={isSearching ? [] : pageItems.map(({ originalIndex }) => String(originalIndex))}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {pageItems.map(({ item, originalIndex }) => (
                  <QueueRow
                    key={`${item.url}-${originalIndex}`}
                    id={String(originalIndex)}
                    item={item}
                    displayNumber={originalIndex + 1}
                    draggable={!isSearching}
                    onRemove={() => handleRemove(originalIndex)}
                    onMoveToTop={() => handleMoveToTop(originalIndex)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Search result count when filtering */}
      {isSearching && (
        <div className="px-5 py-1.5 flex-shrink-0 border-t border-app-border/60">
          <span className="text-xs" style={{ color: '#666' }}>{filteredItems.length} results</span>
        </div>
      )}

    </div>
  )
}
