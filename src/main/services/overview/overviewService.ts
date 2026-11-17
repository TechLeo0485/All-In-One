import { app, BrowserWindow, powerMonitor } from 'electron'
import { IPC } from '@shared/ipcChannels'
import { isOverviewSource, OVERVIEW_SOURCE_PREFIX } from '@shared/sources'
import type { AttendeeStatus, OverviewGroup, OverviewInterviewInfo, TeamBoard, TeamBoardCard, TeamworkView } from '@shared/types'
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
  /** Missing from older servers: the summary stands in. */
  description?: string
  meetingInstructions?: string
  location?: string
  attendees?: Array<{ name: string; email: string; status: string; isOrganizer: boolean; optional: boolean }>
  profile?: string | null
  link?: string | null
  caller: { id: string; name: string; color: string } | null
  bidder: { id: string; name: string; color: string } | null
}

/** A member's own calendar time in a group (from their desktop app). */
interface Busy {
  groupId: string
  person: { id: string; name: string; color: string }
  events: Array<{ start: string; end: string; title: string; location: string; attendees: Array<{ name: string; email: string; status: string; isOrganizer: boolean }> }>
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
const PAST_DAYS = 31
const FUTURE_DAYS = 60
const RETRY_MIN_MS = 2_000
const RETRY_MAX_MS = 60_000
/** Teamwork sends something at least every 25 s: silence for longer means a dead connection. */
const SILENCE_MS = 70_000
const LIVE_DEBOUNCE_MS = 400

const ATTENDEE_STATUSES: readonly string[] = ['accepted', 'declined', 'tentative', 'needs-action']
/** The board of every group at once. */
const ALL_GROUPS = 'all'

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
  private busy: Busy[] = []
  private busyTimer: NodeJS.Timeout | null = null
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
    this.busy = []
    this.lastEventId = null
    for (const c of calendarRepository.list()) if (isOverviewSource(c.sourceUrl)) calendarRepository.remove(c.id)
    this.changed()
  }

  /** The group interview behind an event of the group calendars, for its details card. */
  interviewInfo(eventId: string): OverviewInterviewInfo | null {
    const event = eventRepository.get(eventId)
    const calendar = event?.calendarId ? calendarRepository.get(event.calendarId) : null
    if (!event?.externalId || !calendar || !isOverviewSource(calendar.sourceUrl)) return null
    // A member's own event: whose calendar, in which group.
    if (event.externalId.startsWith('busy:')) {
      const ownerId = event.externalId.split(':')[1]
      const groupId = calendar.sourceUrl.slice(OVERVIEW_SOURCE_PREFIX.length)
      const group = this.groups.find((g) => g.id === groupId)
      const owner = this.busy.find((b) => b.groupId === groupId && b.person.id === ownerId)?.person
      if (!group) return null
      return {
        kind: 'own',
        owner: owner ? { name: owner.name, color: owner.color } : null,
        group: { id: group.id, label: group.label, color: group.color },
        state: Date.parse(event.endTime) <= Date.now() ? 'done' : 'upcoming',
        caller: null,
        bidder: null,
        round: null,
        company: null,
        role: null,
        profile: null,
        link: null
      }
    }
    const i = this.interviews.get(event.externalId)
    const group = this.groups.find((g) => g.id === i?.groupId)
    if (!i || !group) return null
    return {
      kind: 'interview',
      owner: null,
      group: { id: group.id, label: group.label, color: group.color },
      state: i.state,
      caller: i.caller ? { name: i.caller.name, color: i.caller.color } : null,
      bidder: i.bidder ? { name: i.bidder.name, color: i.bidder.color } : null,
      round: i.round,
      company: i.company,
      role: i.role,
      profile: i.profile ?? null,
      link: i.link ?? null
    }
  }

  groupList(): OverviewGroup[] {
    return this.groups.map(({ id, label, color }) => ({ id, label, color }))
  }

  /** Every group's day on one board: each group's columns in turn, tagged with the group. */
  private allGroupsBoard(view: TeamworkView, from: string, to: string): TeamBoard {
    const boards = this.groups.map((g) => ({ g, board: this.board(g.id, view, from, to) }))
    const tag = (g: Group) => ({ label: g.label, color: g.color })
    return {
      signedIn: Boolean(this.host?.session()),
      // A person in two groups gets a column in each: ids are made per group.
      callers: boards.flatMap(({ g, board }) => board.callers.map((c) => ({ ...c, userId: `${g.id}:${c.userId}`, group: tag(g) }))),
      cards: boards.flatMap(({ g, board }) =>
        board.cards.map((c) => ({
          ...c,
          interviewId: c.own ? `${g.id}:${c.interviewId}` : c.interviewId,
          callerId: c.callerId ? `${g.id}:${c.callerId}` : null,
          group: tag(g)
        }))
      ),
      canAssign: false,
      unassignedColor: '#94a3b8',
      unassignedLabel: view === 'bidders' ? 'No bidder' : 'Unassigned',
      offlineSince: null
    }
  }

  /** One group's day (or every group's: `all`), by caller (and Unassigned) or by bidder. Read-only. */
  board(groupId: string, view: TeamworkView, from: string, to: string): TeamBoard {
    if (groupId === ALL_GROUPS) return this.allGroupsBoard(view, from, to)
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
    // Each person's own calendar time, in their column (behind nothing: shown as their own events).
    for (const b of this.busy) {
      if (b.groupId !== groupId || !ids.has(b.person.id)) continue
      b.events.forEach((e, n) => {
        if (!(e.start < to && e.end > from)) return
        const key = `busy:${b.person.id}:${e.start}:${n}`
        cards.push({
          interviewId: key,
          eventId: calendarId ? makeEventId(calendarId, key) : null,
          start: e.start,
          end: e.end,
          title: e.title || 'Busy',
          company: null,
          profile: null,
          round: null,
          status: null,
          lockedTo: null,
          callerId: b.person.id,
          needsDetails: false,
          cancelled: false,
          canAssign: false,
          pending: false,
          own: true
        })
      })
    }
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
    if (event === 'overview.busy') {
      if (this.busyTimer) return
      this.busyTimer = setTimeout(() => {
        this.busyTimer = null
        void this.loadBusy()
          .then(() => this.rebuild())
          .catch((err) => console.warn('[overview] busy time failed:', String(err)))
      }, LIVE_DEBOUNCE_MS)
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
    await this.loadBusy().catch((err) => console.warn('[overview] busy time failed:', String(err)))
    this.rebuild()
  }

  /** Members' own calendar time in the window (as the workspace's admin sees it). */
  private async loadBusy(): Promise<void> {
    if (!this.host) return
    const from = new Date(Date.now() - PAST_DAYS * DAY_MS).toISOString()
    const to = new Date(Date.now() + FUTURE_DAYS * DAY_MS).toISOString()
    this.busy = await this.host.request<Busy[]>(`/overview/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
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
          // The whole invitation (its details card shows who, what and the status above it).
          description: [i.description ?? i.summary, i.meetingInstructions ? `Meeting instructions:\n${i.meetingInstructions}` : '']
            .filter(Boolean)
            .join('\n\n'),
          startTime: i.start,
          endTime: i.end,
          allDay: false,
          location: i.location ?? '',
          attendees: (i.attendees ?? []).map((a) => ({
            name: a.name,
            email: a.email,
            status: (ATTENDEE_STATUSES.includes(a.status) ? a.status : 'needs-action') as AttendeeStatus,
            isOrganizer: a.isOrganizer,
            optional: a.optional
          })),
          myResponse: null
        }))
      // Members' own calendar time, as the workspace's admin sees it: "Sam: Dentist".
      for (const b of this.busy) {
        if (b.groupId !== group.id) continue
        b.events.forEach((e, n) => {
          const key = `busy:${b.person.id}:${e.start}:${n}`
          rows.push({
            id: makeEventId(calendarId, key),
            externalId: key,
            title: `${b.person.name}: ${e.title || 'Busy'}`,
            description: '',
            startTime: e.start,
            endTime: e.end,
            allDay: false,
            location: e.location,
            attendees: e.attendees.map((a) => ({
              name: a.name,
              email: a.email,
              status: (ATTENDEE_STATUSES.includes(a.status) ? a.status : 'needs-action') as AttendeeStatus,
              isOrganizer: a.isOrganizer,
              optional: false
            })),
            myResponse: null
          })
        })
      }
      eventRepository.replaceCalendarEvents(calendarId, rows)
      calendarRepository.setSyncSuccess(calendarId, null)
    }
    // Groups no longer given to this account.
    for (const c of existing.values()) calendarRepository.remove(c.id)
    this.changed()
  }

  private calendarIdOf(groupId: string): string | null {
    return calendarRepository.list().find((c) => c.sourceUrl === `${OVERVIEW_SOURCE_PREFIX}${groupId}`)?.id ?? null
  }

  private changed(): void {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.callerChanged)
  }
}

export const overviewService = new OverviewService()
