import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type SyntheticEvent } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventSourceFuncArg
} from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import type { CalendarEvent, LocalEventInput } from '@shared/types'
import { DEFAULT_EVENT_STATUSES, findStatus } from '@shared/eventStatus'
import { useAppStore } from '../stores/appStore'
import { useNow } from '../hooks/useNow'
import { DatePicker } from '../components/DatePicker'
import { toDateString } from '../utils/dates'
import { errorMessage } from '../utils/errors'

/**
 * Combined calendar view. Events are pulled per visible range from SQLite via IPC
 * (FullCalendar calls `fetchEvents` whenever the range changes).
 *
 * The fetch function is kept stable and reads the current visibility/colors from
 * a ref; when those or `eventsVersion` change we call refetchEvents() explicitly.
 * (Passing a new function on every change makes FullCalendar swap event sources,
 * which can drop results when several changes arrive in quick succession.)
 */
export function CalendarPage() {
  const calendars = useAppStore((s) => s.calendars)
  const settings = useAppStore((s) => s.settings)
  const eventsVersion = useAppStore((s) => s.eventsVersion)
  const selectedEventId = useAppStore((s) => s.selectedEventId)
  const selectEvent = useAppStore((s) => s.selectEvent)
  const openEventEditor = useAppStore((s) => s.openEventEditor)
  const askRecurrenceScope = useAppStore((s) => s.askRecurrenceScope)
  const notify = useAppStore((s) => s.notify)
  const refreshEvents = useAppStore((s) => s.refreshEvents)
  // Re-renders every minute so events darken as soon as they end.
  const now = useNow(60_000)

  // Clicking the title ("Sep 27 – Oct 3, 2026") opens a date picker to jump anywhere.
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const closePicker = useCallback(() => setPickerOpen(false), [])
  const onDatesSet = (arg: DatesSetArg): void => {
    localStorage.setItem(VIEW_STORAGE_KEY, arg.view.type)
    setRange({ start: arg.view.currentStart, end: arg.view.currentEnd })
    // FullCalendar renders the title; make it reachable by keyboard and explain it.
    const title = document.querySelector<HTMLElement>(TITLE_SELECTOR)
    if (title) {
      title.setAttribute('role', 'button')
      title.setAttribute('tabindex', '0')
      title.title = 'Pick a date'
    }
  }
  const onTitleActivate = (e: SyntheticEvent): void => {
    const isTitle = (e.target as Element).closest(TITLE_SELECTOR)
    if (!isTitle) return
    if (e.type === 'keydown' && !['Enter', ' '].includes((e as KeyboardEvent).key)) return
    e.preventDefault()
    setPickerOpen((open) => !open)
  }

  // [calendarId, color] of enabled + visible calendars, as a string so that new but
  // equal arrays (after a sync or an unrelated settings change) don't trigger a refetch.
  const visibleKey = useMemo(() => {
    const hidden = new Set(settings?.hiddenCalendarIds ?? [])
    return JSON.stringify(calendars.filter((c) => c.enabled && !hidden.has(c.id)).map((c) => [c.id, c.color]))
  }, [calendars, settings?.hiddenCalendarIds])
  const visibleCalendars = useMemo(() => new Map<string, string>(JSON.parse(visibleKey)), [visibleKey])

  // Outline color per status: events get a `status-<id>` class (ids and colors are
  // validated in main, so they are safe in CSS); the outline itself is in index.css.
  const statuses = settings?.eventStatuses ?? DEFAULT_EVENT_STATUSES
  const statusCss = useMemo(
    () => statuses.map((s) => `.fc .fc-event.status-${s.id} { --event-status-color: ${s.color}; }`).join('\n'),
    [statuses]
  )

  const showLocal = settings?.showLocalEvents ?? true
  const localColor = settings?.localEventColor ?? '#10b981'

  const calendarRef = useRef<FullCalendar>(null)
  const filtersRef = useRef({ visibleCalendars, showLocal, localColor })
  const mounted = useRef(false)

  useEffect(() => {
    filtersRef.current = { visibleCalendars, showLocal, localColor }
    // On mount FullCalendar fetches by itself.
    if (mounted.current) calendarRef.current?.getApi().refetchEvents()
    mounted.current = true
  }, [eventsVersion, visibleCalendars, showLocal, localColor])

  // Opened from a reminder / the tray: jump to the event's date once, then clear it so
  // coming back to this page later doesn't jump again.
  const focusDate = useAppStore((s) => s.focusDate)
  useEffect(() => {
    if (!focusDate) return
    calendarRef.current?.getApi().gotoDate(focusDate.date)
    useAppStore.setState({ focusDate: null })
  }, [focusDate])

  const fetchEvents = useCallback(
    (info: EventSourceFuncArg, success: (events: EventInput[]) => void, failure: (error: Error) => void) => {
      window.api.events
        .listInRange(info.start.toISOString(), info.end.toISOString())
        .then((events) => {
          const { visibleCalendars, showLocal, localColor } = filtersRef.current
          success(
            events.flatMap((e): EventInput[] => {
              const color = e.isLocalEvent
                ? showLocal
                  ? (e.color ?? localColor)
                  : undefined
                : visibleCalendars.get(e.calendarId ?? '')
              return color ? [toFullCalendarEvent(e, color)] : []
            })
          )
        })
        .catch((err) => {
          notify(`Could not load events: ${errorMessage(err)}`, 'error')
          failure(err instanceof Error ? err : new Error(String(err)))
        })
    },
    [notify]
  )

  const onSelect = (arg: DateSelectArg): void => {
    arg.view.calendar.unselect()
    openEventEditor({
      mode: 'create',
      defaults: arg.allDay
        ? { allDay: true, startTime: toDateString(arg.start), endTime: toDateString(arg.end) }
        : { allDay: false, startTime: arg.start.toISOString(), endTime: arg.end.toISOString() }
    })
  }

  const onEventClick = (arg: EventClickArg): void => {
    arg.jsEvent.preventDefault()
    selectEvent(arg.event.id)
  }

  /** Drag or resize of a local event (synced events are not editable). */
  const onEventChange = async (arg: EventDropArg | EventResizeDoneArg): Promise<void> => {
    const { event } = arg
    try {
      const existing = await window.api.events.get(event.id)
      if (!existing?.isLocalEvent || !event.start) throw new Error('Only local events can be moved')
      const start = event.start
      const input: LocalEventInput = {
        title: existing.title,
        description: existing.description,
        location: existing.location,
        color: existing.color, // keep "default" as default, so it still follows Settings
        reminderMinutes: existing.reminderMinutes,
        recurrence: existing.recurrence,
        allDay: event.allDay,
        startTime: event.allDay ? toDateString(start) : start.toISOString(),
        // FullCalendar drops `end` when it equals the default duration.
        endTime: event.allDay
          ? toDateString(event.end ?? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1))
          : (event.end ?? new Date(start.getTime() + 60 * 60_000)).toISOString()
      }
      // A date of a repeating event: move just it, it and later ones, or the whole series.
      const scope = existing.seriesId ? await askRecurrenceScope('edit') : undefined
      if (scope === null) return arg.revert()
      await window.api.events.updateLocal(event.id, input, scope)
      refreshEvents()
    } catch (err) {
      arg.revert()
      notify(`Could not move event: ${errorMessage(err)}`, 'error')
    }
  }

  return (
    <div className="h-full p-4">
      <div
        className="relative h-full rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm"
        onClick={onTitleActivate}
        onKeyDown={onTitleActivate}
      >
        <style>{statusCss}</style>
        {pickerOpen && range && (
          <div className="absolute top-14 left-1/2 z-30 -translate-x-1/2">
            <DatePicker
              rangeStart={range.start}
              rangeEnd={range.end}
              toggleSelector={TITLE_SELECTOR}
              onClose={closePicker}
              onPick={(date) => {
                calendarRef.current?.getApi().gotoDate(date)
                setPickerOpen(false)
              }}
            />
          </div>
        )}
        <FullCalendar
          ref={calendarRef}
          plugins={PLUGINS}
          initialView={initialView()}
          datesSet={onDatesSet}
          eventDrop={(arg) => void onEventChange(arg)}
          eventResize={(arg) => void onEventChange(arg)}
          headerToolbar={HEADER_TOOLBAR}
          buttonText={BUTTON_TEXT}
          height="100%"
          events={fetchEvents}
          eventClick={onEventClick}
          selectable
          selectMirror
          select={onSelect}
          nowIndicator
          dayMaxEvents
          scrollTime="08:00:00"
          eventTimeFormat={TIME_FORMAT}
          slotLabelFormat={TIME_FORMAT}
          views={VIEW_OPTIONS}
          eventContent={renderEventContent}
          eventClassNames={(arg) => [
            ...timeGridSizeClasses(arg),
            ...(arg.event.id === selectedEventId ? ['ring-2', 'ring-white', 'ring-offset-1', 'ring-offset-slate-900'] : []),
            // Not FullCalendar's own isPast: that is only recomputed occasionally, not every minute.
            ...(isEnded(arg.event.end ?? arg.event.start, now) ? ['event-ended'] : []),
            // Only events with a picked status get an outline.
            ...[findStatus(statuses, arg.event.extendedProps.status as string | null)].flatMap((s) => (s ? [`status-${s.id}`] : []))
          ]}
        />
      </div>
    </div>
  )
}

// Kept outside the component: FullCalendar re-applies options whose identity changes.
const PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin]
const HEADER_TOOLBAR = { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }
const BUTTON_TEXT = { today: 'Today', month: 'Month', week: 'Week', day: 'Day' }
const TIME_FORMAT = { hour: 'numeric', minute: '2-digit', meridiem: 'short' } as const

/**
 * Week/Day views: the top-left corner of the time axis shows the timezone ("GMT-04").
 * FullCalendar only puts content there for week numbers, so we render the zone instead.
 */
const VIEW_OPTIONS = {
  timeGrid: {
    weekNumbers: true,
    weekNumberContent: (arg: { date: Date }) => (
      <span title={Intl.DateTimeFormat().resolvedOptions().timeZone}>{gmtOffsetLabel(arg.date)}</span>
    )
  }
}

/** "GMT-04", "GMT+05:30" — the local offset on `date` (it changes with DST). */
function gmtOffsetLabel(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const abs = Math.abs(offset)
  const minutes = abs % 60
  return `GMT${offset < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`
}

/** Week/Day events at 60px per hour: under 45 minutes there is room for one line only. */
const SINGLE_LINE_MINUTES = 45
/** Under 30 minutes (< 30px tall) the padding and font shrink too. */
const TINY_MINUTES = 30

function durationMinutes(arg: { event: EventContentArg['event'] }): number {
  const { start, end } = arg.event
  if (!start) return 60
  return ((end ?? new Date(start.getTime() + 60 * 60_000)).getTime() - start.getTime()) / 60_000
}

function isTimedTimeGridEvent(arg: { event: EventContentArg['event']; view: EventContentArg['view'] }): boolean {
  return arg.view.type.startsWith('timeGrid') && !arg.event.allDay
}

function timeGridSizeClasses(arg: { event: EventContentArg['event']; view: EventContentArg['view'] }): string[] {
  if (!isTimedTimeGridEvent(arg)) return []
  const minutes = durationMinutes(arg)
  if (minutes < TINY_MINUTES) return ['event-tiny']
  if (minutes < SINGLE_LINE_MINUTES) return ['event-single-line']
  return []
}

/**
 * Week/Day events, Google Calendar style: title first, then the time. Short events
 * get one line ("Interview, 9:00am"), longer ones the full range on a second line.
 * Month view keeps FullCalendar's default rendering.
 */
function renderEventContent(arg: EventContentArg): ReactElement | true {
  if (!isTimedTimeGridEvent(arg)) return true
  const { title, start } = arg.event
  const minutes = durationMinutes(arg)
  if (minutes < SINGLE_LINE_MINUTES) {
    const startText = start ? arg.view.calendar.formatDate(start, TIME_FORMAT) : ''
    return (
      <div className="truncate">
        {title ? <span className="font-medium">{title}</span> : null}
        {title && startText ? ', ' : null}
        {startText}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {title && <div className={`font-medium ${minutes >= 75 ? 'line-clamp-2' : 'truncate'}`}>{title}</div>}
      <div className="truncate opacity-85">{arg.timeText}</div>
    </div>
  )
}

const VIEW_STORAGE_KEY = 'calendar.view'
const TITLE_SELECTOR = '.fc-toolbar-title'
const VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay']

/** Restores the last used Month/Week/Day view. */
function initialView(): string {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY)
  return saved && VIEWS.includes(saved) ? saved : 'timeGridWeek'
}

/** All-day ends are exclusive local midnights, so a full-day event ends when the day does. */
function isEnded(end: Date | null, now: number): boolean {
  return end !== null && end.getTime() <= now
}

function toFullCalendarEvent(e: CalendarEvent, color: string): EventInput {
  return {
    id: e.id,
    title: e.title,
    start: e.startTime,
    end: e.endTime,
    allDay: e.allDay,
    // Only local events can be dragged/resized; Proton events are read-only.
    editable: e.isLocalEvent,
    backgroundColor: color,
    borderColor: color,
    extendedProps: { status: e.status }
  }
}
