import { useCallback, useEffect, useMemo, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, EventClickArg, EventDropArg, EventInput, EventSourceFuncArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import type { CalendarEvent, LocalEventInput } from '@shared/types'
import { useAppStore } from '../stores/appStore'
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
  const notify = useAppStore((s) => s.notify)
  const refreshEvents = useAppStore((s) => s.refreshEvents)

  // calendarId -> color, only for enabled + visible calendars
  const visibleCalendars = useMemo(() => {
    const hidden = new Set(settings?.hiddenCalendarIds ?? [])
    return new Map(calendars.filter((c) => c.enabled && !hidden.has(c.id)).map((c) => [c.id, c.color]))
  }, [calendars, settings?.hiddenCalendarIds])

  const showLocal = settings?.showLocalEvents ?? true
  const localColor = settings?.localEventColor ?? '#10b981'

  const calendarRef = useRef<FullCalendar>(null)
  const filtersRef = useRef({ visibleCalendars, showLocal, localColor })

  useEffect(() => {
    filtersRef.current = { visibleCalendars, showLocal, localColor }
    calendarRef.current?.getApi().refetchEvents()
  }, [eventsVersion, visibleCalendars, showLocal, localColor])

  // Opened from a reminder / the tray: jump to the event's date (seq re-triggers repeats).
  const focusDate = useAppStore((s) => s.focusDate)
  useEffect(() => {
    if (focusDate) calendarRef.current?.getApi().gotoDate(focusDate.date)
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
        color: existing.color ?? localColor,
        reminderMinutes: existing.reminderMinutes,
        allDay: event.allDay,
        startTime: event.allDay ? toDateString(start) : start.toISOString(),
        // FullCalendar drops `end` when it equals the default duration.
        endTime: event.allDay
          ? toDateString(event.end ?? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1))
          : (event.end ?? new Date(start.getTime() + 60 * 60_000)).toISOString()
      }
      await window.api.events.updateLocal(event.id, input)
      refreshEvents()
    } catch (err) {
      arg.revert()
      notify(`Could not move event: ${errorMessage(err)}`, 'error')
    }
  }

  return (
    <div className="h-full p-4">
      <div className="h-full rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={initialView()}
          datesSet={(arg) => localStorage.setItem(VIEW_STORAGE_KEY, arg.view.type)}
          editable={false}
          eventDrop={(arg) => void onEventChange(arg)}
          eventResize={(arg) => void onEventChange(arg)}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          height="100%"
          events={fetchEvents}
          eventClick={onEventClick}
          selectable
          selectMirror
          select={onSelect}
          nowIndicator
          dayMaxEvents
          weekNumbers={false}
          scrollTime="08:00:00"
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          slotLabelFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          eventClassNames={(arg) => (arg.event.id === selectedEventId ? ['ring-2', 'ring-white', 'ring-offset-1', 'ring-offset-slate-900'] : [])}
        />
      </div>
    </div>
  )
}

const VIEW_STORAGE_KEY = 'calendar.view'
const VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay']

/** Restores the last used Month/Week/Day view. */
function initialView(): string {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY)
  return saved && VIEWS.includes(saved) ? saved : 'timeGridWeek'
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
    extendedProps: { isLocalEvent: e.isLocalEvent, location: e.location }
  }
}
