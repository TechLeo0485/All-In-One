import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'

/**
 * Forwards pushes from the main process into the store: sync status, Proton
 * accounts, event changes made in main, and "open this event" requests from
 * reminders / the tray. Mount once.
 */
export function useSyncSubscription(): void {
  const applySyncStatus = useAppStore((s) => s.applySyncStatus)
  const setProtonAccounts = useAppStore((s) => s.setProtonAccounts)
  const openEvent = useAppStore((s) => s.openEvent)
  const refreshEvents = useAppStore((s) => s.refreshEvents)
  useEffect(() => window.api.sync.onStatusChange(applySyncStatus), [applySyncStatus])
  useEffect(() => window.api.proton.onAccountsChanged(setProtonAccounts), [setProtonAccounts])
  useEffect(() => window.api.notifications.onOpenEvent(openEvent), [openEvent])
  // e.g. a status picked on a "How did it go?" notification
  useEffect(() => window.api.events.onChanged(refreshEvents), [refreshEvents])
}
