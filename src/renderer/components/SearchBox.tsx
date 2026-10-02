import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { EventSearchResult, SearchMatchField } from '@shared/types'
import { findMatches, searchTerms } from '@shared/search'
import { useAppStore } from '../stores/appStore'
import { formatEventWhen } from '../utils/dates'
import { errorMessage } from '../utils/errors'
import { SearchIcon, XIcon } from './icons'
import { ColorDot, Spinner } from './ui'

/** Wait for a pause in typing before querying. */
const DEBOUNCE_MS = 200
/** The main process returns at most this many (see eventRepository.search). */
const MAX_RESULTS = 50

const FIELD_LABEL: Record<SearchMatchField, string> = {
  title: '',
  location: 'Location',
  guests: 'Guests',
  description: 'Description',
  notes: 'Your notes',
  calendar: 'Calendar'
}

/** `text` with the parts that match the search words in bold. */
function Highlight({ text, terms }: { text: string; terms: string[] }): ReactNode {
  const ranges = findMatches(text, terms)
  if (ranges.length === 0) return text
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className="rounded-sm bg-amber-400/25 text-amber-100">
        {text.slice(start, end)}
      </mark>
    )
    at = end
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

/**
 * One search box for all event fields (title, description, location, guests, notes,
 * calendar). Results open in a panel next to the sidebar; picking one jumps to the
 * event in the calendar and opens its details. Ctrl+F focuses the box.
 */
export function SearchBox() {
  const calendars = useAppStore((s) => s.calendars)
  const settings = useAppStore((s) => s.settings)
  const openEvent = useAppStore((s) => s.openEvent)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EventSearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const terms = useMemo(() => searchTerms(query), [query])
  const termsKey = terms.join(' ')

  // Query after a pause in typing; a newer query makes older answers irrelevant.
  useEffect(() => {
    if (!termsKey) {
      setResults(null)
      setLoading(false)
      setError(null)
      return
    }
    let current = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      window.api.events.search(termsKey).then(
        (found) => {
          if (!current) return
          setResults(found)
          setError(null)
          setActive(0)
          setLoading(false)
        },
        (err) => {
          if (!current) return
          setError(errorMessage(err))
          setLoading(false)
        }
      )
    }, DEBOUNCE_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [termsKey])

  // Ctrl+F (or Ctrl+K) from anywhere in the app focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Clicking anywhere else closes the panel (the text stays, focusing reopens it).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Only what the calendar shows: hidden calendars and hidden local events are left out.
  const colors = useMemo(() => {
    const hidden = new Set(settings?.hiddenCalendarIds ?? [])
    return new Map(calendars.filter((c) => c.enabled && !hidden.has(c.id)).map((c) => [c.id, c.color]))
  }, [calendars, settings?.hiddenCalendarIds])
  const showLocal = settings?.showLocalEvents ?? true
  const localColor = settings?.localEventColor ?? '#10b981'
  const colorOf = (r: EventSearchResult): string | undefined =>
    r.event.isLocalEvent ? (showLocal ? (r.event.color ?? localColor) : undefined) : colors.get(r.event.calendarId ?? '')
  const visible = (results ?? []).filter((r) => colorOf(r) !== undefined)

  const nowIso = new Date().toISOString()
  const isPast = (r: EventSearchResult): boolean =>
    r.event.allDay ? r.event.endTime <= nowIso.slice(0, 10) : r.event.endTime <= nowIso
  const firstPast = visible.findIndex(isPast)

  const choose = (r: EventSearchResult): void => {
    openEvent({ eventId: r.event.id, startTime: r.event.startTime })
    setOpen(false)
    inputRef.current?.blur()
  }

  // Keep the keyboard-selected result in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (visible.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length)
    } else if (e.key === 'Enter') {
      const r = visible[active]
      if (r) choose(r)
    } else if (e.key === 'Escape') {
      if (open && query) setOpen(false)
      else {
        setQuery('')
        inputRef.current?.blur()
      }
    }
  }

  const showPanel = open && termsKey !== ''

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search events  (Ctrl+F)"
          spellCheck={false}
          className="w-full rounded-md border border-slate-700 bg-slate-950 py-1.5 pr-7 pl-8 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          aria-label="Search events"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-slate-300"
            aria-label="Clear search"
          >
            <XIcon size={14} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute top-0 left-full z-40 ml-3 flex max-h-[75vh] w-[30rem] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
            {loading && <Spinner />}
            {error
              ? <span className="text-red-400">Search failed: {error}</span>
              : results === null
                ? 'Searching…'
                : visible.length === 0
                  ? `No events match “${query.trim()}”`
                  : `${visible.length}${results.length >= MAX_RESULTS ? '+' : ''} ${visible.length === 1 ? 'event' : 'events'} · title, description, location, guests, notes`}
          </div>
          {visible.length > 0 && (
            <ul ref={listRef} className="overflow-y-auto py-1">
              {visible.map((r, i) => (
                <li key={r.event.id} data-index={i}>
                  {i === firstPast && (
                    <p className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Past</p>
                  )}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r)}
                    className={`flex w-full items-start gap-3 px-4 py-2 text-left ${i === active ? 'bg-slate-800' : ''}`}
                  >
                    <span className="mt-1.5">
                      <ColorDot color={colorOf(r)!} size={10} />
                    </span>
                    <span className={`min-w-0 flex-1 ${isPast(r) ? 'opacity-70' : ''}`}>
                      <span className="block truncate text-sm font-medium text-slate-100">
                        <Highlight text={r.event.title} terms={terms} />
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {formatEventWhen(r.event)}
                        {r.occurrences > 1 && ` · repeats, ${r.occurrences} matching dates`}
                        {' · '}
                        {r.event.isLocalEvent ? 'Local event' : (r.calendarName ?? 'Calendar')}
                      </span>
                      {r.snippet && (
                        <span className="mt-0.5 block truncate text-xs text-slate-300">
                          <span className="text-slate-500">{FIELD_LABEL[r.matchedIn]}: </span>
                          <Highlight text={r.snippet} terms={terms} />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results !== null && results.length >= MAX_RESULTS && (
            <p className="border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
              Showing the first {MAX_RESULTS}. Type more words to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
