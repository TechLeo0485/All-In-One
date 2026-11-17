import { app, BrowserWindow, powerMonitor } from 'electron'
import { IPC } from '@shared/ipcChannels'
import { isOverviewSource, OVERVIEW_SOURCE_PREFIX } from '@shared/sources'
import type { OverviewGroup, TeamBoard, TeamBoardCard, TeamworkView } from '@shared/types'
import { calendarRepository } from '../../database/calendarRepository'
import { eventRepository } from '../../database/eventRepository'
import { makeEventId } from '../../sync/icsParser'

/** What Teamwork sends an overview account (see the API's overview DTOs). */
interface Person {
  id: string
  name: string
  color: string
  isCaller: boolean
  isBidder: boolean
  level: number | null
}
interface Group extends OverviewGroup {
  people: Person[]
}
interface Interview {
  id: string
  groupId: string
  title: string
  start: string
  end: string
  state: 'upcoming' | 'done' | 'cancelled'
  company: string | null
  role: string | null
  round: number | null
  summary: string
  caller: { id: string; name: string; color: string } | null
  bidder: { id: string; name: string; color: string } | null
}

/** How the overview reaches Teamwork: the signed-in session (callerService holds the token). */
export interface OverviewSession {
  serverUrl: string
  token: string
}
export interface OverviewHost {
  session(): OverviewSession | null
  request<T>(path: string): Promise<T>
  /** The sign-in ended (401): the account is signed out. */
  signedOut(): void
}

const DAY_MS = 86_400_000
/** Days before and after today the group calendars hold. */
const PAST_DAYS = 14
const FUTURE_DAYS = 60
const RETRY_MIN_MS = 2_000
const RETRY_MAX_MS = 60_000
/** Teamwork sends something at least every 25 s: silence for longer means a dead connection. */
const SILENCE_MS = 70_000
const LIVE_DEBOUNCE_MS = 400

const STATE_LABEL: Record<Interview['state'], string> = { upcoming: 'Upcoming', done: 'Done', cancelled: 'Cancelled' }

/**
 * The overview account in the app (e.g. the group's CEO): one read-only
 * calendar per group it was given (named by the group's label, in its color),
 * each interview with its caller, bidder, round and what it's about, kept
 * current by Teamwork's live updates (no polling). The Team view dives into a
 * group's day by caller or by bidder.
 */
class OverviewService {
  private host: OverviewHost | null = null
  private groups: Group[] = []
  private interviews = new Map<string, Interview>()
  private live: AbortController | null = null
  private lastEventId: string | null = null
  private pending = new Set<string>()
  private pendingTimer: NodeJS.Timeout | null = null
  private wake: (() => void) | null = null
  private powerHooked = false

  setHost(host: OverviewHost): void {
    this.host = host
  }

  /** Starts (or restarts) when an overview account is signed in; otherwise nothing happens. */
  start(): void {
    this.stop()
    if (!this.host?.session()) return
    if (!this.powerHooked) {
      this.powerHooked = true
      powerMonitor.on('resume', () => this.wake?.())
    }
    const abort = new AbortController()
    this.live = abort
    void this.run(abort.signal)
  }

  stop(): void {
    this.live?.abort()
    this.live = null
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingTimer = null
    this.pending.clear()
  }

  /** Signed out: the group calendars go away. */
  clear(): void {
    this.stop()
    this.groups = []
    this.interviews.clear()
    this.lastEventId = null
    for (const c of calendarRepository.list()) if (isOverviewSource(c.sourceUrl)) calendarRepository.remove(c.id)
    this.changed()
  }

  groupList(): OverviewGroup[] {
    return this.groups.map(({ id, label, color }) => ({ id, label, color }))
  }

  /** One group's day, by caller (and Unassigned) or by bidder (who brought each in). Read-only. */
  board(groupId: string, view: TeamworkView, from: string, to: string): TeamBoard {
    const group = this.groups.find((g) => g.id === groupId)
    const signedIn = Boolean(this.host?.session())
    if (!group) return { signedIn, callers: [], cards: [], canAssign: false, unassignedColor: '#94a3b8', offlineSince: null }
    const calendarId = this.calendarIdOf(group.id)
    const byBidder = view === 'bidders'
    const items = [...this.interviews.values()].filter((i) => i.groupId === groupId && i.start < to && i.end > from)
    const cards: TeamBoardCard[] = items.map((i) => ({
      interviewId: i.id,
      eventId: calendarId ? makeEventId(calendarId, i.id) : null,
      start: i.start,
      end: i.end,
      title: i.title,
      company: i.company && i.role ? `${i.company} – ${i.role}` : i.company,
      profile: null,
      round: i.round ? `R${i.round}` : null,
      status: null,
      lockedTo: null,
      callerId: (byBidder ? i.bidder?.id : i.caller?.id) ?? null,
      needsDetails: !i.company && i.state !== 'cancelled',
      cancelled: i.state === 'cancelled',
      canAssign: false,
      pending: false
    }))
    // Columns: the group's callers (by level) or bidders, plus anyone else who has a card today.
    const people = group.people.filter((p) => (byBidder ? p.isBidder : p.isCaller))
    const ids = new Set(people.map((p) => p.id))
    for (const i of items) {
      const who = byBidder ? i.bidder : i.caller
      if (who && !ids.has(who.id)) {
        ids.add(who.id)
        people.push({ ...who, isCaller: !byBidder, isBidder: byBidder, level: null })
      }
    }
    people.sort((a, b) => (byBidder ? 0 : (a.level ?? 99) - (b.level ?? 99)) || a.name.localeCompare(b.name))
    return {
      signedIn,
      callers: people.map((p) => ({ userId: p.id, name: p.name, level: p.level, color: p.color, mine: false })),
      cards,
      canAssign: false,
      unassignedColor: '#94a3b8',
      unassignedLabel: byBidder ? 'No bidder' : 'Unassigned',
      offlineSince: null
    }
  }

  // ---------------------------------------------------------------------------

  /** Holds the live stream open; every time it opens, reloads the groups and their interviews. */
  private async run(signal: AbortSignal): Promise<void> {
    let delay = RETRY_MIN_MS
    while (!signal.aborted) {
      const session = this.host?.session()
      if (!session) break
      const attempt = new AbortController()
      const endAttempt = (): void => attempt.abort()
      signal.addEventListener('abort', endAttempt)
      let lastByteAt = Date.now()
      const watchdog = setInterval(() => {
        if (Date.now() - lastByteAt > SILENCE_MS) attempt.abort()
      }, 10_000)
      try {
        const response = await fetch(`${session.serverUrl}/api/overview/stream`, {
          headers: {
            Authorization: `Bearer ${session.token}`,
            Origin: session.serverUrl,
            Accept: 'text/event-stream',
            'X-App-Version': app.getVersion(),
            ...(this.lastEventId ? { 'Last-Event-ID': this.lastEventId } : {})
          },
          signal: attempt.signal
        })
        if (response.status === 401) {
          this.host?.signedOut()
          break
        }
        if (!response.ok || !response.body) throw new Error(`Teamwork answered ${response.status}`)
        delay = RETRY_MIN_MS
        void this.reload().catch((err) => console.warn('[overview] load failed:', String(err)))
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          lastByteAt = Date.now()
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
          let end: number
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            this.onMessage(buffer.slice(0, end))
            buffer = buffer.slice(end + 2)
          }
        }
      } catch (err) {
        if (signal.aborted) break
        console.warn('[overview] live connection dropped:', attempt.signal.aborted ? 'it went quiet' : String(err))
      } finally {
        clearInterval(watchdog)
        signal.removeEventListener('abort', endAttempt)
      }
      if (signal.aborted) break
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, delay)
        function done(): void {
          clearTimeout(timer)
          signal.removeEventListener('abort', done)
          resolve()
        }
        this.wake = done
        signal.addEventListener('abort', done)
      })
      this.wake = null
      delay = Math.min(delay * 2, RETRY_MAX_MS)
    }
  }

  private onMessage(block: string): void {
    let event = 'message'
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) this.lastEventId = line.slice(3).trim()
      else if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (event === 'resync' || event === 'overview.groups') {
      void this.reload().catch((err) => console.warn('[overview] reload failed:', String(err)))
      return
    }
    if (event !== 'overview.changed' || !data) return
    try {
      for (const id of (JSON.parse(data) as { ids?: string[] }).ids ?? []) this.pending.add(id)
    } catch {
      return
    }
    if (!this.pendingTimer) this.pendingTimer = setTimeout(() => void this.flush(), LIVE_DEBOUNCE_MS)
  }

  /** Fetches just the interviews Teamwork said changed. */
  private async flush(): Promise<void> {
    this.pendingTimer = null
    const ids = [...this.pending]
    this.pending.clear()
    if (!this.host || ids.length === 0) return
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const page = await this.host.request<{ items: Interview[]; removed: string[] }>(`/overview/interviews?ids=${ids.slice(i, i + 200).join(',')}`)
        for (const id of page.removed) this.interviews.delete(id)
        for (const item of page.items) this.interviews.set(item.id, item)
      }
      this.rebuild()
    } catch (err) {
      console.warn('[overview] update failed:', String(err))
    }
  }

  /** The groups and every interview in the window (a week at a time when one answer can't hold them). */
  private async reload(): Promise<void> {
    if (!this.host) return
    this.groups = await this.host.request<Group[]>('/overview/groups')
    const from = Date.now() - PAST_DAYS * DAY_MS
    const to = Date.now() + FUTURE_DAYS * DAY_MS
    const next = new Map<string, Interview>()
    const load = async (a: number, b: number): Promise<void> => {
      const page = await this.host!.request<{ items: Interview[]; truncated?: boolean }>(
        `/overview/interviews?from=${encodeURIComponent(new Date(a).toISOString())}&to=${encodeURIComponent(new Date(b).toISOString())}`
      )
      if (page.truncated && b - a > 7 * DAY_MS) {
        for (let s = a; s < b; s += 7 * DAY_MS) await load(s, Math.min(s + 7 * DAY_MS, b))
        return
      }
      for (const item of page.items) next.set(item.id, item)
    }
    await load(from, to)
    this.interviews = next
    this.rebuild()
  }

  /** One calendar per group (label and color from Teamwork), its interviews as read-only events. */
  private rebuild(): void {
    const existing = new Map(
      calendarRepository
        .list()
        .filter((c) => isOverviewSource(c.sourceUrl))
        .map((c) => [c.sourceUrl.slice(OVERVIEW_SOURCE_PREFIX.length), c])
    )
    for (const group of this.groups) {
      const name = group.label.slice(0, 80)
      const current = existing.get(group.id)
      const calendarId = current
        ? current.id
        : calendarRepository.create({ name, color: group.color, sourceUrl: `${OVERVIEW_SOURCE_PREFIX}${group.id}`, enabled: true, notify: false }).id
      if (current && (current.name !== name || current.color.toLowerCase() !== group.color.toLowerCase())) {
        calendarRepository.update(current.id, { name, color: group.color })
      }
      existing.delete(group.id)
      const rows = [...this.interviews.values()]
        .filter((i) => i.groupId === group.id && i.state !== 'cancelled')
        .map((i) => ({
          id: makeEventId(calendarId, i.id),
          externalId: i.id,
          title: i.title || 'Interview',
          description: this.describe(group, i),
          startTime: i.start,
          endTime: i.end,
          allDay: false,
          location: '',
          attendees: [],
          myResponse: null
        }))
      eventRepository.replaceCalendarEvents(calendarId, rows)
      calendarRepository.setSyncSuccess(calendarId, null)
    }
    // Groups no longer given to this account.
    for (const c of existing.values()) calendarRepository.remove(c.id)
    this.changed()
  }

  /** What the details card shows of an interview: who, what and what it's about. */
  private describe(group: Group, i: Interview): string {
    const lines = [
      `Group: ${group.label}`,
      `Caller: ${i.caller?.name ?? 'Nobody yet'}`,
      `Bidder: ${i.bidder?.name ?? 'Unknown'}`,
      [i.round ? `Round ${i.round}` : null, i.company && i.role ? `${i.company} – ${i.role}` : i.company].filter(Boolean).join(' · '),
      `Status: ${STATE_LABEL[i.state]}`
    ].filter(Boolean)
    return [lines.join('\n'), i.summary].filter(Boolean).join('\n\n')
  }

  private calendarIdOf(groupId: string): string | null {
    return calendarRepository.list().find((c) => c.sourceUrl === `${OVERVIEW_SOURCE_PREFIX}${groupId}`)?.id ?? null
  }

  private changed(): void {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.callerChanged)
  }
}

export const overviewService = new OverviewService()
