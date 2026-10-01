import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'

/**
 * Forwards pushes from the main process into the store: sync status, Proton
 * accounts, and "open this event" requests from reminders / the tray. Mount once.
 */
export function useSyncSubscription(): void {
  const applySyncStatus = useAppStore((s) => s.applySyncStatus)
  const setProtonAccounts = useAppStore((s) => s.setProtonAccounts)
  const openEvent = useAppStore((s) => s.openEvent)
  useEffect(() => window.api.sync.onStatusChange(applySyncStatus), [applySyncStatus])
  useEffect(() => window.api.proton.onAccountsChanged(setProtonAccounts), [setProtonAccounts])
  useEffect(() => window.api.notifications.onOpenEvent(openEvent), [openEvent])
}
