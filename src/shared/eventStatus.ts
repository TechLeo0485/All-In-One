/**
 * Event status, shared by main and renderer. The user edits the list in Settings
 * and picks a status per event; events with a status are outlined in its color.
 * (Whether an event has ended is shown by darkening it, not by a status.)
 */
import type { EventStatusDef } from './types'

export const MAX_STATUSES = 30
export const MAX_STATUS_LABEL = 40
/** Status ids end up in CSS class names, so they are kept to these characters. */
export const STATUS_ID_RE = /^[a-z0-9-]{1,40}$/

/** Ids of the automatic statuses of an earlier version; dropped from saved lists. */
const RETIRED_IDS = ['scheduled', 'ended']

export const DEFAULT_EVENT_STATUSES: EventStatusDef[] = [
  { id: 'follow-up', label: 'Follow-Up', color: '#f59e0b' },
  { id: 'passed', label: 'Passed', color: '#22c55e' },
  { id: 'failed', label: 'Failed', color: '#ef4444' }
]

/** Drops malformed entries, duplicate ids and the retired automatic statuses. */
export function normalizeStatuses(statuses: EventStatusDef[]): EventStatusDef[] {
  const seen = new Set<string>()
  return statuses.filter(
    (s) =>
      typeof s?.id === 'string' &&
      typeof s.label === 'string' &&
      typeof s.color === 'string' &&
      !RETIRED_IDS.includes(s.id) &&
      !seen.has(s.id) &&
      seen.add(s.id)
  )
}

/** A new, unused id for a status added in Settings. */
export function newStatusId(): string {
  return `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** The status picked on an event, if it still exists in Settings. */
export function findStatus(statuses: EventStatusDef[], id: string | null | undefined): EventStatusDef | undefined {
  return id ? statuses.find((s) => s.id === id) : undefined
}
