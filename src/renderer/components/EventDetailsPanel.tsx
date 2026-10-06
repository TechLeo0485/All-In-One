import { useState } from 'react'
import type { AttendeeStatus, CalendarEvent, EventAttendee } from '@shared/types'
import { DEFAULT_EVENT_STATUSES, findStatus } from '@shared/eventStatus'
import { htmlToPlainText } from '@shared/htmlText'
import { describeRecurrence } from '@shared/recurrence'
import { useAppStore } from '../stores/appStore'
import { useEventDetails } from '../hooks/useEventDetails'
import { formatEventWhen, formatReminder, toDateString } from '../utils/dates'
import { findFirstUrl, linkify } from '../utils/linkify'
import { renderDescription } from '../utils/richText'
import { BellIcon, ClockIcon, ExternalIcon, LockIcon, MapPinIcon, RepeatIcon, UsersIcon, XIcon } from './icons'
import { NotesEditor } from './NotesEditor'
import { Button, ColorDot, Spinner } from './ui'

/** Long guest lists start collapsed to keep the notes editor in view. */
const GUESTS_COLLAPSED = 8

const STATUS_STYLE: Record<AttendeeStatus, { mark: string; className: string; label: string }> = {
  accepted: { mark: '✓', className: 'bg-emerald-500/20 text-emerald-300', label: 'Accepted' },
  tentative: { mark: '?', className: 'bg-amber-500/20 text-amber-300', label: 'Maybe' },
  declined: { mark: '✕', className: 'bg-red-500/20 text-red-300', label: 'Declined' },
  'needs-action': { mark: '•', className: 'bg-slate-700 text-slate-400', label: 'Awaiting reply' }
}

function guestSummary(attendees: EventAttendee[]): string {
  const count = (status: AttendeeStatus): number => attendees.filter((a) => a.status === status).length
  const parts = [
    [count('accepted'), 'yes'],
    [count('tentative'), 'maybe'],
    [count('declined'), 'no'],
    [count('needs-action'), 'awaiting']
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
  return `${attendees.length} ${attendees.length === 1 ? 'guest' : 'guests'} · ${parts.join(', ')}`
}

function GuestList({ attendees }: { attendees: EventAttendee[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? attendees : attendees.slice(0, GUESTS_COLLAPSED)

  return (
    <div className="space-y-2 pl-6 text-sm">
      <p className="flex items-center gap-2 text-slate-300">
        <UsersIcon className="shrink-0 text-slate-500" />
        {guestSummary(attendees)}
      </p>
      <ul className="space-y-1.5 pl-6">
        {visible.map((a) => {
          const style = STATUS_STYLE[a.status]
          const tags = [a.isOrganizer && 'Organizer', a.optional && 'Optional'].filter(Boolean).join(' · ')
          return (
            <li key={a.email || a.name} className="flex items-start gap-2">
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] ${style.className}`}
                title={style.label}
                aria-label={style.label}
              >
                {style.mark}
              </span>
              <span className="min-w-0">
                <span className="selectable block truncate text-slate-200" title={a.email}>
                  {a.name || a.email}
                </span>
                {(a.name && a.email) || tags ? (
                  <span className="selectable block truncate text-xs text-slate-500">
                    {[a.name && a.email, tags].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
      {attendees.length > GUESTS_COLLAPSED && (
        <button className="pl-6 text-xs text-blue-400 hover:underline" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${attendees.length} guests`}
        </button>
      )}
    </div>
  )
}

/** Status chips from Settings; clicking the selected one again clears it. */
function StatusPicker({ event }: { event: CalendarEvent }) {
  const statuses = useAppStore((s) => s.settings?.eventStatuses ?? DEFAULT_EVENT_STATUSES)
  const setEventStatus = useAppStore((s) => s.setEventStatus)
  const setView = useAppStore((s) => s.setView)
  // A status deleted in Settings counts as none.
  const current = findStatus(statuses, event.status)?.id ?? null

  return (
    <div className="flex flex-wrap gap-1.5 pl-6" role="radiogroup" aria-label="Status">
      {statuses.map((o) => {
        const selected = current === o.id
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={selected}
            title={selected ? 'Click again to clear the status' : undefined}
            onClick={() => void setEventStatus(event.id, selected ? null : o.id)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
              selected ? 'font-medium text-white' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
            }`}
            style={selected ? { borderColor: o.color, backgroundColor: `${o.color}26` } : undefined}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} />
            {o.label}
          </button>
        )
      })}
      <button
        className="px-1 text-xs text-slate-500 hover:text-slate-300 hover:underline"
        onClick={() => setView('settings')}
        title="Add, rename or recolor statuses"
      >
        {statuses.length ? 'Edit…' : 'Add statuses in Settings…'}
      </button>
    </div>
  )
}

/** Right-hand panel: details of the selected event plus its notes. */
export function EventDetailsPanel() {
  const selectedEventId = useAppStore((s) => s.selectedEventId)
  const selectEvent = useAppStore((s) => s.selectEvent)
  const calendars = useAppStore((s) => s.calendars)
  const localColor = useAppStore((s) => s.settings?.localEventColor ?? '#10b981')
  const openEventEditor = useAppStore((s) => s.openEventEditor)
  const deleteLocalEvent = useAppStore((s) => s.deleteLocalEvent)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const askRecurrenceScope = useAppStore((s) => s.askRecurrenceScope)
  const protonAccounts = useAppStore((s) => s.protonAccounts)
  const settings = useAppStore((s) => s.settings)
  const { event, loading, error } = useEventDetails(selectedEventId)

  // All hooks must run before this early return (React requires the same hook order every render).
  if (!selectedEventId) return null

  const calendar = event?.calendarId ? calendars.find((c) => c.id === event.calendarId) : undefined
  const accountLabel = protonAccounts.find((a) => a.id === calendar?.accountId)?.label
  const meetingUrl = event ? findFirstUrl(event.location, htmlToPlainText(event.description)) : null

  // Which reminder applies: local events have their own; calendar events use the default.
  let reminderText: string | null = null
  if (event && settings?.notificationsEnabled) {
    if (event.isLocalEvent) {
      if (event.reminderMinutes !== null) reminderText = formatReminder(event.reminderMinutes)
    } else if (calendar?.notify) {
      if (event.allDay && settings.allDayReminder !== 'off') {
        reminderText = settings.allDayReminder === 'same-day' ? 'Reminder on the day at 9:00' : 'Reminder the evening before at 18:00'
      } else if (!event.allDay && settings.defaultReminderMinutes >= 0) {
        reminderText = `${formatReminder(settings.defaultReminderMinutes)} (default)`
      }
    }
  }
  const hasMoreDetails = Boolean(event && (meetingUrl || event.description || event.attendees.length || event.isLocalEvent))
  const color = event?.isLocalEvent ? (event.color ?? localColor) : (calendar?.color ?? '#64748b')

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-slate-800 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Event details</span>
        <Button variant="ghost" className="px-1.5!" onClick={() => selectEvent(null)} aria-label="Close details">
          <XIcon />
        </Button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {loading && !event && <Spinner className="text-slate-500" />}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && !event && !error && (
          <p className="text-sm text-slate-400">This event no longer exists. It may have been removed from its calendar.</p>
        )}

        {event && (
          <>
            <section className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="mt-1.5">
                  <ColorDot color={color} size={12} />
                </span>
                <h2 className="selectable text-lg leading-snug font-semibold">{event.title}</h2>
              </div>

              <div className="space-y-2 pl-6 text-sm text-slate-300">
                <p className="flex items-start gap-2">
                  <ClockIcon className="mt-0.5 shrink-0 text-slate-500" />
                  <span className="selectable">{formatEventWhen(event)}</span>
                </p>
                {event.recurrence && (
                  <p className="flex items-start gap-2">
                    <RepeatIcon className="mt-0.5 shrink-0 text-slate-500" />
                    {describeRecurrence(
                      event.recurrence,
                      event.allDay ? event.startTime : toDateString(new Date(event.startTime))
                    )}
                  </p>
                )}
                {event.location && (
                  <p className="flex items-start gap-2">
                    <MapPinIcon className="mt-0.5 shrink-0 text-slate-500" />
                    <span className="selectable break-words">{linkify(event.location)}</span>
                  </p>
                )}
                {reminderText && (
                  <p className="flex items-center gap-2">
                    <BellIcon className="shrink-0 text-slate-500" />
                    {reminderText}
                  </p>
                )}
                <p className="flex items-center gap-2 text-xs text-slate-500">
                  {event.isLocalEvent ? (
                    'Local event (only stored in this app)'
                  ) : (
                    <>
                      <LockIcon size={12} /> {calendar?.name ?? 'Calendar'}
                      {accountLabel && ` · ${accountLabel}`} · read-only
                    </>
                  )}
                </p>
              </div>
              <StatusPicker event={event} />
            </section>

            {/* Notes sit right under the event summary so they're visible without scrolling past long descriptions or guest lists. */}
            <hr className="border-slate-800" />
            <NotesEditor eventId={event.id} />

            {hasMoreDetails && <hr className="border-slate-800" />}
            {hasMoreDetails && (
              <section className="space-y-3">
                {meetingUrl && (
                  <div className="pl-6">
                    <a
                      href={meetingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
                    >
                      <ExternalIcon /> Open meeting link
                    </a>
                  </div>
                )}

                {event.description && (
                  <div className="selectable pl-6 text-sm break-words text-slate-200">
                    {renderDescription(event.description)}
                  </div>
                )}

                {event.attendees.length > 0 && <GuestList key={event.id} attendees={event.attendees} />}

                {event.isLocalEvent && (
                  <div className="flex gap-2 pl-6">
                    <Button onClick={() => openEventEditor({ mode: 'edit', event })}>Edit event</Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (event.seriesId) {
                          // Repeating: the scope dialog doubles as the confirmation.
                          void askRecurrenceScope('delete').then((scope) => {
                            if (scope) void deleteLocalEvent(event.id, scope)
                          })
                          return
                        }
                        void askConfirm({
                          title: 'Delete event?',
                          message: `"${event.title}" and its meeting notes will be permanently deleted.`,
                          confirmLabel: 'Delete event',
                          danger: true
                        }).then((ok) => {
                          if (ok) void deleteLocalEvent(event.id)
                        })
                      }}
                    >
                      Delete event
                    </Button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
