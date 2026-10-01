import { useEffect } from 'react'
import { useAppStore } from './stores/appStore'
import { useSyncSubscription } from './hooks/useSyncSubscription'
import { Sidebar } from './components/Sidebar'
import { EventDetailsPanel } from './components/EventDetailsPanel'
import { LocalEventDialog } from './components/LocalEventDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toasts } from './components/Toasts'
import { Spinner } from './components/ui'
import { AccountsPage } from './pages/AccountsPage'
import { CalendarPage } from './pages/CalendarPage'
import { CalendarsPage } from './pages/CalendarsPage'
import { SettingsPage } from './pages/SettingsPage'

/** Layout: sidebar | main view | event details panel (when an event is selected). */
export default function App() {
  const ready = useAppStore((s) => s.ready)
  const view = useAppStore((s) => s.view)
  const eventEditor = useAppStore((s) => s.eventEditor)
  const selectedEventId = useAppStore((s) => s.selectedEventId)
  const init = useAppStore((s) => s.init)
  const notify = useAppStore((s) => s.notify)

  useSyncSubscription()
  useEffect(() => {
    init().catch((err) => notify(`Failed to load data: ${String(err)}`, 'error'))
  }, [init, notify])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Spinner />
        <Toasts />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <ErrorBoundary area={view === 'calendar' ? 'calendar view' : `${view} page`} key={view}>
          {view === 'calendar' && <CalendarPage />}
          {view === 'accounts' && <AccountsPage />}
          {view === 'calendars' && <CalendarsPage />}
          {view === 'settings' && <SettingsPage />}
        </ErrorBoundary>
      </main>
      {view === 'calendar' && (
        // Keyed by event so selecting another event clears a previous error.
        <ErrorBoundary area="event details" key={selectedEventId ?? 'none'}>
          <EventDetailsPanel />
        </ErrorBoundary>
      )}
      {/* Keyed so each opening starts with fresh form state */}
      {eventEditor && (
        <ErrorBoundary area="event editor">
          <LocalEventDialog key={eventEditor.mode === 'edit' ? eventEditor.event.id : 'new'} />
        </ErrorBoundary>
      )}
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}
