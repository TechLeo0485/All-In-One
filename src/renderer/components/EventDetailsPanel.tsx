import { useAppStore } from '../stores/appStore'
import { useEventDetails } from '../hooks/useEventDetails'
import { formatEventWhen, formatReminder } from '../utils/dates'
import { findFirstUrl, linkify } from '../utils/linkify'
import { BellIcon, ClockIcon, ExternalIcon, LockIcon, MapPinIcon, XIcon } from './icons'
import { NotesEditor } from './NotesEditor'
import { Button, ColorDot, Spinner } from './ui'

/** Right-hand panel: details of the selected event plus its notes. */
export function EventDetailsPanel() {
  const selectedEventId = useAppStore((s) => s.selectedEventId)
  const selectEvent = useAppStore((s) => s.selectEvent)
  const calendars = useAppStore((s) => s.calendars)
  const localColor = useAppStore((s) => s.settings?.localEventColor ?? '#10b981')
  const openEventEditor = useAppStore((s) => s.openEventEditor)
  const deleteLocalEvent = useAppStore((s) => s.deleteLocalEvent)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const protonAccounts = useAppStore((s) => s.protonAccounts)
  const settings = useAppStore((s) => s.settings)
  const { event, loading, error } = useEventDetails(selectedEventId)

  // All hooks must run before this early return (React requires the same hook order every render).
  if (!selectedEventId) return null

  const calendar = event?.calendarId ? calendars.find((c) => c.id === event.calendarId) : undefined
  const accountLabel = protonAccounts.find((a) => a.id === calendar?.accountId)?.label
  const meetingUrl = event ? findFirstUrl(event.location, event.description) : null

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
                <p className="selectable pl-6 text-sm break-words whitespace-pre-wrap text-slate-200">
                  {linkify(event.description)}
                </p>
              )}

              {event.isLocalEvent && (
                <div className="flex gap-2 pl-6">
                  <Button onClick={() => openEventEditor({ mode: 'edit', event })}>Edit event</Button>
                  <Button
                    variant="danger"
                    onClick={() => {
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

            <hr className="border-slate-800" />
            <NotesEditor eventId={event.id} />
          </>
        )}
      </div>
    </aside>
  )
}
