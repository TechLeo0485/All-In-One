import { useEffect, useMemo, useState, type DragEvent } from 'react'
import type { CalendarEvent } from '@shared/types'
import { DEFAULT_EVENT_STATUSES, FOLLOW_UP_ID } from '@shared/eventStatus'
import { useAppStore } from '../stores/appStore'
import { useNow } from '../hooks/useNow'
import { formatInDisplayZone } from '../utils/dates'
import { errorMessage } from '../utils/errors'
import { companyOf, daysFromToday, formatCardDate, formatDayAge, startMs } from '../utils/pipeline'
import { BellIcon, CalendarIcon, ClockIcon, SearchIcon } from '../components/icons'
import { ColorDot, inputClass, Spinner } from '../components/ui'

/** A Follow-Up older than this, with no reminder pending, gets an amber age. */
const STALE_FOLLOW_UP_DAYS = 7
const DRAG_TYPE = 'application/x-all-in-one-event'
const PERIOD_KEY = 'pipeline.period'

const PERIODS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 3 months' },
  { value: '365', label: 'Last 12 months' },
  { value: 'all', label: 'All time' }
] as const
type Period = (typeof PERIODS)[number]['value']

interface Card {
  event: CalendarEvent
  company: string | null
  calendarName: string
  color: string
  note: string | undefined
  /** "Round 2 of 3" when the same company has several events */
  round: { index: number; of: number } | null
}

interface Data {
  withStatus: CalendarEvent[]
  notes: Record<string, string>
}

/**
 * Pipeline: every event with a status, as a board with a column per status (in the
 * Settings order). Drag a card to another column to change its status; click it for
 * the details panel. Built for tracking interviews: the company
 * is guessed from the organizer's email domain.
 */
export function PipelinePage() {
  const settings = useAppStore((s) => s.settings)
  const calendars = useAppStore((s) => s.calendars)
  const eventsVersion = useAppStore((s) => s.eventsVersion)
  const selectedEventId = useAppStore((s) => s.selectedEventId)
  const selectEvent = useAppStore((s) => s.selectEvent)
  const setEventStatus = useAppStore((s) => s.setEventStatus)
  const notify = useAppStore((s) => s.notify)
  // Events keep ending while the page is open.
  const tick = useNow(5 * 60_000)

  const [data, setData] = useState<Data | null>(null)
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<Period>(() => (localStorage.getItem(PERIOD_KEY) as Period | null) ?? '90')
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  // Notes aren't part of eventsVersion: reload when the details panel opens or closes too.
  const detailsOpen = selectedEventId !== null
  useEffect(() => {
    let current = true
    void (async () => {
      const withStatus = await window.api.events.listWithStatus()
      const notes = await window.api.notes.previews(withStatus.map((e) => e.id))
      if (current) setData({ withStatus, notes })
    })().catch((err) => notify(`Could not load the pipeline: ${errorMessage(err)}`, 'error'))
    return () => {
      current = false
    }
  }, [eventsVersion, tick, detailsOpen, notify])

  const statuses = settings?.eventStatuses ?? DEFAULT_EVENT_STATUSES
  const localColor = settings?.localEventColor ?? '#10b981'

  const cards = useMemo(() => {
    if (!data) return null
    const byId = new Map(calendars.map((c) => [c.id, c]))
    const toCard = (event: CalendarEvent): Card | null => {
      const calendar = event.calendarId ? byId.get(event.calendarId) : undefined
      // Events of removed or switched-off calendars stay out, like in the calendar.
      if (!event.isLocalEvent && !calendar?.enabled) return null
      return {
        event,
        company: companyOf(event),
        calendarName: calendar?.name ?? 'Local event',
        color: event.isLocalEvent ? (event.color ?? localColor) : (calendar?.color ?? '#64748b'),
        note: data.notes[event.id],
        round: null
      }
    }
    const all = data.withStatus.flatMap((e) => toCard(e) ?? [])
    // Several events with one company are rounds of the same process.
    const byCompany = new Map<string, Card[]>()
    for (const card of all) if (card.company) byCompany.set(card.company, [...(byCompany.get(card.company) ?? []), card])
    for (const group of byCompany.values()) {
      if (group.length < 2) continue
      group.sort((a, b) => startMs(a.event) - startMs(b.event))
      group.forEach((card, i) => (card.round = { index: i + 1, of: group.length }))
    }
    return all
  }, [data, calendars, localColor])

  const visible = useMemo(() => {
    if (!cards) return null
    const from = period === 'all' ? -Infinity : Date.now() - Number(period) * 86_400_000
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return cards.filter((card) => {
      if (startMs(card.event) < from) return false
      if (!terms.length) return true
      const text = [card.event.title, card.company, card.calendarName, card.note, card.event.location].join(' ').toLowerCase()
      return terms.every((t) => text.includes(t))
    })
  }, [cards, period, query])

  const columns = useMemo(() => {
    const list = visible ?? []
    const newestFirst = (a: Card, b: Card): number => startMs(b.event) - startMs(a.event)
    return statuses.map((s) => ({ ...s, cards: list.filter((c) => c.event.status === s.id).sort(newestFirst) }))
  }, [visible, statuses])

  const onDrop = (e: DragEvent, columnId: string): void => {
    e.preventDefault()
    setDropTarget(null)
    const id = e.dataTransfer.getData(DRAG_TYPE)
    const card = cards?.find((c) => c.event.id === id)
    if (!card) return
    if (card.event.status !== columnId) void setEventStatus(id, columnId)
  }

  return (
    <div className="flex h-full flex-col gap-4 p-2 lg:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-xl font-semibold">Pipeline</h1>
          <p className="text-sm text-slate-400">Your events by outcome. Drag a card to change its status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by company, title, notes…"
              aria-label="Filter the pipeline"
              spellCheck={false}
              className={`${inputClass} w-64! pl-8!`}
            />
          </div>
          <select
            className={`${inputClass} w-auto!`}
            value={period}
            aria-label="Period"
            onChange={(e) => {
              const value = e.target.value as Period
              localStorage.setItem(PERIOD_KEY, value)
              setPeriod(value)
            }}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {!visible ? (
        <div className="flex flex-1 items-center justify-center text-slate-500">
          <Spinner />
        </div>
      ) : (
        <>
          <PipelineStats columns={columns} />
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
            {columns.map((column) => (
              <section
                key={column.id}
                aria-label={column.label}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropTarget(column.id)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
                }}
                onDrop={(e) => onDrop(e, column.id)}
                // Columns share the full width and shrink when the details panel opens, like the
                // calendar; only below their minimum width (many statuses) does the board scroll.
                className={`flex min-w-44 flex-1 basis-0 flex-col rounded-xl border bg-slate-900/60 transition-colors ${
                  dropTarget === column.id ? 'border-blue-500/70 bg-blue-500/5' : 'border-slate-800'
                }`}
              >
                <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2.5">
                  <ColorDot color={column.color} size={8} />
                  <h2 className="flex-1 truncate text-sm font-semibold text-slate-200">{column.label}</h2>
                  <span className="rounded-full bg-slate-800 px-2 py-px text-xs text-slate-400 tabular-nums">{column.cards.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {column.cards.map((card) => (
                    <PipelineCard
                      key={card.event.id}
                      card={card}
                      selected={card.event.id === selectedEventId}
                      onOpen={() => selectEvent(card.event.id)}
                    />
                  ))}
                  {column.cards.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-slate-600">Drop events here</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Totals above the board: with a status, pass rate (when Passed/Failed exist), awaiting a follow-up. */
function PipelineStats({ columns }: { columns: { id: string; label: string; cards: Card[] }[] }) {
  const count = (id: string): number | undefined => columns.find((c) => c.id === id)?.cards.length
  const withStatus = columns.reduce((n, c) => n + c.cards.length, 0)
  const passed = count('passed')
  const failed = count('failed')
  const awaiting = count(FOLLOW_UP_ID)
  const decided = (passed ?? 0) + (failed ?? 0)

  const tiles: { label: string; value: string; hint?: string; style?: string }[] = [{ label: 'With a status', value: String(withStatus) }]
  if (passed !== undefined && failed !== undefined) {
    tiles.push({
      label: 'Pass rate',
      value: decided ? `${Math.round(((passed ?? 0) / decided) * 100)}%` : '–',
      hint: decided ? `${passed} of ${decided} decided` : 'No results yet',
      style: 'text-emerald-400'
    })
  }
  if (awaiting !== undefined) tiles.push({ label: 'Follow-up', value: String(awaiting), style: 'text-amber-400' })

  return (
    <div className="flex flex-wrap gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-32 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
          <div className="text-[10px] tracking-wide text-slate-500 uppercase">{t.label}</div>
          <div className={`text-xl leading-tight font-semibold tabular-nums ${t.style ?? 'text-slate-100'}`}>{t.value}</div>
          {t.hint && <div className="text-[11px] text-slate-500">{t.hint}</div>}
        </div>
      ))}
    </div>
  )
}

function PipelineCard({
  card,
  selected,
  onOpen
}: {
  card: Card
  selected: boolean
  onOpen: () => void
}) {
  const openEvent = useAppStore((s) => s.openEvent)
  const { event, company, calendarName, color, note, round } = card
  const days = daysFromToday(event)
  const staleFollowUp = event.status === FOLLOW_UP_ID && days <= -STALE_FOLLOW_UP_DAYS && !(event.followUpAt && !event.followUpReminded)

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, event.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      className={`group cursor-pointer rounded-lg border bg-slate-900 p-3 shadow-sm transition-colors hover:border-slate-600 ${
        selected ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-slate-800'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <ColorDot color={color} size={6} />
        <span className="min-w-0 flex-1 truncate font-medium text-slate-300">{company ?? calendarName}</span>
        {round && (
          <span className="shrink-0 rounded bg-slate-800 px-1.5 py-px text-[10px] text-slate-400" title={`Event ${round.index} of ${round.of} with ${company}`}>
            Round {round.index}/{round.of}
          </span>
        )}
      </div>
      <h3 className="mt-1 line-clamp-2 text-sm leading-snug font-medium text-slate-100">{event.title || '(No title)'}</h3>
      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500">
        <ClockIcon size={11} className="shrink-0" />
        <span className="truncate">
          {formatCardDate(event)} ·{' '}
          <span className={staleFollowUp ? 'text-amber-300/90' : undefined} title={staleFollowUp ? 'Follow-Up for a while: time to check in?' : undefined}>
            {formatDayAge(days)}
          </span>
        </span>
      </div>
      {note && <p className="mt-1.5 line-clamp-2 text-xs text-slate-400 italic">“{note}”</p>}
      {event.followUpAt && (
        <div className={`mt-1.5 flex items-center gap-1 text-[11px] ${event.followUpReminded ? 'text-slate-500' : 'text-amber-300/90'}`}>
          <BellIcon size={11} className="shrink-0" />
          {event.followUpReminded ? 'Reminded ' : 'Remind '}
          {formatInDisplayZone(new Date(event.followUpAt), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          openEvent({ eventId: event.id, startTime: event.startTime })
        }}
        className="mt-2 hidden items-center gap-1 text-[11px] text-blue-400 group-hover:flex hover:underline"
        title={calendarName}
      >
        <CalendarIcon size={11} /> Show in calendar
      </button>
    </article>
  )
}
