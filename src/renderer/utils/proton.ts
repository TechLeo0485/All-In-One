import type { ProtonAccount } from '@shared/types'

/**
 * Proton accounts only sync when the user clicks Sync, so after this long the
 * sidebar and the Calendars page gently point out that the data may be out of date.
 */
export const PROTON_STALE_MS = 3 * 86_400_000

/** True when the account's last export is old (or it never synced) and nothing else is wrong with it. */
export function isProtonStale(account: ProtonAccount, now: number): boolean {
  if (account.status !== 'ok' && account.status !== 'ready') return false
  if (!account.lastExportAt) return true
  return now - new Date(account.lastExportAt).getTime() > PROTON_STALE_MS
}
