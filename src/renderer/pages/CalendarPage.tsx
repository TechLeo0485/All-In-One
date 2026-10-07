import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
  type SyntheticEvent
} from 'react'
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
  EventSourceFuncArg,
  SlotLabelContentArg
} from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import type { CalendarEvent, LocalEventInput } from '@shared/types'
import { DEFAULT_EVENT_STATUSES, findStatus } from '@shared/eventStatus'
import { clampHourHeight, DEFAULT_HOUR_HEIGHT, HOUR_HEIGHT_STEP } from '@shared/hourHeight'
import { useAppStore } from '../stores/appStore'
import { useNow } from '../hooks/useNow'
import { DatePicker } from '../components/DatePicker'
import { gmtOffsetLabel, isValidTimeZone, systemTimeZone, wallFields, zonedWallTimeToUtc, zoneFormatter } from '@shared/timezone'
import { addDays, parseDateString, toDateString, zonedDateString } from '../utils/dates'
import { intlTimeZonePlugin } from '../utils/intlTimeZonePlugin'
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
    // FullCalendar gives instants (midnight in the primary zone); the picker wants calendar days.
    setRange({ start: parseDateString(zonedDateString(arg.view.currentStart)), end: parseDateString(zonedDateString(arg.view.currentEnd)) })
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

  // Primary zone drives the whole grid ('local' = the computer's zone); the secondary
  // one only adds a second time column in Week/Day views.
  const timeZone = fullCalendarZone(settings?.primaryTimeZone)
  const secondaryZone =
    settings?.showSecondaryTimeZone && settings.secondaryTimeZone && isValidTimeZone(settings.secondaryTimeZone)
      ? settings.secondaryTimeZone
      : ''
  const primaryLabel = settings?.primaryTimeZoneLabel ?? ''
  const secondaryLabel = settings?.secondaryTimeZoneLabel ?? ''
  const views = useMemo(
    () => buildViewOptions(timeZone, primaryLabel, secondaryZone, secondaryLabel),
    [timeZone, primaryLabel, secondaryZone, secondaryLabel]
  )

  const showLocal = settings?.showLocalEvents ?? true
  const localColor = settings?.localEventColor ?? '#10b981'

  const calendarRef = useRef<FullCalendar>(null)
  const { hourHeight, wrapperRef } = useHourHeight(settings?.hourHeight ?? DEFAULT_HOUR_HEIGHT, calendarRef)
  const eventContent = useMemo(() => eventContentRenderer(hourHeight), [hourHeight])
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
        ? { allDay: true, startTime: zonedDateString(arg.start), endTime: zonedDateString(arg.end) }
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
        startTime: event.allDay ? zonedDateString(start) : start.toISOString(),
        // FullCalendar drops `end` when it equals the default duration.
        endTime: event.allDay
          ? event.end
            ? zonedDateString(event.end)
            : addDays(zonedDateString(start), 1)
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
        ref={wrapperRef}
        className="relative h-full rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm"
        style={{ '--hour-height': `${hourHeight}px` } as CSSProperties}
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
                // As YYYY-MM-DD: a Date would be read as an instant in the primary zone.
                calendarRef.current?.getApi().gotoDate(toDateString(date))
                setPickerOpen(false)
              }}
            />
          </div>
        )}
        <FullCalendar
          ref={calendarRef}
          plugins={PLUGINS}
          timeZone={timeZone}
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
          views={views}
          eventContent={eventContent}
          eventClassNames={(arg) => [
            ...timeGridSizeClasses(arg, hourHeight),
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
const PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin, intlTimeZonePlugin]
const HEADER_TOOLBAR = { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }
const BUTTON_TEXT = { today: 'Today', month: 'Month', week: 'Week', day: 'Day' }
const TIME_FORMAT = { hour: 'numeric', minute: '2-digit', meridiem: 'short' } as const

/** FullCalendar's `timeZone` for the primary zone setting: 'local' unless another valid zone is picked. */
function fullCalendarZone(primary: string | undefined): string {
  return primary && primary !== systemTimeZone() && isValidTimeZone(primary) ? primary : 'local'
}

/**
 * Week/Day views: the top-left corner of the time axis shows the timezone (its label,
 * or "GMT-04"). FullCalendar only puts content there for week numbers, so we render
 * the zone instead. With a secondary zone, Google Calendar style: its times form a
 * second column left of the primary one, and the corner names both.
 */
function buildViewOptions(timeZone: string, primaryLabel: string, secondaryZone: string, secondaryLabel: string) {
  const primaryZone = timeZone === 'local' ? undefined : timeZone
  const zoneLabel = (date: Date, zone: string | undefined, label: string, className = ''): ReactElement => (
    <span className={`tz-col truncate ${className}`} title={zone ?? systemTimeZone()}>
      {label || gmtOffsetLabel(date, zone)}
    </span>
  )
  if (!secondaryZone) {
    return {
      timeGrid: {
        weekNumbers: true,
        weekNumberContent: (arg: { date: Date }) => zoneLabel(arg.date, primaryZone, primaryLabel)
      }
    }
  }
  const secondaryTime = timeFormatter(secondaryZone)
  return {
    timeGrid: {
      weekNumbers: true,
      weekNumberContent: (arg: { date: Date }) => (
        <span className="tz-cols">
          {zoneLabel(arg.date, secondaryZone, secondaryLabel, 'tz-secondary')}
          {zoneLabel(arg.date, primaryZone, primaryLabel)}
        </span>
      ),
      slotLabelContent: (arg: SlotLabelContentArg) => (
        <span className="tz-cols">
          <span className="tz-col tz-secondary">{secondaryTime(slotInstant(arg, primaryZone))}</span>
          <span className="tz-col">{arg.text}</span>
        </span>
      )
    }
  }
}

/**
 * The moment an hour label stands for, taken on today's date in the primary zone.
 * (FullCalendar's own `arg.date` is on 1970-01-01, where DST differs from today,
 * which put the secondary times an hour off for half the year.)
 */
function slotInstant(arg: SlotLabelContentArg, primaryZone: string | undefined): Date {
  const ms = arg.time.milliseconds + arg.time.days * 86_400_000
  const hour = Math.floor(ms / 3_600_000)
  const minute = Math.floor((ms % 3_600_000) / 60_000)
  const fmt = primaryZone ? zoneFormatter(primaryZone) : null
  const now = new Date()
  if (!fmt) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
  const [y, mo, d] = wallFields(now.getTime(), fmt)
  return new Date(zonedWallTimeToUtc(fmt, y, mo, d, hour, minute))
}

/** Times in `zone` styled like FullCalendar's TIME_FORMAT labels ("9:00am", or "09:00" in 24h locales). */
function timeFormatter(zone: string): (date: Date) => string {
  const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone })
  return (date) =>
    fmt
      .format(date)
      .replace(/‎/g, '')
      .replace(/\s*([ap])\.?m\.?/i, (_, a: string) => `${a.toLowerCase()}m`)
}

/** Week/Day events under 45px tall have room for one line only. */
const SINGLE_LINE_PX = 45
/** Under 30px the padding and font shrink too. */
const TINY_PX = 30
/** From 75px the title may take two lines. */
const TWO_LINE_TITLE_PX = 75

/**
 * Hour height of Week/Day views: the saved setting, changed live by Ctrl + mouse wheel
 * over the calendar (saved once the wheel stops). Zooming keeps the time under the
 * pointer in place.
 */
function useHourHeight(saved: number, calendarRef: RefObject<FullCalendar | null>) {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [hourHeight, setHourHeight] = useState(saved)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const current = useRef(hourHeight)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Scroll position to restore after a zoom step: [scroller, time-under-pointer anchor]. */
  const pendingScroll = useRef<{ scroller: HTMLElement; offsetY: number; ratio: number } | null>(null)

  // Follow the setting (Settings slider), except while a wheel zoom is still unsaved.
  useEffect(() => {
    if (!saveTimer.current) setHourHeight(saved)
  }, [saved])

  // The slot height comes from CSS, so FullCalendar must re-measure to place events.
  useLayoutEffect(() => {
    current.current = hourHeight
    calendarRef.current?.getApi().updateSize()
    const pending = pendingScroll.current
    if (pending) {
      const { scroller, offsetY, ratio } = pending
      scroller.scrollTop = (scroller.scrollTop + offsetY) * ratio - offsetY
      pendingScroll.current = null
    }
  }, [hourHeight, calendarRef])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || e.deltaY === 0) return
      const body = (e.target as Element).closest('.fc-timegrid-body')
      const scroller = body?.closest<HTMLElement>('.fc-scroller')
      if (!scroller) return
      e.preventDefault() // no page zoom
      const prev = current.current
      const next = clampHourHeight(prev + (e.deltaY < 0 ? HOUR_HEIGHT_STEP : -HOUR_HEIGHT_STEP))
      if (next === prev) return
      const offsetY = e.clientY - scroller.getBoundingClientRect().top
      // Several wheel steps can arrive before React renders: combine their zoom ratios.
      const ratio = (pendingScroll.current?.ratio ?? 1) * (next / prev)
      pendingScroll.current = { scroller, offsetY, ratio }
      current.current = next
      setHourHeight(next)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null
        void updateSettings({ hourHeight: current.current })
      }, 500)
    }
    wrapper.addEventListener('wheel', onWheel, { passive: false })
    return () => wrapper.removeEventListener('wheel', onWheel)
  }, [updateSettings])

  // Leaving the page mid-zoom still saves it.
  useEffect(
    () => () => {
      if (!saveTimer.current) return
      clearTimeout(saveTimer.current)
      void updateSettings({ hourHeight: current.current })
    },
    [updateSettings]
  )

  return { hourHeight, wrapperRef }
}

function durationMinutes(arg: { event: EventContentArg['event'] }): number {
  const { start, end } = arg.event
  if (!start) return 60
  return ((end ?? new Date(start.getTime() + 60 * 60_000)).getTime() - start.getTime()) / 60_000
}

function isTimedTimeGridEvent(arg: { event: EventContentArg['event']; view: EventContentArg['view'] }): boolean {
  return arg.view.type.startsWith('timeGrid') && !arg.event.allDay
}

/** Height in px of a Week/Day event at the given hour height. */
function eventHeightPx(arg: { event: EventContentArg['event'] }, hourHeight: number): number {
  return (durationMinutes(arg) * hourHeight) / 60
}

function timeGridSizeClasses(arg: { event: EventContentArg['event']; view: EventContentArg['view'] }, hourHeight: number): string[] {
  if (!isTimedTimeGridEvent(arg)) return []
  const px = eventHeightPx(arg, hourHeight)
  if (px < TINY_PX) return ['event-tiny']
  if (px < SINGLE_LINE_PX) return ['event-single-line']
  return []
}

/**
 * Week/Day events, Google Calendar style: title first, then the time. Short events
 * get one line ("Interview, 9:00am"), longer ones the full range on a second line.
 * Month view keeps FullCalendar's default rendering.
 */
function eventContentRenderer(hourHeight: number) {
  return (arg: EventContentArg): ReactElement | true => renderEventContent(arg, hourHeight)
}

function renderEventContent(arg: EventContentArg, hourHeight: number): ReactElement | true {
  if (!isTimedTimeGridEvent(arg)) return true
  const { title, start } = arg.event
  const px = eventHeightPx(arg, hourHeight)
  if (px < SINGLE_LINE_PX) {
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
      {title && <div className={`font-medium ${px >= TWO_LINE_TITLE_PX ? 'line-clamp-2' : 'truncate'}`}>{title}</div>}
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
