import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { TeamBoard, TeamBoardCard } from '@shared/types'
import { DEFAULT_EVENT_STATUSES, findStatus } from '@shared/eventStatus'
import { useAppStore } from '../stores/appStore'
import { errorMessage } from '../utils/errors'
import { Spinner } from './ui'

const DRAG_TYPE = 'application/x-teamwork-interview'
const UNASSIGNED = '__unassigned__'
/** The time axis' width, and the narrowest a person's column gets (wider ones share the room). */
const GUTTER_PX = 56
const MIN_COLUMN_PX = 200
/** Where the day opens when today isn't shown. */
const OPEN_AT_HOUR = 8

interface Column {
  id: string
  name: string
  /** Null: interviews nobody has yet. */
  callerId: string | null
  color: string
  mine: boolean
  cards: TeamBoardCard[]
}

/** "Hector Ruiz" → "HR", "hong" → "HO". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

/** Side by side when they overlap: each card's lane, and how many lanes its overlapping group needs. */
function lanes(cards: TeamBoardCard[]): Map<string, { lane: number; of: number }> {
  const result = new Map<string, { lane: number; of: number }>()
  const sorted = [...cards].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))
  let group: string[] = []
  let groupEnd = ''
  let laneEnds: string[] = []
  const close = (): void => {
    for (const id of group) result.set(id, { lane: result.get(id)!.lane, of: laneEnds.length })
    group = []
    groupEnd = ''
    laneEnds = []
  }
  for (const card of sorted) {
    if (group.length && card.start >= groupEnd) close()
    let lane = laneEnds.findIndex((end) => end <= card.start)
    if (lane < 0) lane = laneEnds.push(card.end) - 1
    else laneEnds[lane] = card.end
    result.set(card.interviewId, { lane, of: 0 })
    group.push(card.interviewId)
    if (card.end > groupEnd) groupEnd = card.end
  }
  close()
  return result
}

/**
 * The Team view's Day, as on the Teamwork website: one column per caller
 * (avatar, name, how many interviews or "Free all day") on a shared time axis,
 * each interview where it falls, and a line at the current time. Interviews
 * nobody has yet come first. Drag an interview to another caller to give it to
 * them (a later round asks first; offline, the move waits and goes when
 * Teamwork is back). Click one for its details.
 */
export function TeamDayBoard({
  from,
  to,
  timeZone,
  hourHeight
}: {
  /** The day's midnight and the next (ISO), in the calendar's time zone. */
  from: string
  to: string
  timeZone: string | undefined
  /** Height of one hour, in px (the calendar's zoom). */
  hourHeight: number
}) {
  const selectEvent = useAppStore((s) => s.selectEvent)
  const selectedEventId = useAppStore((s) => s.selectedEventId)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const notify = useAppStore((s) => s.notify)
  const statuses = useAppStore((s) => s.settings?.eventStatuses ?? DEFAULT_EVENT_STATUSES)
  const [board, setBoard] = useState<TeamBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const scroller = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    void window.api.caller
      .teamBoard(from, to)
      .then((b) => {
        setBoard(b)
        setError(null)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [from, to])
  useEffect(() => {
    load()
    const offCaller = window.api.caller.onChanged(load)
    return offCaller
  }, [load])
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const dayMs = Date.parse(from)
  const pxPerMinute = hourHeight / 60
  const nowMinutes = (now - dayMs) / 60_000
  const showNow = nowMinutes >= 0 && nowMinutes < 24 * 60
  const minutesFromStart = (iso: string): number => (Date.parse(iso) - dayMs) / 60_000

  const columns = useMemo(() => {
    if (!board) return []
    const byCaller = new Map<string, TeamBoardCard[]>()
    const none: TeamBoardCard[] = []
    for (const card of board.cards) {
      if (card.callerId) byCaller.set(card.callerId, [...(byCaller.get(card.callerId) ?? []), card])
      else none.push(card)
    }
    return [
      { id: UNASSIGNED, name: 'Unassigned', callerId: null, color: board.unassignedColor, mine: false, cards: none },
      ...board.callers.map((c) => ({ id: c.userId, name: c.name, callerId: c.userId, color: c.color, mine: c.mine, cards: byCaller.get(c.userId) ?? [] }))
    ] satisfies Column[]
  }, [board])

  // Open on the current time today, else at 8 AM; only when the day or the zoom changes.
  useEffect(() => {
    const el = scroller.current
    if (!el || !board) return
    el.scrollTop = showNow ? Math.max(0, nowMinutes * pxPerMinute - el.clientHeight / 3) : OPEN_AT_HOUR * hourHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayMs, hourHeight, Boolean(board)])

  const hourLabel = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone }), [timeZone])
  const time = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }), [timeZone])

  async function move(card: TeamBoardCard, column: Column) {
    if (card.callerId === column.callerId) return
    try {
      let result = await window.api.caller.assign(card.interviewId, column.callerId, false)
      if (!result.ok) {
        const ok = await askConfirm({ title: 'Move a later round?', message: result.locked, confirmLabel: 'Move it', danger: true })
        if (!ok) return
        result = await window.api.caller.assign(card.interviewId, column.callerId, true)
      }
      if (result.ok && result.queued) {
        notify(`You're offline: ${column.callerId ? `${column.name} as the caller` : 'Unassigned'} is saved here and sent to Teamwork when you're back.`)
      }
      load()
    } catch (err) {
      notify(errorMessage(err), 'error')
    }
  }

  const dropProps = (column: Column) =>
    board?.canAssign
      ? {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(column.id)
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            setDropTarget(null)
            const card = board.cards.find((c) => c.interviewId === e.dataTransfer.getData(DRAG_TYPE))
            if (card) void move(card, column)
          }
        }
      : {}

  if (error && !board) return <p className="p-4 text-sm text-red-300">{error}</p>
  if (!board) {
    return (
      <div className="p-4">
        <Spinner className="text-slate-500" />
      </div>
    )
  }
  if (!board.signedIn) {
    return (
      <p className="m-4 rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
        Connect Teamwork under Connections to see the team&apos;s day.
      </p>
    )
  }

  const hours = Array.from({ length: 24 }, (_, h) => h)
  const gridTemplate = `${GUTTER_PX}px repeat(${columns.length}, minmax(${MIN_COLUMN_PX}px, 1fr))`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {board.offlineSince && (
        <p className="text-xs text-amber-300/90">
          Offline: as Teamwork had it at {new Date(board.offlineSince).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
          Moves you make wait here and go when Teamwork is back.
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-800" aria-label="Interviews of the day by caller">
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-max" style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>
            {/* Header: who, and how busy. Sticks to the top while the day scrolls. */}
            <div className="sticky top-0 left-0 z-30 border-b border-slate-800 bg-slate-900" />
            {columns.map((column) => (
              <div key={column.id} className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-l border-slate-800 bg-slate-900 px-3 py-2.5">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${
                    column.callerId === null ? 'border-2 border-dashed bg-transparent' : ''
                  }`}
                  style={column.callerId === null ? { borderColor: column.color, color: column.color } : { background: column.color }}
                  aria-hidden
                >
                  {column.callerId === null ? '?' : initials(column.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {column.name}
                    {column.mine && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}
                  </p>
                  <p className={`text-xs ${column.callerId === null && column.cards.length ? 'text-amber-300' : 'text-slate-400'}`}>
                    {column.cards.length === 0
                      ? column.callerId === null
                        ? 'Nothing to assign'
                        : 'Free all day'
                      : `${column.cards.length} ${column.cards.length === 1 ? 'event' : 'events'}`}
                  </p>
                </div>
              </div>
            ))}

            {/* Time axis. */}
            <div className="sticky left-0 z-10 bg-slate-900" style={{ height: 24 * hourHeight }}>
              {hours.map((h) => (
                <div key={h} className="relative" style={{ height: hourHeight }}>
                  {h > 0 && (
                    <span className="absolute -top-2 right-2 text-[10px] text-slate-500 tabular-nums">
                      {hourLabel.format(new Date(dayMs + h * 3_600_000))}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* One column per person: hour lines, then the interviews where they fall. */}
            {columns.map((column) => {
              const placed = lanes(column.cards)
              return (
                <div
                  key={column.id}
                  {...dropProps(column)}
                  className={`relative border-l border-slate-800 transition-colors ${dropTarget === column.id ? 'bg-blue-500/5' : ''}`}
                  style={{ height: 24 * hourHeight }}
                  aria-label={column.name}
                >
                  {hours.map((h) => (
                    <div key={h} className="border-t border-slate-800/70" style={{ height: hourHeight }} />
                  ))}
                  {showNow && (
                    <div className="pointer-events-none absolute right-0 left-0 z-10 h-px bg-rose-500" style={{ top: nowMinutes * pxPerMinute }}>
                      <span className="absolute -top-[3px] -left-[4px] h-[7px] w-[7px] rounded-full bg-rose-500" />
                    </div>
                  )}
                  {column.cards.map((card) => {
                    const top = Math.max(0, minutesFromStart(card.start)) * pxPerMinute
                    const bottom = Math.min(24 * 60, minutesFromStart(card.end)) * pxPerMinute
                    const lane = placed.get(card.interviewId) ?? { lane: 0, of: 1 }
                    const status = findStatus(statuses, card.status)
                    const width = 100 / Math.max(lane.of, 1)
                    const height = Math.max(bottom - top, 1)
                    const tall = height >= 38
                    const ended = Date.parse(card.end) <= now
                    const when = `${time.format(new Date(card.start))} – ${time.format(new Date(card.end))}`
                    const selected = Boolean(card.eventId && card.eventId === selectedEventId)
                    return (
                      <button
                        key={card.interviewId}
                        type="button"
                        draggable={card.canAssign}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_TYPE, card.interviewId)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onClick={() => card.eventId && selectEvent(card.eventId)}
                        title={`${card.title}\n${when}${card.company ? ` · ${card.company}` : ''}${status ? `\n${status.label}` : ''}${
                          card.lockedTo ? `\nStays with ${card.lockedTo.name} (later round)` : ''
                        }${card.pending ? '\nWaiting to send' : ''}`}
                        className={`absolute z-[5] overflow-hidden rounded-md border border-l-[3px] px-2 text-left text-xs text-slate-100 transition-[box-shadow,opacity] hover:z-20 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                          tall ? 'py-1' : 'flex items-center'
                        } ${selected ? 'z-20 ring-2 ring-blue-500' : ''} ${ended || card.cancelled ? 'opacity-60' : ''}`}
                        style={{
                          top: top + 1,
                          height: Math.max(height - 2, 1),
                          left: `calc(${lane.lane * width}% + 3px)`,
                          width: `calc(${width}% - 6px)`,
                          borderColor: `${column.color}66`,
                          borderLeftColor: column.color,
                          background: `color-mix(in srgb, ${column.color} 16%, #0f172a)`
                        }}
                      >
                        {/* Its status, in the corner. */}
                        {status && (
                          <span
                            className="absolute top-0 right-0 h-0 w-0 border-t-[10px] border-l-[10px] border-l-transparent"
                            style={{ borderTopColor: status.color }}
                            aria-label={status.label}
                          />
                        )}
                        <span className="flex min-w-0 items-center gap-1.5">
                          {card.round && (
                            <span className="shrink-0 rounded border px-1 text-[10px] leading-4 font-semibold" style={{ borderColor: `${column.color}99` }}>
                              {card.round}
                            </span>
                          )}
                          <span className={`min-w-0 flex-1 truncate font-medium ${card.cancelled ? 'line-through' : ''}`}>{card.title}</span>
                          {card.pending && <span className="shrink-0 text-[10px] text-sky-300" aria-label="Waiting to send">⏳</span>}
                          {card.needsDetails && !card.cancelled && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500 ring-2 ring-amber-500/25" title="Needs company and role" aria-label="Needs company and role" />
                          )}
                        </span>
                        {tall && (
                          <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                            {when}
                            {card.company ? ` · ${card.company}` : ''}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
