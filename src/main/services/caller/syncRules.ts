/**
 * The Teamwork sync's decisions, free of Electron, storage and the network, so
 * they can be tested on their own (syncRules.test.ts). callerService does the
 * I/O around them.
 */

/** An event of this app, as far as busy time cares. */
export interface BusyCandidate {
  id: string
  calendarId: string | null
  startTime: string
  endTime: string
  allDay: boolean
  myResponse: string | null
  title: string
  location: string
  attendees: Array<{ name: string; email: string; status: string; isOrganizer: boolean }>
}

/**
 * One busy event as sent to Teamwork: its times (whoever assigns sees "Busy"),
 * and its title, place and guests, which only the admin sees. Never its
 * description, links or notes.
 */
export interface BusyBlock {
  start: string
  end: string
  title: string
  location: string
  attendees: Array<{ name: string; email: string; status: string; isOrganizer: boolean }>
}

/** Guests sent per busy event (Teamwork keeps as many). */
export const MAX_BUSY_GUESTS = 30

/**
 * The member's busy time: timed events of their calendars that aren't shared
 * with a profile (those are interviews), aren't Teamwork's own, weren't picked
 * one by one, weren't declined, and aren't all-day or longer than `maxMs`.
 * Sorted by time; each with its title, place and guests (cut to Teamwork's limits).
 */
export function busyBlocksFrom(
  events: BusyCandidate[],
  exclude: { calendarIds: ReadonlySet<string>; eventIds: ReadonlySet<string> },
  maxMs: number
): BusyBlock[] {
  return events
    .filter((e) => {
      if (!e.calendarId || exclude.calendarIds.has(e.calendarId) || exclude.eventIds.has(e.id)) return false
      if (e.allDay || e.myResponse === 'declined') return false
      const length = Date.parse(e.endTime) - Date.parse(e.startTime)
      return length > 0 && length <= maxMs
    })
    .map((e) => ({
      start: new Date(e.startTime).toISOString(),
      end: new Date(e.endTime).toISOString(),
      title: e.title.slice(0, 300),
      location: e.location.slice(0, 300),
      attendees: e.attendees.slice(0, MAX_BUSY_GUESTS).map((a) => ({
        name: a.name.slice(0, 200),
        email: a.email.slice(0, 320),
        status: a.status.slice(0, 20),
        isOrganizer: a.isOrganizer
      }))
    }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title))
}

/** Something done offline, as far as deciding whether to send it goes. */
export interface QueuedChange {
  kind: 'assign' | 'link' | 'resume' | 'color'
  /** What Teamwork said when it was done. */
  base: string
  callerId?: string | null
  url?: string | null
  color?: string
}

/**
 * What to do with a change made offline, given what Teamwork says now
 * (`now`; null when the interview or calendar is gone):
 * - `done`: Teamwork already says what it would make it say (it got through before the app could note it);
 * - `gone`: nothing left to change;
 * - `changed`: someone changed it meanwhile, so it must not be overwritten;
 * - `send`: send it.
 */
export function queuedOutcome(change: QueuedChange, now: string | null): 'done' | 'gone' | 'changed' | 'send' {
  if (now === null) return 'gone'
  const target =
    change.kind === 'assign'
      ? (change.callerId ?? '')
      : change.kind === 'link'
        ? (change.url ?? '')
        : change.kind === 'color'
          ? (change.color ?? '').toLowerCase()
          : null // a resume can't be compared: a new upload is always new
  if (target !== null && now === target) return 'done'
  if (now !== change.base) return 'changed'
  return 'send'
}

/**
 * Whether Teamwork holds the copy this app sent last: its fingerprint matches,
 * and that send didn't fail. A copy it doesn't list, or lists without a
 * fingerprint (older servers), is sent again.
 */
export function teamworkHasLatest(held: { clientHash?: string | null } | undefined, sent: { lastHash?: string | null; lastError?: string | null }): boolean {
  return Boolean(held?.clientHash && held.clientHash === sent.lastHash && !sent.lastError)
}

/**
 * The "While you were away" line for what Teamwork told the member since
 * `since`, at most `days` back; null when there's nothing. Each notification
 * counts once: assignments, then other interview and calendar changes, then the rest.
 */
export function missedSummary(
  items: Array<{ type: string; readAt: string | null; createdAt: string }>,
  since: string,
  now: number,
  days: number
): string | null {
  const cutoff = Math.max(Date.parse(since), now - days * 86_400_000)
  const missed = items.filter((n) => !n.readAt && Date.parse(n.createdAt) > cutoff)
  if (missed.length === 0) return null
  let assigned = 0
  let updates = 0
  let others = 0
  for (const n of missed) {
    if (n.type === 'interview.assigned' || n.type === 'event.assigned') assigned++
    else if (n.type === 'interview.changed' || n.type.startsWith('event.')) updates++
    else others++
  }
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
  const parts = [
    assigned ? `${plural(assigned, 'interview', 'interviews')} assigned to you` : '',
    updates ? plural(updates, 'interview update', 'interview updates') : '',
    others ? plural(others, 'other notification', 'other notifications') : ''
  ].filter(Boolean)
  return `${parts.join(', ')}.`
}

/** Wait before the next try: `min`, doubling with each try, never more than `max`. */
export function backoff(tries: number, min: number, max: number): number {
  return Math.min(min * 2 ** Math.max(tries, 0), max)
}
