import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, net, Notification, powerMonitor, safeStorage, shell } from 'electron'
import { IPC } from '@shared/ipcChannels'
import { hostOf, isFileSource, isTeamworkSource, TEAMWORK_SOURCE_PREFIX } from '@shared/sources'
import type {
  CalendarEvent,
  EventAttendee,
  CalendarSource,
  CallerEventShare,
  CallerPick,
  CallerProfile,
  CallerShareRow,
  CallerShares,
  CallerStatus,
  CallerAssignResult,
  CallerQueued,
  TeamBoard,
  TeamBoardCaller,
  CallerCandidate,
  CallerSyncResult,
  CallerTag,
  CallerWorkspace,
  TeamworkInterview
} from '@shared/types'
import { accountRepository } from '../../database/accountRepository'
import { calendarRepository } from '../../database/calendarRepository'
import { eventRepository } from '../../database/eventRepository'
import { settingsRepository } from '../../database/settingsRepository'
import { makeEventId } from '../../sync/icsParser'
import { syncService } from '../../sync/syncService'
import { protonAccountService } from '../proton/protonAccountService'
import { createNotification } from '../windowsIdentity'
import { buildIcs } from './icsBuilder'

/**
 * Connection to Teamwork (the Caller website). Any member signs in here and
 * chooses which of this app's calendars to share with a profile of their
 * workspace. Calendars stay in this app as before: links, Proton logins and
 * files never leave this computer. What is shared is only the events of a
 * shared calendar, uploaded every time that calendar syncs (Sync one, Sync
 * all, the auto-sync timer or a Proton export). Teamwork turns them into the
 * profile's interviews.
 *
 * Single events can be shared too, without their calendar: each profile gets one
 * "picked interviews" calendar on Teamwork holding just the events picked for it.
 * It is sent again whenever one of those events' calendars syncs, so a moved or
 * cancelled invitation follows; a picked event that left its calendar drops out.
 *
 * The session token is kept encrypted with the operating system's key store
 * (Electron safeStorage); it never reaches the renderer.
 */

const CONNECTION_KEY = 'caller.connection'
const TOKEN_KEY = 'caller.token'
/** Shares per workspace: slug → local calendar id → share. */
const SHARES_KEY = 'caller.shares'
const REQUEST_TIMEOUT_MS = 60_000
/** Largest calendar file Teamwork accepts. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

interface Connection {
  serverUrl: string
  email: string
  userName: string
  userId: string
  workspaces: CallerWorkspace[]
  workspaceSlug: string | null
  lastSyncAt: string | null
}

interface StoredShare {
  connectionId: string
  profileId: string
  profileName: string
  lastUploadAt: string | null
  lastError: string | null
  eventCount: number | null
  /** Fingerprint of the last file sent: an unchanged calendar isn't sent again. */
  lastHash?: string | null
}

type SharesByWorkspace = Record<string, Record<string, StoredShare>>

/** Events picked for one profile, sent as one desktop calendar. */
interface StoredPick {
  connectionId: string
  profileName: string
  eventIds: string[]
  lastUploadAt: string | null
  lastError: string | null
  /** Fingerprint of the last file sent: unchanged picks aren't sent again. */
  lastHash?: string | null
}

/** Picks per workspace: slug → profile id → pick. */
type PicksByWorkspace = Record<string, Record<string, StoredPick>>

const PICKS_KEY = 'caller.picks'
/** Other accounts that used this computer: their shares, picks and waiting changes, by user id. */
const ACCOUNT_STASH_KEY = 'caller.accountStash'
/** The Teamwork calendar of this app: workspace and local calendar id. */
/** Before 1.2.2: one Teamwork calendar. Removed on the first rebuild. */
const TEAMWORK_CALENDAR_KEY = 'caller.teamworkCalendar'
/** One Teamwork calendar per caller (and one for unassigned interviews): `byCaller[userId | 'unassigned']`. */
const TEAMWORK_CALENDARS_KEY = 'caller.teamworkCalendars'
const UNASSIGNED = 'unassigned'
const UNASSIGNED_COLOR = '#94a3b8'
type TeamworkCalendars = { slug: string; byCaller: Record<string, string> }
/** Teamwork details of the member's own events: local event id → label and link. */
const ANNOTATIONS_KEY = 'caller.annotations'
/** Done while offline, waiting to be sent (in order). */
const QUEUE_KEY = 'caller.queue'
/** The last interviews, busy time and colors Teamwork sent: shown while offline and right after a restart. */
const CACHE_KEY = 'caller.cache'
/** When this app was last connected, per workspace: what Teamwork told the member after that is summed up on reconnect. */
const ONLINE_UNTIL_KEY = 'caller.onlineUntil'
/** Missed notifications older than this aren't summed up. */
const MISSED_DAYS = 7

/** Something done while offline. `base` is what it was when done: sent only if Teamwork still says so. */
interface QueuedAction extends CallerQueued {
  slug: string
  base: string
  callerId?: string | null
  url?: string | null
  path?: string
  calendarId?: string
  color?: string
}

interface Cache {
  slug: string
  savedAt: string
  items: AppInterview[]
  busy: MemberBusy[]
  unassignedColor: string
  callers?: Array<{ userId: string; name: string; level: number | null; color: string }>
}
/** Busy time sent last, per workspace: skip sending when nothing changed. */
const BUSY_HASH_KEY = 'caller.busyHash'
/** Busy time sent and shown: yesterday to 60 days ahead (the server keeps 90). */
const BUSY_FUTURE_DAYS = 60
/** Calendars sync in bursts; busy time is sent once they settle. */
const BUSY_DEBOUNCE_MS = 5_000
/** Longer than this is not a meeting (all-day or multi-day): never sent. */
const BUSY_MAX_MS = 16 * 60 * 60 * 1000

/** Members and calendar managers change colors on Teamwork. */
function canSetColors(permissions: string[]): boolean {
  return permissions.includes('members.manage') || permissions.includes('calendar.manage')
}

/** Another member's busy time from their app (start and end only). */
interface MemberBusy {
  userId: string
  name: string
  color: string
  mine: boolean
  blocks: Array<{ start: string; end: string }>
}
/** Days before and after today the Teamwork calendar holds. */
const LIVE_PAST_DAYS = 7
const LIVE_FUTURE_DAYS = 60
/** Messages arriving close together are fetched once. */
const LIVE_DEBOUNCE_MS = 500
const LIVE_RETRY_MIN_MS = 2_000
const LIVE_RETRY_MAX_MS = 60_000
/** While waiting to reconnect: how often the operating system is asked whether the network is back. */
const NETWORK_CHECK_MS = 3_000
/** Teamwork pings every 25 s: this long without a byte, the stream is dead. */
const STREAM_SILENCE_MS = 70_000
/** Something didn't get through while connected: checked again after this, doubling, up to the longest. */
const RECHECK_MIN_MS = 30_000
const RECHECK_MAX_MS = 10 * 60_000
/** Resumes: PDF or Word, up to 10 MB (as Teamwork allows). */
const MAX_RESUME_BYTES = 10 * 1024 * 1024
const RESUME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

/** An interview as `GET /events/app` returns it (only the fields used here). */
interface AppInterview {
  assignedToMe: boolean
  source: { connectionId: string; uid: string; recurrenceKey: string } | null
  event: {
    id: string
    title: string
    description: string
    start: string
    end: string
    status: string
    location: string
    meetingUrl: string | null
    attendees: EventAttendee[]
    assignees: Array<{ userId: string; name: string }>
    interview: {
      profile: { fullName: string } | null
      company: { name: string } | null
      role: string | null
      round: number | null
      rounds: number | null
      lockedTo: { userId: string; name: string } | null
      /** Older Teamwork servers don't send these. */
      caller?: { userId: string; name: string; level: number | null; color: string } | null
      bidders?: Array<{ userId: string; name: string }>
      resume?: { attachmentId: string; filename: string; size: number } | null
      link?: { url: string; site: string; sharedBy: string | null; sharedAt: string } | null
      canManageResume?: boolean
      canAssign?: boolean
    } | null
  }
}

type Annotations = Record<string, { label: string; url: string; interviewId?: string }>

/** A calendar as Teamwork returns it after an upload. */
interface ServerCalendar {
  id: string
  status: 'active' | 'error' | 'disabled'
  lastError: string | null
  eventCount: number
  profile: { id: string; fullName: string } | null
}

const EMPTY: Connection = { serverUrl: '', email: '', userName: '', userId: '', workspaces: [], workspaceSlug: null, lastSyncAt: null }

class CallerError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    /** Teamwork could not be reached at all (no answer): what was being done can wait and go later. */
    readonly network = false
  ) {
    super(message)
    this.name = 'CallerError'
  }
}

/**
 * "https://teamwork.example.com/" → "https://teamwork.example.com". Plain http
 * is allowed for self-hosted addresses; the sign-in then travels unencrypted,
 * which the Teamwork page points out.
 */
function normalizeServerUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new CallerError('Enter the address of the Teamwork website, like https://teamwork.example.com')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CallerError('The Teamwork address must start with https:// or http://')
  }
  return url.origin
}

/**
 * The address Teamwork actually answers at: an http address that redirects to
 * https (or a www/apex hop) becomes the final one, so the sign-in and every
 * later call go there directly.
 */
async function resolveServerUrl(serverUrl: string): Promise<string> {
  try {
    const response = await fetch(`${serverUrl}/api/health`, { redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    return new URL(response.url || serverUrl).origin
  } catch {
    throw new CallerError('Teamwork could not be reached. Check the address and the internet connection.')
  }
}

/** Where a calendar comes from, for the list: "Proton · Work", a web host, or "File". */
function sourceLabel(calendar: CalendarSource): string {
  if (calendar.accountId) {
    const account = accountRepository.get(calendar.accountId)
    return `Proton · ${account?.label ?? 'account'}`
  }
  if (isFileSource(calendar.sourceUrl)) return 'File'
  return hostOf(calendar.sourceUrl) ?? 'Link'
}

class CallerService {
  /** Uploads per calendar, one after another, so two syncs never race. */
  private uploads = new Map<string, Promise<void>>()

  constructor() {
    // Every successful sync of a shared calendar uploads it.
    syncService.onCalendarSynced((calendar, ics) => {
      void this.uploadShared(calendar, ics)
      void this.uploadPicksOf(calendar.id)
      this.scheduleBusy()
    })
  }

  // ---------------------------------------------------------------------------
  // Busy time: every calendar not shared with a profile goes to Teamwork as
  // start and end times only, so whoever assigns sees when the member is busy.

  private busyTimer: NodeJS.Timeout | null = null
  /** The workspace's Unassigned color (Teamwork's calendar colors). */
  private unassignedColor = UNASSIGNED_COLOR
  private colorsTimer: NodeJS.Timeout | null = null

  /**
   * Changes the Teamwork color behind one of the Teamwork calendars: the
   * caller's member color, or the workspace's Unassigned color. Everyone sees it.
   */
  async setColor(calendarId: string, color: string): Promise<{ queued: boolean }> {
    const slug = this.requireWorkspace()
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new CallerError('Pick a color.')
    const stored = settingsRepository.getInternal<TeamworkCalendars | null>(TEAMWORK_CALENDARS_KEY, null)
    const key = Object.entries(stored?.slug === slug ? stored.byCaller : {}).find(([, id]) => id === calendarId)?.[0]
    if (!key) throw new CallerError('This is not a Teamwork calendar.')
    const queue = (): { queued: boolean } => {
      const name = (calendarRepository.get(calendarId)?.name ?? 'Teamwork').replace(/^Teamwork · /, '')
      this.enqueue({
        slug,
        kind: 'color',
        label: `Color of ${name}`,
        interviewId: null,
        calendarId,
        color: color.toLowerCase(),
        base: (calendarRepository.get(calendarId)?.color ?? '').toLowerCase()
      })
      return { queued: true }
    }
    if (!this.liveUp) return queue()
    try {
      await this.sendColor(slug, key, color)
    } catch (err) {
      if (err instanceof CallerError && err.network) return queue()
      throw err
    }
    await this.refreshInterviews(slug)
    return { queued: false }
  }

  private async sendColor(slug: string, key: string, color: string): Promise<void> {
    try {
      if (key === UNASSIGNED) {
        await this.request(`/workspaces/${slug}/calendar/colors`, { method: 'PUT', body: { unassigned: color.toLowerCase() } })
      } else {
        await this.request(`/workspaces/${slug}/members/${encodeURIComponent(key)}`, { method: 'PATCH', body: { color: color.toLowerCase() } })
      }
    } catch (err) {
      if (err instanceof CallerError && err.status === 403) {
        throw new CallerError('Only owners, the admin and calendar managers change colors on Teamwork.')
      }
      throw err
    }
  }

  /** What this member may do here, and the workspace's Unassigned color (read on every full load). */
  private async refreshWorkspaceInfo(slug: string): Promise<void> {
    const [ctx, colors, members] = await Promise.all([
      this.request<{ membership: { permissions: string[] } }>(`/workspaces/${slug}`),
      this.request<{ unassigned: string }>(`/workspaces/${slug}/calendar/colors`).catch(() => null),
      // The Team view's columns: every caller, with level and color (members who may list members).
      this.request<Array<{ userId: string; name: string; roles: string[]; callerLevel: number | null; status: string; color: string }>>(
        `/workspaces/${slug}/members`
      ).catch(() => null)
    ])
    if (members) {
      this.callers = members
        .filter((m) => m.status === 'active' && m.roles.includes('caller'))
        .map((m) => ({ userId: m.userId, name: m.name, level: m.callerLevel ?? null, color: m.color }))
    }
    if (colors?.unassigned && /^#[0-9a-f]{6}$/i.test(colors.unassigned)) this.unassignedColor = colors.unassigned
    const can = canSetColors(ctx.membership.permissions)
    const c = this.connection()
    if (c.workspaces.some((w) => w.slug === slug && w.canSetColors !== can)) {
      this.saveConnection({ workspaces: c.workspaces.map((w) => (w.slug === slug ? { ...w, canSetColors: can } : w)) })
    }
  }
  private busyMembers: MemberBusy[] = []
  private busyRefreshTimer: NodeJS.Timeout | null = null

  private scheduleBusy(): void {
    if (this.busyTimer) clearTimeout(this.busyTimer)
    this.busyTimer = setTimeout(() => {
      this.busyTimer = null
      void this.sendBusy().catch((err) => {
        console.warn('[teamwork] busy time not sent:', errorText(err))
        const slug = this.connection().workspaceSlug
        if (slug && this.liveUp) this.scheduleRecheck(slug)
      })
    }, BUSY_DEBOUNCE_MS)
  }

  /** The member's busy time: timed events of calendars not shared with a profile (not declined, not picked). */
  private busyBlocks(slug: string): Array<{ start: string; end: string }> {
    const shared = new Set(Object.keys(this.allShares()[slug] ?? {}))
    const picked = new Set(Object.values(this.allPicks()[slug] ?? {}).flatMap((p) => p.eventIds))
    const teamwork = new Set(calendarRepository.list().filter((c) => isTeamworkSource(c.sourceUrl)).map((c) => c.id))
    const from = new Date(Date.now() - DAY_MS).toISOString()
    const to = new Date(Date.now() + BUSY_FUTURE_DAYS * DAY_MS).toISOString()
    return eventRepository
      .listInRange(from, to)
      .filter(
        (e) =>
          e.calendarId &&
          !shared.has(e.calendarId) &&
          !teamwork.has(e.calendarId) &&
          !picked.has(e.id) &&
          !e.allDay &&
          e.myResponse !== 'declined' &&
          Date.parse(e.endTime) - Date.parse(e.startTime) > 0 &&
          Date.parse(e.endTime) - Date.parse(e.startTime) <= BUSY_MAX_MS
      )
      .map((e) => ({ start: new Date(e.startTime).toISOString(), end: new Date(e.endTime).toISOString() }))
      .sort((a, b) => a.start.localeCompare(b.start))
  }

  /** Sends the member's busy time to the chosen workspace (only when it changed, unless `force`). */
  private async sendBusy(force = false): Promise<void> {
    const slug = this.connection().workspaceSlug
    if (!slug || !this.token()) return
    const blocks = this.busyBlocks(slug)
    const hash = fingerprint(JSON.stringify(blocks))
    const sent = settingsRepository.getInternal<Record<string, string>>(BUSY_HASH_KEY, {})
    if (!force && sent[slug] === hash) return
    await this.request(`/workspaces/${slug}/calendar/busy`, { method: 'PUT', body: { blocks, hash } })
    settingsRepository.setInternal(BUSY_HASH_KEY, { ...sent, [slug]: hash })
  }

  /** Other members' busy time, for members who assign or see every interview (others get none). */
  private async refreshBusy(slug: string): Promise<void> {
    const from = new Date(Date.now() - LIVE_PAST_DAYS * DAY_MS).toISOString()
    const to = new Date(Date.now() + LIVE_FUTURE_DAYS * DAY_MS).toISOString()
    try {
      this.busyMembers = await this.request<MemberBusy[]>(
        `/workspaces/${slug}/calendar/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      )
    } catch (err) {
      if (!(err instanceof CallerError && (err.status === 403 || err.status === 404))) throw err
      this.busyMembers = []
    }
  }

  // ---------------------------------------------------------------------------
  // Live updates from Teamwork (Server-Sent Events)

  private live: AbortController | null = null
  private lastEventId: string | null = null
  private interviewsById = new Map<string, AppInterview>()
  private pendingIds = new Set<string>()
  private pendingAssigned = new Set<string>()
  private pendingTimer: NodeJS.Timeout | null = null

  /**
   * Opens the live connection to the chosen workspace (if signed in): the
   * Teamwork calendar is filled once, then only what Teamwork says changed is
   * fetched. Reconnects by itself, catching up on what it missed.
   */
  /** The stream to Teamwork is open right now. */
  private liveUp = false
  private lastCheckedAt: string | null = null
  /** Wakes the retry wait at once (network back, computer awake). */
  private wakeRetry: (() => void) | null = null
  private powerHooked = false

  private setLiveUp(up: boolean): void {
    if (this.liveUp === up) return
    const slug = this.connection().workspaceSlug
    if (!up && slug) this.markOnline(slug)
    this.liveUp = up
    this.notifyChanged()
  }

  private notifyChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.callerChanged)
  }

  startLive(): void {
    if (!this.powerHooked) {
      this.powerHooked = true
      // Waking from sleep: the stream died meanwhile; reconnect at once instead of waiting out the backoff.
      powerMonitor.on('resume', () => this.wakeRetry?.())
    }
    if (this.live) return
    const c = this.connection()
    if (!c.serverUrl || !this.token() || !c.workspaceSlug) return
    // Until Teamwork answers (or while it can't be reached): what it said last time.
    if (this.interviewsById.size === 0) this.loadCache(c.workspaceSlug)
    const abort = new AbortController()
    this.live = abort
    void this.runLive(c.workspaceSlug, abort.signal)
  }

  stopLive(): void {
    this.live?.abort()
    this.live = null
    this.clearRecheck()
    this.setLiveUp(false)
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingTimer = null
    this.pendingIds.clear()
    this.pendingAssigned.clear()
  }

  private restartLive(): void {
    this.stopLive()
    this.lastEventId = null
    this.interviewsById.clear()
    this.startLive()
  }

  /**
   * Holds the live stream open and, every time it opens (sign-in, another
   * workspace, a dropped connection, waking up, the network back), checks
   * everything against Teamwork: reloads the interviews and busy time, and
   * sends again whatever Teamwork doesn't hold in its latest copy. Between
   * opens, only what Teamwork says changed is fetched. No polling.
   */
  private async runLive(slug: string, signal: AbortSignal): Promise<void> {
    let delay = LIVE_RETRY_MIN_MS
    let loaded = false
    while (!signal.aborted) {
      const { serverUrl } = this.connection()
      const token = this.token()
      if (!serverUrl || !token) break
      // This connection only: ended by the watchdog when it goes quiet, or with the whole loop.
      const attempt = new AbortController()
      const endAttempt = (): void => attempt.abort()
      signal.addEventListener('abort', endAttempt)
      let lastByteAt = Date.now()
      // Teamwork sends something at least every 25 s. Silence for longer means the
      // connection died without either side being told (sleep, a network switch):
      // reconnect, catching up on what was missed, instead of waiting forever.
      const watchdog = setInterval(() => {
        if (Date.now() - lastByteAt > STREAM_SILENCE_MS) attempt.abort()
      }, 10_000)
      try {
        const response = await fetch(`${serverUrl}/api/workspaces/${slug}/stream`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: serverUrl,
            Accept: 'text/event-stream',
            ...(this.lastEventId ? { 'Last-Event-ID': this.lastEventId } : {})
          },
          signal: attempt.signal
        })
        if (response.status === 401) {
          this.saveToken(null)
          break
        }
        if (!response.ok || !response.body) throw new Error(`Teamwork answered ${response.status}`)
        delay = LIVE_RETRY_MIN_MS
        this.setLiveUp(true)
        loaded = true
        void this.reconcile(slug)
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
            this.onLiveMessage(slug, buffer.slice(0, end))
            buffer = buffer.slice(end + 2)
          }
        }
      } catch (err) {
        if (signal.aborted) break
        console.warn('[teamwork] live connection dropped:', attempt.signal.aborted ? 'it went quiet' : errorText(err))
      } finally {
        clearInterval(watchdog)
        signal.removeEventListener('abort', endAttempt)
      }
      this.setLiveUp(false)
      if (signal.aborted) break
      // No stream yet (Teamwork down, or an older server): still show what can be loaded.
      if (!loaded) {
        loaded = true
        await this.refreshInterviews(slug).catch((err) => console.warn('[teamwork] first load failed:', errorText(err)))
      }
      await this.waitToRetry(delay, signal)
      delay = Math.min(delay * 2, LIVE_RETRY_MAX_MS)
    }
  }

  /** One Server-Sent Events message: `id:`, `event:` and `data:` lines. */
  private onlineMarkedAt = 0

  private onLiveMessage(slug: string, block: string): void {
    if (Date.now() - this.onlineMarkedAt > 60_000) this.markOnline(slug)
    let event = 'message'
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) this.lastEventId = line.slice(3).trim()
      else if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (event === 'resync') {
      // Teamwork restarted, or this app missed more than it keeps: check everything.
      void this.reconcile(slug)
      return
    }
    if (event === 'colors.changed') {
      if (this.colorsTimer) return
      this.colorsTimer = setTimeout(() => {
        this.colorsTimer = null
        void this.refreshInterviews(slug).catch((err) => console.warn('[teamwork] colors update failed:', errorText(err)))
      }, LIVE_DEBOUNCE_MS)
      return
    }
    if (event === 'busy.changed') {
      if (this.busyRefreshTimer) return
      this.busyRefreshTimer = setTimeout(() => {
        this.busyRefreshTimer = null
        void this.refreshBusy(slug)
          .then(() => this.rebuildTeamwork(slug))
          .catch((err) => console.warn('[teamwork] busy time update failed:', errorText(err)))
      }, LIVE_DEBOUNCE_MS)
      return
    }
    if (event !== 'interviews.changed' || !data) return
    try {
      const message = JSON.parse(data) as { ids?: string[]; assignedToYou?: string[] }
      for (const id of message.ids ?? []) this.pendingIds.add(id)
      for (const id of message.assignedToYou ?? []) this.pendingAssigned.add(id)
    } catch {
      return
    }
    if (!this.pendingTimer) this.pendingTimer = setTimeout(() => void this.flushLive(slug), LIVE_DEBOUNCE_MS)
  }

  /**
   * Waits before reconnecting; ends early when the computer wakes or the
   * network comes back (the operating system is asked every few seconds,
   * no request is made).
   */
  private waitToRetry(delay: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let wasOnline = net.isOnline()
      const done = (): void => {
        clearTimeout(timer)
        clearInterval(watch)
        signal.removeEventListener('abort', done)
        if (this.wakeRetry === done) this.wakeRetry = null
        resolve()
      }
      const timer = setTimeout(done, delay)
      const watch = setInterval(() => {
        const online = net.isOnline()
        if (online && !wasOnline) done()
        wasOnline = online
      }, NETWORK_CHECK_MS)
      signal.addEventListener('abort', done)
      this.wakeRetry = done
    })
  }

  private reconciling = false
  private reconcileAgain = false
  private recheckTimer: NodeJS.Timeout | null = null
  private recheckTries = 0

  /**
   * While connected, something didn't get through (a send failed, an upload
   * erred): the full check runs again after a wait that doubles each time.
   * A reconnect runs it at once anyway.
   */
  private scheduleRecheck(slug: string, soon = false): void {
    if (this.recheckTimer) clearTimeout(this.recheckTimer)
    const delay = soon ? 5_000 : Math.min(RECHECK_MIN_MS * 2 ** this.recheckTries, RECHECK_MAX_MS)
    if (!soon) this.recheckTries++
    this.recheckTimer = setTimeout(() => {
      this.recheckTimer = null
      if (this.liveUp && this.connection().workspaceSlug === slug) void this.reconcile(slug)
    }, delay)
  }

  private clearRecheck(): void {
    if (this.recheckTimer) clearTimeout(this.recheckTimer)
    this.recheckTimer = null
    this.recheckTries = 0
  }

  /**
   * Checks everything against Teamwork: the interviews and busy time shown
   * here, and what Teamwork holds of this member's shared calendars, picked
   * events and busy time (by the fingerprint the app sent with each). What
   * Teamwork doesn't hold in its latest copy is sent again. One at a time;
   * asked again meanwhile, it runs once more after.
   */
  private async reconcile(slug: string): Promise<void> {
    if (this.reconciling) {
      this.reconcileAgain = true
      return
    }
    this.reconciling = true
    try {
      do {
        this.reconcileAgain = false
        let ok = true
        const step = (what: string) => (err: unknown) => {
          ok = false
          console.warn(`[teamwork] ${what}:`, errorText(err))
        }
        await this.refreshInterviews(slug).catch(step('reload failed'))
        await this.notifyMissed(slug).catch(step('missed notifications not read'))
        if (!(await this.flushQueue(slug))) ok = false
        await this.reconcileUploads(slug).catch(step('check of shared calendars failed'))
        await this.reconcileBusy(slug).catch(step('check of busy time failed'))
        this.lastCheckedAt = new Date().toISOString()
        if (ok) this.markOnline(slug)
        this.notifyChanged()
        // Something didn't get through: try again in a while (sooner when the connection reopens).
        if (ok) this.clearRecheck()
        else this.scheduleRecheck(slug)
      } while (this.reconcileAgain && this.connection().workspaceSlug === slug)
    } finally {
      this.reconciling = false
    }
  }

  /** Shared calendars and picks Teamwork doesn't hold in the copy last sent: sent again. */
  private async reconcileUploads(slug: string): Promise<void> {
    const shares = this.allShares()[slug] ?? {}
    const picks = this.allPicks()[slug] ?? {}
    if (Object.keys(shares).length === 0 && Object.keys(picks).length === 0) return
    const userId = this.connection().userId
    const server = await this.request<Array<{ id: string; provider: string; sharedBy: { id: string } | null; clientHash?: string | null }>>(
      `/workspaces/${slug}/calendar/connections`
    )
    const byId = new Map(server.filter((c) => c.provider === 'desktop' && c.sharedBy?.id === userId).map((c) => [c.id, c]))
    const resync: CalendarSource[] = []
    for (const [localId, share] of Object.entries(shares)) {
      // Not listed: probably removed on the website. Only a definite "not found" when sending
      // (uploadShared) stops sharing here, so a short or failed list never drops a share.
      const held = byId.get(share.connectionId)
      if (held?.clientHash && held.clientHash === share.lastHash && !share.lastError) continue
      const calendar = calendarRepository.get(localId)
      if (!calendar) continue
      // Teamwork's copy differs: whatever was recorded as sent, sync and send it.
      this.saveShare(slug, localId, { ...share, lastHash: null })
      resync.push(calendar)
    }
    if (resync.length) await this.syncLocal(resync).catch((err) => console.warn('[teamwork] resync failed:', errorText(err)))
    for (const [profileId, pick] of Object.entries(picks)) {
      const held = byId.get(pick.connectionId)
      if (held?.clientHash && held.clientHash === pick.lastHash && !pick.lastError) continue
      this.savePick(slug, profileId, { ...pick, lastHash: null })
      await this.uploadPick(slug, profileId)
    }
  }

  /** Busy time Teamwork doesn't hold in its latest copy: sent again. */
  private async reconcileBusy(slug: string): Promise<void> {
    const held = await this.request<{ hash: string | null }>(`/workspaces/${slug}/calendar/busy/mine`)
    const hash = fingerprint(JSON.stringify(this.busyBlocks(slug)))
    if (held.hash === hash) return
    await this.sendBusy(true)
  }

  // ---------------------------------------------------------------------------
  // Offline: what Teamwork said last (cache), what was done here (queue), what was missed

  private cachedAt: string | null = null
  private cacheTimer: NodeJS.Timeout | null = null

  /** Saves Teamwork's state shortly after it changes (several changes, one write). */
  private scheduleCacheSave(slug: string): void {
    if (this.cacheTimer) clearTimeout(this.cacheTimer)
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null
      if (this.connection().workspaceSlug !== slug || this.interviewsById.size === 0) return
      const cache: Cache = {
        slug,
        savedAt: new Date().toISOString(),
        items: [...this.interviewsById.values()],
        busy: this.busyMembers,
        unassignedColor: this.unassignedColor,
        callers: this.callers
      }
      settingsRepository.setInternal(CACHE_KEY, cache)
      this.cachedAt = cache.savedAt
    }, 1_000)
  }

  /** Shows what Teamwork said last time, until it answers again. */
  private loadCache(slug: string): void {
    const cache = settingsRepository.getInternal<Cache | null>(CACHE_KEY, null)
    if (!cache || cache.slug !== slug) return
    this.interviewsById = new Map(cache.items.map((i) => [i.event.id, i]))
    this.busyMembers = cache.busy ?? []
    if (cache.unassignedColor) this.unassignedColor = cache.unassignedColor
    if (cache.callers) this.callers = cache.callers
    this.cachedAt = cache.savedAt
    this.rebuildTeamwork(slug)
  }

  private queue(): QueuedAction[] {
    return settingsRepository.getInternal<QueuedAction[] | null>(QUEUE_KEY, null) ?? []
  }

  private saveQueue(list: QueuedAction[]): void {
    settingsRepository.setInternal(QUEUE_KEY, list)
    this.notifyChanged()
  }

  private enqueue(action: Omit<QueuedAction, 'id' | 'createdAt'>): void {
    this.saveQueue([...this.queue(), { ...action, id: randomUUID(), createdAt: new Date().toISOString() }])
    // Connected but the send didn't get through: don't wait for the next reconnect.
    if (this.liveUp) this.scheduleRecheck(action.slug, true)
  }

  cancelQueued(id: string): CallerStatus {
    this.saveQueue(this.queue().filter((q) => q.id !== id))
    return this.status()
  }

  /** What Teamwork says now for what an action changes; null when the interview is gone. */
  private currentOf(a: Pick<QueuedAction, 'kind' | 'interviewId' | 'calendarId'>): string | null {
    if (a.kind === 'color') return a.calendarId ? (calendarRepository.get(a.calendarId)?.color ?? '').toLowerCase() : null
    const i = a.interviewId ? this.interviewsById.get(a.interviewId) : undefined
    if (!i) return null
    const d = i.event.interview
    if (a.kind === 'assign') return d?.caller?.userId ?? i.event.assignees[0]?.userId ?? ''
    if (a.kind === 'link') return d?.link?.url ?? ''
    return d?.resume?.attachmentId ?? ''
  }

  /**
   * Sends what was done here while offline, in order. Each goes only if
   * Teamwork still says what it said when it was done; if someone changed it
   * meanwhile, it isn't overwritten: it's dropped and the member is told.
   * Teamwork unreachable again: the rest waits for the next connection.
   */
  private async flushQueue(slug: string): Promise<boolean> {
    for (const a of this.queue().filter((q) => q.slug === slug)) {
      if (!this.queue().some((q) => q.id === a.id)) continue // cancelled meanwhile
      const now = this.currentOf(a)
      // Already so on Teamwork (it got through before the app could note it, e.g. a crash): done.
      if (now !== null && this.alreadyDone(a, now)) {
        this.saveQueue(this.queue().filter((q) => q.id !== a.id))
        continue
      }
      if (now === null) {
        this.dropQueued(a, a.kind === 'color' ? 'that calendar is gone.' : 'the interview is no longer on Teamwork.')
        continue
      }
      if (now !== a.base) {
        this.dropQueued(a, 'someone changed it on Teamwork meanwhile, so it was not overwritten.')
        continue
      }
      try {
        if (a.kind === 'assign') {
          const result = await this.sendAssign(slug, a.interviewId!, a.callerId ?? null, false)
          if (!result.ok) {
            this.dropQueued(a, `${result.locked} Do it again now that you're online.`)
            continue
          }
        } else if (a.kind === 'link') {
          await this.sendLink(slug, a.interviewId!, a.url ?? null)
        } else if (a.kind === 'resume') {
          await this.sendResume(slug, a.interviewId!, a.path!)
        } else {
          const stored = settingsRepository.getInternal<TeamworkCalendars | null>(TEAMWORK_CALENDARS_KEY, null)
          const key = Object.entries(stored?.slug === slug ? stored.byCaller : {}).find(([, id]) => id === a.calendarId)?.[0]
          if (!key) {
            this.dropQueued(a, 'that calendar is gone.')
            continue
          }
          await this.sendColor(slug, key, a.color!)
          await this.refreshInterviews(slug)
        }
        this.saveQueue(this.queue().filter((q) => q.id !== a.id))
      } catch (err) {
        // Unreachable again: the rest waits, in order, for the next try.
        if (err instanceof CallerError && err.network) return false
        this.dropQueued(a, errorText(err))
      }
    }
    return true
  }

  /** Teamwork already says what the action would make it say. */
  private alreadyDone(a: QueuedAction, now: string): boolean {
    if (a.kind === 'assign') return now === (a.callerId ?? '')
    if (a.kind === 'link') return now === (a.url ?? '')
    if (a.kind === 'color') return now === (a.color ?? '').toLowerCase()
    return false
  }

  private dropQueued(a: QueuedAction, reason: string): void {
    this.saveQueue(this.queue().filter((q) => q.id !== a.id))
    if (!Notification.isSupported()) return
    createNotification({ title: 'Not sent to Teamwork', body: `${a.label}: ${reason}` }).show()
  }

  private markOnline(slug: string): void {
    this.onlineMarkedAt = Date.now()
    const all = settingsRepository.getInternal<Record<string, string> | null>(ONLINE_UNTIL_KEY, null) ?? {}
    settingsRepository.setInternal(ONLINE_UNTIL_KEY, { ...all, [slug]: new Date().toISOString() })
  }

  /**
   * After being away: one desktop notification summing up what Teamwork told
   * the member meanwhile (unread, from the last week). Clicking opens them.
   */
  private async notifyMissed(slug: string): Promise<void> {
    const since = (settingsRepository.getInternal<Record<string, string> | null>(ONLINE_UNTIL_KEY, null) ?? {})[slug]
    if (!since) return
    const cutoff = Math.max(Date.parse(since), Date.now() - MISSED_DAYS * DAY_MS)
    const page = await this.request<{ items: Array<{ type: string; readAt: string | null; createdAt: string }> }>(
      `/workspaces/${slug}/notifications?unread=true&limit=50`
    )
    const missed = page.items.filter((n) => !n.readAt && Date.parse(n.createdAt) > cutoff)
    if (missed.length === 0 || !Notification.isSupported()) return
    const count = (pick: (type: string) => boolean): number => missed.filter((n) => pick(n.type)).length
    const assigned = count((t) => t === 'interview.assigned' || t === 'event.assigned')
    const updates = count((t) => t === 'interview.changed' || t.startsWith('event.'))
    const others = missed.length - assigned - updates
    const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
    const parts = [
      assigned ? `${plural(assigned, 'interview', 'interviews')} assigned to you` : '',
      updates ? plural(updates, 'interview update', 'interview updates') : '',
      others ? plural(others, 'other notification', 'other notifications') : ''
    ].filter(Boolean)
    const notification = createNotification({ title: 'While you were away', body: `${parts.join(', ')}.` })
    notification.on('click', () => void shell.openExternal(`${this.connection().serverUrl}/app/${slug}/notifications`))
    notification.show()
  }

  /** Fetches just the interviews Teamwork said changed. */
  private async flushLive(slug: string): Promise<void> {
    this.pendingTimer = null
    const ids = [...this.pendingIds]
    const assigned = new Set(this.pendingAssigned)
    this.pendingIds.clear()
    this.pendingAssigned.clear()
    if (ids.length === 0) return
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const page = await this.request<{ items: AppInterview[]; removed: string[] }>(
          `/workspaces/${slug}/events/app?ids=${ids.slice(i, i + 200).join(',')}`
        )
        for (const id of page.removed) this.interviewsById.delete(id)
        for (const item of page.items) {
          const before = this.interviewsById.get(item.event.id)
          this.interviewsById.set(item.event.id, item)
          if (assigned.has(item.event.id) && item.assignedToMe) this.notifyAssigned(slug, item)
          else if (before && item.assignedToMe && this.resumeAdded(before, item)) this.notifyResume(item)
        }
      }
      this.rebuildTeamwork(slug)
    } catch (err) {
      console.warn('[teamwork] update failed:', errorText(err))
    }
  }

  /** Loads every interview in the Teamwork calendar's window (first connection, or a resync). */
  private async refreshInterviews(slug: string): Promise<void> {
    const from = new Date(Date.now() - LIVE_PAST_DAYS * DAY_MS).toISOString()
    const to = new Date(Date.now() + LIVE_FUTURE_DAYS * DAY_MS).toISOString()
    const page = await this.request<{ items: AppInterview[] }>(
      `/workspaces/${slug}/events/app?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    )
    this.interviewsById = new Map(page.items.map((i) => [i.event.id, i]))
    await Promise.all([
      this.refreshBusy(slug).catch((err) => console.warn('[teamwork] busy time not loaded:', errorText(err))),
      this.refreshWorkspaceInfo(slug).catch((err) => console.warn('[teamwork] workspace not loaded:', errorText(err)))
    ])
    this.rebuildTeamwork(slug)
  }

  /** "Acme – Engineer", or the invitation's title. */
  private labelOf(i: AppInterview): string {
    const d = i.event.interview
    return d?.company && d.role ? `${d.company.name} – ${d.role}` : i.event.title || 'Interview'
  }

  private detailsOf(i: AppInterview): string {
    const d = i.event.interview
    const round = d?.round ? (d.rounds && d.rounds > 1 ? `Round ${d.round} of ${d.rounds}` : `Round ${d.round}`) : null
    const caller = i.event.assignees[0]?.name
    return [this.labelOf(i), round, d?.profile?.fullName, caller ? `Caller: ${caller}` : 'No caller yet'].filter(Boolean).join(' · ')
  }

  /** Who takes it: the caller Teamwork names, or the first assignee on older servers. */
  private callerOf(i: AppInterview): TeamworkInterview['caller'] {
    const c = i.event.interview?.caller ?? (i.event.assignees[0] ? { ...i.event.assignees[0], level: null, color: '#7c3aed' } : null)
    return c ? { name: c.name, level: c.level, color: c.color, mine: i.assignedToMe } : null
  }

  private interviewOf(i: AppInterview): TeamworkInterview {
    const d = i.event.interview
    return {
      id: i.event.id,
      company: d?.company?.name ?? null,
      role: d?.role ?? null,
      round: d?.round ? (d.rounds && d.rounds > 1 ? `Round ${d.round} of ${d.rounds}` : `Round ${d.round}`) : null,
      locked: Boolean(d?.lockedTo),
      profile: d?.profile?.fullName ?? null,
      bidders: (d?.bidders ?? []).map((b) => b.name),
      caller: this.callerOf(i),
      resume: d?.resume ? { filename: d.resume.filename, size: d.resume.size } : null,
      link:
        d?.link && /^https?:\/\//i.test(d.link.url) ? { url: d.link.url, site: d.link.site, sharedBy: d.link.sharedBy } : null,
      canUploadResume: Boolean(d?.canManageResume),
      canAssign: Boolean(d?.canAssign) && i.event.status !== 'cancelled',
      callerId: d?.caller?.userId ?? i.event.assignees[0]?.userId ?? null,
      pending: this.queue()
        .filter((q) => q.interviewId === i.event.id)
        .map((q) => q.label)
    }
  }

  /** The callers to choose from, as Teamwork's assignment rule ranks them (recommended first). */
  async candidates(interviewId: string): Promise<CallerCandidate[]> {
    const slug = this.requireWorkspace()
    if (!this.liveUp) return this.offlineCandidates()
    let rec: {
      candidates: Array<{
        caller: { id: string; name: string; level: number | null }
        interviewCount: number
        status: CallerCandidate['status']
        recommended: boolean
      }>
    }
    try {
      rec = await this.fetchCandidates(slug, interviewId)
    } catch (err) {
      if (err instanceof CallerError && err.network) return this.offlineCandidates()
      throw err
    }
    const list = rec.candidates.map((c) => ({
      userId: c.caller.id,
      name: c.caller.name,
      level: c.caller.level,
      status: c.status,
      interviewCount: c.interviewCount,
      recommended: c.recommended
    }))
    return [...list.filter((c) => c.recommended), ...list.filter((c) => !c.recommended)]
  }

  /** Offline: the callers this app knows from Teamwork's last state, without Teamwork's ranking. */
  private offlineCandidates(): CallerCandidate[] {
    const counts = new Map<string, number>()
    for (const i of this.interviewsById.values()) {
      const id = i.event.interview?.caller?.userId ?? i.event.assignees[0]?.userId
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return [...this.knownCallers()]
      .map(([userId, name]) => ({ userId, name, level: null, status: 'unknown' as const, interviewCount: counts.get(userId) ?? 0, recommended: false }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Callers (and members with busy time) this app knows: id → name. */
  private knownCallers(): Map<string, string> {
    const known = new Map<string, string>()
    for (const i of this.interviewsById.values()) {
      const c = i.event.interview?.caller ?? i.event.assignees[0]
      if (c) known.set(c.userId, c.name)
    }
    for (const m of this.busyMembers) known.set(m.userId, m.name)
    return known
  }

  private fetchCandidates(slug: string, interviewId: string) {
    return this.request<{
      candidates: Array<{
        caller: { id: string; name: string; level: number | null }
        interviewCount: number
        status: CallerCandidate['status']
        recommended: boolean
      }>
    }>(`/workspaces/${slug}/events/${encodeURIComponent(interviewId)}/recommendation`)
  }

  /**
   * Gives the interview to a caller. A later round stays with the earlier
   * round's caller: others are refused, the admin is asked first (`locked`),
   * then sends `force`.
   */
  async assign(interviewId: string, callerId: string | null, force: boolean): Promise<CallerAssignResult> {
    const slug = this.requireWorkspace()
    const queue = (): CallerAssignResult => {
      const i = this.interviewsById.get(interviewId)
      const who = callerId ? (this.knownCallers().get(callerId) ?? 'a caller') : null
      this.enqueue({
        slug,
        kind: 'assign',
        label: `${who ? `Assign ${who}` : 'Unassign'} → ${i ? this.labelOf(i) : 'interview'}`,
        interviewId,
        callerId,
        base: this.currentOf({ kind: 'assign', interviewId }) ?? ''
      })
      return { ok: true, queued: true }
    }
    if (!this.liveUp) return queue()
    try {
      return await this.sendAssign(slug, interviewId, callerId, force)
    } catch (err) {
      if (err instanceof CallerError && err.network) return queue()
      throw err
    }
  }

  private async sendAssign(slug: string, interviewId: string, callerId: string | null, force: boolean): Promise<CallerAssignResult> {
    try {
      await this.request(`/workspaces/${slug}/events/${encodeURIComponent(interviewId)}/caller`, {
        method: 'PUT',
        body: { callerId, force, notify: true }
      })
    } catch (err) {
      if (err instanceof CallerError && err.status === 409) return { ok: false, locked: err.message }
      throw err
    }
    const page = await this.request<{ items: AppInterview[]; removed: string[] }>(
      `/workspaces/${slug}/events/app?ids=${encodeURIComponent(interviewId)}`
    )
    for (const id of page.removed) this.interviewsById.delete(id)
    for (const item of page.items) this.interviewsById.set(item.event.id, item)
    this.rebuildTeamwork(slug)
    return { ok: true }
  }

  private tagOf(i: AppInterview): CallerTag {
    return { caller: this.callerOf(i), round: i.event.interview?.round ?? null, locked: Boolean(i.event.interview?.lockedTo) }
  }

  /** Every caller of the workspace (from the members list), for the Team view's columns. */
  private callers: Array<{ userId: string; name: string; level: number | null; color: string }> = []
  /** Interview id → the event in this app that shows it. */
  private eventIdByInterview: Record<string, string> = {}

  /**
   * The Team view's Day board, as on the Teamwork website: every caller (by
   * level) with their interviews of the day, and the ones nobody has yet.
   * Members who can't list members see the callers this app knows from the
   * interviews instead.
   */
  teamBoard(from: string, to: string): TeamBoard {
    const c = this.connection()
    const signedIn = Boolean(c.serverUrl && this.token() && c.workspaceSlug)
    const start = Date.parse(from)
    const end = Date.parse(to)
    const myId = c.userId
    const queued = new Set(this.queue().map((q) => q.interviewId).filter(Boolean))
    const cards = [...this.interviewsById.values()]
      .filter((i) => Date.parse(i.event.start) < end && Date.parse(i.event.end) > start)
      .sort((a, b) => a.event.start.localeCompare(b.event.start))
      .map((i) => {
        const d = i.event.interview
        const round = d?.round ? `R${d.round}` : null
        const eventId = this.eventIdByInterview[i.event.id] ?? null
        return {
          interviewId: i.event.id,
          eventId,
          company: d?.company?.name ?? null,
          status: eventId ? (eventRepository.get(eventId)?.status ?? null) : null,
          start: i.event.start,
          end: i.event.end,
          title: this.labelOf(i),
          profile: d?.profile?.fullName ?? null,
          round,
          lockedTo: d?.lockedTo ? { userId: d.lockedTo.userId, name: d.lockedTo.name } : null,
          callerId: d?.caller?.userId ?? i.event.assignees[0]?.userId ?? null,
          needsDetails: !(d?.company && d.role),
          cancelled: i.event.status === 'cancelled',
          canAssign: Boolean(d?.canAssign) && i.event.status !== 'cancelled',
          pending: queued.has(i.event.id)
        }
      })
    // Callers: the workspace's (with levels), else the ones these interviews name.
    const byId = new Map<string, TeamBoardCaller>()
    for (const k of this.callers) byId.set(k.userId, { ...k, mine: k.userId === myId })
    if (byId.size === 0) {
      for (const i of this.interviewsById.values()) {
        const k = i.event.interview?.caller
        if (k && !byId.has(k.userId)) byId.set(k.userId, { userId: k.userId, name: k.name, level: k.level, color: k.color, mine: k.userId === myId })
      }
    }
    // An interview's caller who isn't listed (no longer a caller) still gets a column.
    for (const card of cards) {
      if (!card.callerId || byId.has(card.callerId)) continue
      const i = this.interviewsById.get(card.interviewId)
      const k = i?.event.interview?.caller ?? i?.event.assignees[0]
      if (k) byId.set(card.callerId, { userId: card.callerId, name: k.name, level: (k as { level?: number | null }).level ?? null, color: (k as { color?: string }).color ?? UNASSIGNED_COLOR, mine: card.callerId === myId })
    }
    return {
      signedIn,
      callers: [...byId.values()].sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name)),
      cards,
      canAssign: cards.some((x) => x.canAssign),
      unassignedColor: this.unassignedColor,
      offlineSince: this.liveUp ? null : this.cachedAt
    }
  }

  /** Caller tags of the events that are Teamwork interviews (built with the Teamwork calendar). */
  private tagsByEvent: Record<string, CallerTag> = {}

  tags(): Record<string, CallerTag> {
    return this.tagsByEvent
  }

  private resumeAdded(before: AppInterview, after: AppInterview): boolean {
    const next = after.event.interview?.resume?.attachmentId
    return Boolean(next && next !== before.event.interview?.resume?.attachmentId)
  }

  /** Shares one link on the interview for everyone on it, or removes it (null). */
  async shareLink(interviewId: string, url: string | null): Promise<{ queued: boolean }> {
    const slug = this.requireWorkspace()
    const link = url === null ? null : url.trim()
    if (link !== null && !/^https?:\/\/\S+$/i.test(link)) throw new CallerError('Paste a link that starts with https://')
    const queue = (): { queued: boolean } => {
      const i = this.interviewsById.get(interviewId)
      this.enqueue({
        slug,
        kind: 'link',
        label: `${link ? 'Share a link' : 'Remove the link'} → ${i ? this.labelOf(i) : 'interview'}`,
        interviewId,
        url: link,
        base: this.currentOf({ kind: 'link', interviewId }) ?? ''
      })
      return { queued: true }
    }
    if (!this.liveUp) return queue()
    try {
      await this.sendLink(slug, interviewId, link)
    } catch (err) {
      if (err instanceof CallerError && err.network) return queue()
      throw err
    }
    return { queued: false }
  }

  private async sendLink(slug: string, interviewId: string, link: string | null): Promise<void> {
    const path = `/workspaces/${slug}/events/${encodeURIComponent(interviewId)}/link`
    if (link === null) await this.request(path, { method: 'DELETE' })
    else await this.request(path, { method: 'PUT', body: { url: link } })
    await this.refreshInterview(slug, interviewId)
  }

  /** Shows a change right away; Teamwork's live update follows for everyone else. */
  private async refreshInterview(slug: string, interviewId: string): Promise<void> {
    const page = await this.request<{ items: AppInterview[] }>(`/workspaces/${slug}/events/app?ids=${encodeURIComponent(interviewId)}`)
    for (const item of page.items) this.interviewsById.set(item.event.id, item)
    this.rebuildTeamwork(slug)
  }

  /**
   * Picks a PDF or Word file and makes it the interview's resume on Teamwork,
   * as the website does: an upload target for the profile + company + role,
   * the file to storage, then attached (the old one is replaced, the caller told).
   */
  async uploadResume(interviewId: string): Promise<{ name: string; queued: boolean } | null> {
    const slug = this.requireWorkspace()
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Upload resume',
      properties: ['openFile' as const],
      filters: [{ name: 'Resume (PDF or Word)', extensions: ['pdf', 'doc', 'docx'] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = picked.canceled ? undefined : picked.filePaths[0]
    if (!path) return null
    const contentType = RESUME_TYPES[extname(path).toLowerCase()]
    if (!contentType) throw new CallerError('A resume must be a PDF or Word file (.pdf, .doc or .docx).')
    const { size } = await stat(path)
    if (size === 0) throw new CallerError('This file is empty.')
    if (size > MAX_RESUME_BYTES) throw new CallerError('A resume can be at most 10 MB.')
    const filename = basename(path).slice(0, 200)
    const queue = (): { name: string; queued: boolean } => {
      const i = this.interviewsById.get(interviewId)
      this.enqueue({
        slug,
        kind: 'resume',
        label: `Resume ${filename} → ${i ? this.labelOf(i) : 'interview'}`,
        interviewId,
        path,
        base: this.currentOf({ kind: 'resume', interviewId }) ?? ''
      })
      return { name: filename, queued: true }
    }
    if (!this.liveUp) return queue()
    try {
      await this.sendResume(slug, interviewId, path)
    } catch (err) {
      if (err instanceof CallerError && err.network) return queue()
      throw err
    }
    return { name: filename, queued: false }
  }

  /** Uploads a resume file from this computer and makes it the interview's resume. */
  private async sendResume(slug: string, interviewId: string, path: string): Promise<void> {
    const contentType = RESUME_TYPES[extname(path).toLowerCase()]
    if (!contentType) throw new CallerError('A resume must be a PDF or Word file (.pdf, .doc or .docx).')
    let data: Buffer
    try {
      data = await readFile(path)
    } catch {
      throw new CallerError('The file is no longer where it was picked from.')
    }
    const size = data.length
    const filename = basename(path).slice(0, 200)

    const { targetId } = await this.request<{ targetId: string }>(`/workspaces/${slug}/events/${interviewId}/resume/slot`, { method: 'POST', body: {} })
    const ticket = await this.request<{ attachment: { id: string }; upload: { url: string; headers: Record<string, string> } }>(
      `/workspaces/${slug}/files/uploads`,
      { method: 'POST', body: { targetType: 'interview_resume', targetId, filename, contentType, size } }
    )
    const uploadUrl = /^https?:\/\//i.test(ticket.upload.url) ? ticket.upload.url : `${this.connection().serverUrl}${ticket.upload.url}`
    let stored: Response
    try {
      stored = await fetch(uploadUrl, { method: 'PUT', headers: ticket.upload.headers, body: data, signal: AbortSignal.timeout(5 * 60_000) })
    } catch {
      throw new CallerError('The resume could not be uploaded. Check the internet connection.', 0, true)
    }
    if (!stored.ok) throw new CallerError(`Teamwork's file storage refused the upload (${stored.status}).`)
    await this.request(`/workspaces/${slug}/files/${ticket.attachment.id}/complete`, { method: 'POST', body: {} })
    await this.request(`/workspaces/${slug}/events/${interviewId}/resume/file`, { method: 'PUT', body: { attachmentId: ticket.attachment.id } })
    await this.refreshInterview(slug, interviewId)
  }

  /**
   * Saves an interview's resume (uploaded on Teamwork by an owner, the admin or a bidder)
   * where the member picks, Downloads by default, and shows it in its folder.
   */
  async downloadResume(interviewId: string): Promise<string | null> {
    const slug = this.requireWorkspace()
    let interview = this.interviewsById.get(interviewId)
    if (!interview?.event.interview?.resume) {
      const page = await this.request<{ items: AppInterview[] }>(`/workspaces/${slug}/events/app?ids=${encodeURIComponent(interviewId)}`)
      interview = page.items[0]
      if (interview) this.interviewsById.set(interview.event.id, interview)
    }
    const resume = interview?.event.interview?.resume
    if (!resume) throw new CallerError('This interview has no resume on Teamwork.')
    const ticket = await this.request<{ url: string }>(`/workspaces/${slug}/files/${resume.attachmentId}/download`)
    const url = /^https?:\/\//i.test(ticket.url) ? ticket.url : `${this.connection().serverUrl}${ticket.url}`
    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) })
    } catch {
      throw new CallerError('The resume could not be downloaded. Check the internet connection.')
    }
    if (!response.ok) throw new CallerError(`The resume could not be downloaded (${response.status}).`)
    const data = Buffer.from(await response.arrayBuffer())
    const safeName = resume.filename.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 150) || 'resume.pdf'
    const win = BrowserWindow.getFocusedWindow()
    const options = { title: 'Save resume', defaultPath: join(app.getPath('downloads'), safeName) }
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return null
    await writeFile(picked.filePath, data)
    shell.showItemInFolder(picked.filePath)
    return picked.filePath
  }

  private urlOf(slug: string, id: string): string {
    return `${this.connection().serverUrl}/app/${slug}/calendar/${id}`
  }

  /**
   * Writes the Teamwork calendars: workspace interviews that aren't already the
   * member's own events, one calendar per caller (and one for unassigned ones),
   * so whoever assigns sees when each caller is busy. An interview that came
   * from one of the member's shared calendars or picked events is shown on that
   * event instead (its details card).
   */
  private rebuildTeamwork(slug: string): void {
    const shares = this.allShares()[slug] ?? {}
    const picks = this.allPicks()[slug] ?? {}
    const ownCalendars = new Map(Object.entries(shares).map(([localId, share]) => [share.connectionId, localId]))
    const ownPicks = new Map(Object.values(picks).map((pick) => [pick.connectionId, pick.eventIds]))
    const annotations: Annotations = {}
    const tags: Record<string, CallerTag> = {}
    const eventIds: Record<string, string> = {}
    type Row = Parameters<typeof eventRepository.replaceCalendarEvents>[1][number]
    const groups = new Map<
      string,
      { name: string; color: string; mine: boolean; rows: Array<{ key: string; tag: CallerTag | null; row: Omit<Row, 'id'> }> }
    >()
    for (const i of this.interviewsById.values()) {
      if (i.event.status === 'cancelled') continue
      const own = this.ownEventOf(i, ownCalendars, ownPicks)
      const label = this.detailsOf(i)
      if (own) {
        annotations[own] = { label, url: this.urlOf(slug, i.event.id), interviewId: i.event.id }
        tags[own] = this.tagOf(i)
        eventIds[i.event.id] = own
        continue
      }
      const caller = this.callerOf(i)
      const key = i.event.interview?.caller?.userId ?? i.event.assignees[0]?.userId ?? UNASSIGNED
      let group = groups.get(key)
      if (!group) {
        group = caller
          ? { name: caller.mine ? `${caller.name} (you)` : caller.name, color: caller.color, mine: caller.mine, rows: [] }
          : { name: 'Unassigned', color: this.unassignedColor, mine: false, rows: [] }
        groups.set(key, group)
      }
      const meeting = i.event.meetingUrl ?? ''
      group.rows.push({
        key: i.event.id,
        tag: this.tagOf(i),
        row: {
          externalId: i.event.id,
          title: this.labelOf(i),
          description: [label, `Open on Teamwork: ${this.urlOf(slug, i.event.id)}`, i.event.description].filter(Boolean).join('\n\n'),
          startTime: i.event.start,
          endTime: i.event.end,
          allDay: false,
          location: meeting || i.event.location,
          attendees: i.event.attendees,
          myResponse: null
        }
      })
    }
    // Other members' busy time from their apps, on their calendars (times only).
    for (const member of this.busyMembers) {
      if (member.mine) continue
      let group = groups.get(member.userId)
      if (!group) {
        group = { name: member.name, color: member.color, mine: false, rows: [] }
        groups.set(member.userId, group)
      }
      for (const block of member.blocks) {
        group.rows.push({
          key: `busy:${member.userId}:${block.start}`,
          tag: null,
          row: {
            externalId: `busy:${member.userId}:${block.start}`,
            title: 'Busy',
            description: `${member.name} is busy (from their own calendar on Teamwork).`,
            startTime: block.start,
            endTime: block.end,
            allDay: false,
            location: '',
            attendees: [],
            myResponse: null
          }
        })
      }
    }
    const calendarIds = this.teamworkCalendars(slug, groups)
    for (const [key, group] of groups) {
      const calendarId = calendarIds.get(key)!
      for (const r of group.rows) {
        if (!r.tag) continue
        tags[makeEventId(calendarId, r.key)] = r.tag
        eventIds[r.key] = makeEventId(calendarId, r.key)
      }
      eventRepository.replaceCalendarEvents(
        calendarId,
        group.rows.map(({ key: rowKey, row }) => ({ ...row, id: makeEventId(calendarId, rowKey) }))
      )
      calendarRepository.setSyncSuccess(calendarId, null)
    }
    settingsRepository.setInternal(ANNOTATIONS_KEY, annotations)
    this.tagsByEvent = tags
    this.eventIdByInterview = eventIds
    this.scheduleCacheSave(slug)
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.callerChanged)
  }

  /** The member's own local event behind an interview, if it came from their shared calendar or a pick. */
  private ownEventOf(i: AppInterview, ownCalendars: Map<string, string>, ownPicks: Map<string, string[]>): string | null {
    const source = i.source
    if (!source) return null
    const pickIds = ownPicks.get(source.connectionId)
    if (pickIds) {
      return pickIds.find((id) => eventRepository.get(id)?.externalId === source.uid) ?? null
    }
    const localCalendarId = ownCalendars.get(source.connectionId)
    if (!localCalendarId) return null
    // A single event's id is its UID; a repeating one's "UID::<original time>": match the UID and the time.
    const single = eventRepository.get(makeEventId(localCalendarId, source.uid))
    if (single) return single.id
    const start = Date.parse(i.event.start)
    const near = eventRepository.listInRange(new Date(start - DAY_MS).toISOString(), new Date(start + DAY_MS).toISOString())
    return (
      near.find(
        (e) => e.calendarId === localCalendarId && e.externalId?.startsWith(`${source.uid}::`) && Date.parse(e.startTime) === start
      )?.id ?? null
    )
  }

  /**
   * The Teamwork calendar of each caller with interviews here: created the first
   * time (in the caller's Teamwork color; reminders only for the member's own),
   * renamed when the caller is, and removed once nothing is left on it. The
   * member's on/off choice and color stay as long as the calendar does.
   */
  private teamworkCalendars(slug: string, groups: Map<string, { name: string; color: string; mine: boolean }>): Map<string, string> {
    this.removeLegacyTeamworkCalendar()
    const stored = settingsRepository.getInternal<TeamworkCalendars | null>(TEAMWORK_CALENDARS_KEY, null)
    const byCaller: Record<string, string> = {}
    // Another workspace now: start over.
    const previous = stored?.slug === slug ? stored.byCaller : {}
    if (stored && stored.slug !== slug) for (const id of Object.values(stored.byCaller)) this.removeCalendar(id)
    for (const [key, group] of groups) {
      const name = `Teamwork · ${group.name}`.slice(0, 80)
      const existing = previous[key] ? calendarRepository.get(previous[key]) : null
      if (existing) {
        // Colors are set on Teamwork (or from here, which saves there): the calendar follows.
        if (existing.name !== name || existing.color.toLowerCase() !== group.color.toLowerCase()) {
          calendarRepository.update(existing.id, { name, color: group.color })
        }
        byCaller[key] = existing.id
      } else {
        byCaller[key] = calendarRepository.create({
          name,
          color: group.color,
          sourceUrl: `${TEAMWORK_SOURCE_PREFIX}${slug}/${key}`,
          enabled: true,
          notify: group.mine
        }).id
      }
    }
    for (const [key, id] of Object.entries(previous)) if (!byCaller[key]) this.removeCalendar(id)
    settingsRepository.setInternal(TEAMWORK_CALENDARS_KEY, { slug, byCaller })
    return new Map(Object.entries(byCaller))
  }

  private removeCalendar(id: string): void {
    if (calendarRepository.get(id)) calendarRepository.remove(id)
  }

  private removeLegacyTeamworkCalendar(): void {
    const legacy = settingsRepository.getInternal<{ slug: string; calendarId: string } | null>(TEAMWORK_CALENDAR_KEY, null)
    if (!legacy) return
    this.removeCalendar(legacy.calendarId)
    settingsRepository.setInternal(TEAMWORK_CALENDAR_KEY, null)
  }

  /** Signing out: the Teamwork calendars and the Teamwork details of own events go away. */
  private clearTeamwork(): void {
    this.removeLegacyTeamworkCalendar()
    const stored = settingsRepository.getInternal<TeamworkCalendars | null>(TEAMWORK_CALENDARS_KEY, null)
    for (const id of Object.values(stored?.byCaller ?? {})) this.removeCalendar(id)
    settingsRepository.setInternal(TEAMWORK_CALENDARS_KEY, null)
    settingsRepository.setInternal(ANNOTATIONS_KEY, {})
    this.interviewsById.clear()
    this.busyMembers = []
    this.tagsByEvent = {}
    settingsRepository.setInternal(CACHE_KEY, null)
    settingsRepository.setInternal(QUEUE_KEY, [])
    this.cachedAt = null
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.callerChanged)
  }

  /** A desktop notification for an interview newly assigned to the member. */
  private notifyAssigned(slug: string, i: AppInterview): void {
    if (!Notification.isSupported()) return
    const when = new Date(i.event.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const notification = createNotification({ title: 'New interview assigned to you', body: `${this.labelOf(i)} · ${when}` })
    notification.on('click', () => void shell.openExternal(this.urlOf(slug, i.event.id)))
    notification.show()
  }

  /** A desktop notification when a resume is added to one of the member's interviews. */
  private notifyResume(i: AppInterview): void {
    if (!Notification.isSupported()) return
    const notification = createNotification({
      title: 'Resume added',
      body: `${this.labelOf(i)}: ${i.event.interview?.resume?.filename ?? 'resume'} is ready to download.`
    })
    notification.on('click', () => void this.downloadResume(i.event.id).catch(() => undefined))
    notification.show()
  }

  private annotations(): Annotations {
    return settingsRepository.getInternal<Annotations>(ANNOTATIONS_KEY, {})
  }

  private allPicks(): PicksByWorkspace {
    return settingsRepository.getInternal<PicksByWorkspace>(PICKS_KEY, {})
  }

  private savePick(slug: string, profileId: string, pick: StoredPick | null): void {
    const all = this.allPicks()
    const forWorkspace = { ...(all[slug] ?? {}) }
    if (pick) forWorkspace[profileId] = pick
    else delete forWorkspace[profileId]
    settingsRepository.setInternal(PICKS_KEY, { ...all, [slug]: forWorkspace })
  }

  private connection(): Connection {
    return { ...EMPTY, ...settingsRepository.getInternal<Partial<Connection>>(CONNECTION_KEY, {}) }
  }

  private saveConnection(patch: Partial<Connection>): Connection {
    const next = { ...this.connection(), ...patch }
    settingsRepository.setInternal(CONNECTION_KEY, next)
    return next
  }

  private token(): string | null {
    const stored = settingsRepository.getInternal<string | null>(TOKEN_KEY, null)
    if (!stored) return null
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  private saveToken(token: string | null): void {
    if (token && !safeStorage.isEncryptionAvailable()) {
      throw new CallerError('This computer cannot store the sign-in securely, so it was not saved.')
    }
    settingsRepository.setInternal(TOKEN_KEY, token ? safeStorage.encryptString(token).toString('base64') : null)
  }

  private allShares(): SharesByWorkspace {
    return settingsRepository.getInternal<SharesByWorkspace>(SHARES_KEY, {})
  }

  private saveShare(slug: string, localId: string, share: StoredShare | null): void {
    const all = this.allShares()
    const forWorkspace = { ...(all[slug] ?? {}) }
    if (share) forWorkspace[localId] = share
    else delete forWorkspace[localId]
    settingsRepository.setInternal(SHARES_KEY, { ...all, [slug]: forWorkspace })
  }

  /** Calls the Teamwork API. A 401 means the session ended: the sign-in is forgotten. */
  private async request<T>(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
    const { serverUrl } = this.connection()
    const token = init.token === undefined ? this.token() : init.token
    if (!serverUrl || !token) throw new CallerError('Sign in to Teamwork first', 401)
    let response: Response
    try {
      response = await fetch(`${serverUrl}/api${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          // Teamwork's CSRF protection wants the site's own origin on changes, as its pages send.
          Origin: serverUrl,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch {
      throw new CallerError('Teamwork could not be reached. Check the internet connection and the address.', 0, true)
    }
    if (response.status === 401) {
      this.saveToken(null)
      throw new CallerError('Your Teamwork sign-in ended. Sign in again.', 401)
    }
    const text = await response.text()
    let body: unknown
    try {
      body = text ? (JSON.parse(text) as unknown) : undefined
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const message = (body as { error?: { message?: string } } | undefined)?.error?.message
      throw new CallerError(message ?? `Teamwork answered with an error (${response.status})`, response.status)
    }
    return body as T
  }

  // ---------------------------------------------------------------------------
  // Sign-in and workspace

  status(): CallerStatus {
    const c = this.connection()
    return {
      serverUrl: c.serverUrl,
      email: c.email,
      userName: c.userName,
      workspaces: c.workspaces,
      workspaceSlug: c.workspaceSlug,
      lastSyncAt: c.lastSyncAt,
      signedIn: Boolean(c.serverUrl && this.token()),
      live: this.liveUp ? 'connected' : this.live ? 'connecting' : 'off',
      lastCheckedAt: this.lastCheckedAt,
      queue: this.queue()
        .filter((q) => q.slug === c.workspaceSlug)
        .map(({ id, kind, label, createdAt, interviewId }) => ({ id, kind, label, createdAt, interviewId })),
      cachedAt: this.liveUp ? null : this.cachedAt
    }
  }

  async signIn(rawServerUrl: string, email: string, password: string): Promise<CallerStatus> {
    const serverUrl = await resolveServerUrl(normalizeServerUrl(rawServerUrl))
    let response: Response
    try {
      response = await fetch(`${serverUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: serverUrl },
        body: JSON.stringify({ email: email.trim(), password }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch {
      throw new CallerError('Teamwork could not be reached. Check the address and the internet connection.')
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: { message?: string } }
      throw new CallerError(body.error?.message ?? body.message ?? 'Sign-in failed. Check the email and password.')
    }
    const token = response.headers.get('set-auth-token')
    if (!token) throw new CallerError('This Teamwork server does not support the desktop app yet.')

    this.saveConnection({ serverUrl })
    const me = await this.request<{
      user: { id: string; name: string; email: string }
      memberships: Array<{ workspace: { slug: string; name: string } }>
    }>('/me', { token })
    const workspaces: CallerWorkspace[] = []
    for (const m of me.memberships) {
      const ctx = await this.request<{ membership: { permissions: string[] } }>(`/workspaces/${m.workspace.slug}`, { token })
      workspaces.push({
        slug: m.workspace.slug,
        name: m.workspace.name,
        canShareAny: ctx.membership.permissions.includes('calendarSources.manage'),
        canSetColors: canSetColors(ctx.membership.permissions)
      })
    }
    if (workspaces.length === 0) throw new CallerError('This account is not a member of any workspace yet.')
    // Another account on this computer: its sharing, picks and waiting changes are set aside (and come
    // back when it signs in again); nothing of one account is shown to, or sent as, the other.
    const before = this.connection().userId
    if (before && before !== me.user.id) this.switchAccount(before, me.user.id)
    this.saveToken(token)
    const previous = this.connection().workspaceSlug
    this.saveConnection({
      email: me.user.email,
      userName: me.user.name,
      userId: me.user.id,
      workspaces,
      workspaceSlug: workspaces.some((w) => w.slug === previous) ? previous : workspaces[0]!.slug
    })
    this.restartLive()
    return this.status()
  }

  /**
   * Another account signs in here: the previous one's shares, picks and waiting
   * changes are kept aside under its id, the new one's (if it used this computer
   * before) come back, and everything cached from Teamwork is dropped.
   */
  private switchAccount(from: string, to: string): void {
    type Stash = { shares: SharesByWorkspace; picks: PicksByWorkspace; queue: QueuedAction[] }
    const stash = settingsRepository.getInternal<Record<string, Stash> | null>(ACCOUNT_STASH_KEY, null) ?? {}
    stash[from] = { shares: this.allShares(), picks: this.allPicks(), queue: this.queue() }
    const theirs = stash[to]
    delete stash[to]
    settingsRepository.setInternal(ACCOUNT_STASH_KEY, stash)
    settingsRepository.setInternal(SHARES_KEY, theirs?.shares ?? {})
    settingsRepository.setInternal(PICKS_KEY, theirs?.picks ?? {})
    settingsRepository.setInternal(QUEUE_KEY, theirs?.queue ?? [])
    settingsRepository.setInternal(CACHE_KEY, null)
    settingsRepository.setInternal(ONLINE_UNTIL_KEY, {})
    settingsRepository.setInternal(BUSY_HASH_KEY, {})
    this.cachedAt = null
    this.busyMembers = []
    this.callers = []
    this.interviewsById.clear()
  }

  /** Signs out. Shares are kept, so signing in again resumes them. */
  async signOut(): Promise<CallerStatus> {
    const token = this.token()
    this.stopLive()
    if (token) await this.request('/auth/sign-out', { method: 'POST', body: {}, token }).catch(() => undefined)
    this.saveToken(null)
    this.clearTeamwork()
    return this.status()
  }

  selectWorkspace(slug: string): CallerStatus {
    const c = this.connection()
    if (!c.workspaces.some((w) => w.slug === slug)) throw new CallerError('Choose one of your workspaces')
    const changed = c.workspaceSlug !== slug
    this.saveConnection({ workspaceSlug: slug })
    if (changed) this.restartLive()
    return this.status()
  }

  private requireWorkspace(): string {
    const c = this.connection()
    if (!c.serverUrl || !this.token()) throw new CallerError('Sign in to Teamwork first', 401)
    if (!c.workspaceSlug) throw new CallerError('Choose a workspace first')
    return c.workspaceSlug
  }

  // ---------------------------------------------------------------------------
  // Sharing

  /** Members share only to the profiles they work; owners and the admin to any. */
  private async allowedProfiles(slug: string): Promise<CallerProfile[]> {
    const profiles = await this.request<Array<{ id: string; fullName: string; bidders: Array<{ id: string }> }>>(
      `/workspaces/${slug}/profiles`
    )
    const { workspaces, userId } = this.connection()
    const canShareAny = workspaces.find((w) => w.slug === slug)?.canShareAny ?? false
    return profiles
      .filter((p) => canShareAny || p.bidders.some((b) => b.id === userId))
      .map((p) => ({ id: p.id, fullName: p.fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }

  /** This app's calendars with what each shares in the chosen workspace, the profiles to share to, and the picked events. */
  async listShares(): Promise<CallerShares> {
    const slug = this.requireWorkspace()
    const allowed = await this.allowedProfiles(slug)
    const shares = this.allShares()[slug] ?? {}
    const picks: CallerPick[] = Object.entries(this.allPicks()[slug] ?? {})
      .filter(([, pick]) => pick.eventIds.length > 0)
      .map(([profileId, pick]) => ({
        profileId,
        profileName: pick.profileName,
        lastUploadAt: pick.lastUploadAt,
        lastError: pick.lastError,
        events: pick.eventIds
          .map((id) => {
            const event = eventRepository.get(id)
            return { id, title: event?.title ?? 'Removed from its calendar', startTime: event?.startTime ?? '', missing: !event }
          })
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
      }))
    const teamworkHost = hostOf(this.connection().serverUrl)
    const calendars: CallerShareRow[] = calendarRepository.list().map((c) => ({
      localCalendarId: c.id,
      name: c.name,
      color: c.color,
      source: isTeamworkSource(c.sourceUrl) ? 'Teamwork' : sourceLabel(c),
      // Sharing these would send Teamwork its own interviews again, as duplicates.
      blocked: isTeamworkSource(c.sourceUrl)
        ? 'This is the Teamwork calendar itself.'
        : teamworkHost && hostOf(c.sourceUrl) === teamworkHost
          ? 'This is a Teamwork feed; its interviews are on Teamwork already.'
          : null,
      share: shares[c.id] ?? null
    }))
    return { calendars, profiles: allowed, picks }
  }

  /** Shares a calendar with a profile (or moves it to another one), then syncs it so its events go up right away. */
  async share(localCalendarId: string, profileId: string): Promise<CallerShares> {
    const slug = this.requireWorkspace()
    const calendar = calendarRepository.get(localCalendarId)
    if (!calendar) throw new CallerError('This calendar is gone')
    const teamworkHost = hostOf(this.connection().serverUrl)
    if (isTeamworkSource(calendar.sourceUrl) || (teamworkHost && hostOf(calendar.sourceUrl) === teamworkHost)) {
      throw new CallerError('This calendar comes from Teamwork, so its interviews are there already.')
    }
    const current = this.allShares()[slug]?.[localCalendarId]
    const server = current
      ? await this.request<ServerCalendar>(`/workspaces/${slug}/calendar/connections/${current.connectionId}`, {
          method: 'PATCH',
          body: { profileId }
        })
      : await this.request<ServerCalendar>(`/workspaces/${slug}/calendar/connections/shared`, {
          method: 'POST',
          body: { name: calendar.name.slice(0, 80) || 'Calendar', profileId }
        })
    this.saveShare(slug, localCalendarId, {
      connectionId: server.id,
      profileId,
      profileName: server.profile?.fullName ?? 'Profile',
      lastUploadAt: current?.lastUploadAt ?? null,
      lastError: null,
      eventCount: current?.eventCount ?? null
    })
    // Events of this calendar picked one by one now go with the whole calendar: drop them from the picks.
    for (const [pid, pick] of Object.entries(this.allPicks()[slug] ?? {})) {
      const rest = pick.eventIds.filter((id) => eventRepository.get(id)?.calendarId !== localCalendarId)
      if (rest.length !== pick.eventIds.length) {
        this.savePick(slug, pid, { ...pick, eventIds: rest })
        await this.uploadPick(slug, pid)
      }
    }
    // The upload follows the sync (see the constructor).
    await this.syncLocal([calendar])
    await this.uploads.get(localCalendarId)
    this.scheduleBusy()
    return this.listShares()
  }

  /** Stops sharing: Teamwork removes the upcoming interviews nobody worked on. */
  async unshare(localCalendarId: string): Promise<CallerShares> {
    const slug = this.requireWorkspace()
    const current = this.allShares()[slug]?.[localCalendarId]
    if (current) {
      await this.request(`/workspaces/${slug}/calendar/connections/${current.connectionId}`, { method: 'DELETE' }).catch((err) => {
        // Already removed on the website: nothing left to stop.
        if (!(err instanceof CallerError && err.status === 404)) throw err
      })
      this.saveShare(slug, localCalendarId, null)
    }
    this.scheduleBusy()
    return this.listShares()
  }

  /** Syncs every calendar shared in any workspace; their uploads follow. */
  async syncShared(): Promise<CallerSyncResult[]> {
    const ids = new Set(Object.values(this.allShares()).flatMap((forWorkspace) => Object.keys(forWorkspace)))
    // Calendars of picked events sync too, so the picked copies are current.
    for (const id of this.pickedEventIds()) {
      const calendarId = eventRepository.get(id)?.calendarId
      if (calendarId) ids.add(calendarId)
    }
    const calendars = calendarRepository.list().filter((c) => ids.has(c.id))
    if (calendars.length > 0) await this.syncLocal(calendars)
    await Promise.all(calendars.map((c) => this.uploads.get(c.id)))
    await this.uploadAllPicks()
    this.saveConnection({ lastSyncAt: new Date().toISOString() })
    const slug = this.connection().workspaceSlug
    const shares = (slug && this.allShares()[slug]) || {}
    const calendarResults = calendars
      .filter((c) => shares[c.id])
      .map((c) => {
        const s = shares[c.id]!
        return s.lastError
          ? { name: c.name, ok: false, message: s.lastError }
          : { name: c.name, ok: true, message: `${s.eventCount ?? 0} events sent to ${s.profileName}` }
      })
    const pickResults = Object.values((slug && this.allPicks()[slug]) || {})
      .filter((p) => p.eventIds.length > 0)
      .map((p) =>
        p.lastError
          ? { name: `Picked for ${p.profileName}`, ok: false, message: p.lastError }
          : { name: `Picked for ${p.profileName}`, ok: true, message: `${p.eventIds.length} picked ${p.eventIds.length === 1 ? 'event' : 'events'} sent` }
      )
    return [...calendarResults, ...pickResults]
  }

  // ---------------------------------------------------------------------------
  // Single events

  private pickedEventIds(): string[] {
    return Object.values(this.allPicks()).flatMap((forWorkspace) => Object.values(forWorkspace).flatMap((p) => p.eventIds))
  }

  /** One event's sharing state in the chosen workspace. */
  async eventShare(eventId: string): Promise<CallerEventShare> {
    const c = this.connection()
    const empty: CallerEventShare = {
      signedIn: false,
      workspaceName: null,
      profiles: [],
      profileId: null,
      calendarSharedWith: null,
      fromTeamwork: false,
      teamwork: null,
      error: null
    }
    if (!c.serverUrl || !this.token() || !c.workspaceSlug) return empty
    const slug = c.workspaceSlug
    const event = eventRepository.get(eventId)
    const base = {
      ...empty,
      signedIn: true,
      workspaceName: c.workspaces.find((w) => w.slug === slug)?.name ?? null,
      profileId: Object.entries(this.allPicks()[slug] ?? {}).find(([, p]) => p.eventIds.includes(eventId))?.[0] ?? null,
      calendarSharedWith: event?.calendarId ? (this.allShares()[slug]?.[event.calendarId]?.profileName ?? null) : null,
      fromTeamwork: Boolean(event?.calendarId && isTeamworkSource(calendarRepository.get(event.calendarId)?.sourceUrl ?? '')),
      teamwork: this.teamworkInfo(slug, event)
    }
    if (base.fromTeamwork) return base
    try {
      return { ...base, profiles: await this.allowedProfiles(slug) }
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** The workspace interview behind an event: its own Teamwork event, or the member's event that became one. */
  private teamworkInfo(slug: string, event: CalendarEvent | null): CallerEventShare['teamwork'] {
    if (!event) return null
    const annotated = this.annotations()[event.id]
    if (annotated) {
      const interview = annotated.interviewId ? this.interviewsById.get(annotated.interviewId) : undefined
      return {
        label: annotated.label,
        url: annotated.url,
        interview: interview ? this.interviewOf(interview) : null,
        offlineSince: this.liveUp ? null : this.cachedAt
      }
    }
    const calendar = event.calendarId ? calendarRepository.get(event.calendarId) : null
    // Another member's busy time: nothing on Teamwork to show.
    if (event.externalId?.startsWith('busy:')) return null
    if (calendar && isTeamworkSource(calendar.sourceUrl) && event.externalId) {
      const interview = this.interviewsById.get(event.externalId)
      return {
        label: interview ? this.detailsOf(interview) : event.title,
        url: this.urlOf(slug, event.externalId),
        interview: interview ? this.interviewOf(interview) : null,
        offlineSince: this.liveUp ? null : this.cachedAt
      }
    }
    return null
  }

  /** Shares one event with a profile without sharing its calendar; null stops sharing it. */
  async shareEvent(eventId: string, profileId: string | null): Promise<CallerEventShare> {
    const slug = this.requireWorkspace()
    const event = eventRepository.get(eventId)
    if (!event) throw new CallerError('This event is gone')
    if (event.calendarId && isTeamworkSource(calendarRepository.get(event.calendarId)?.sourceUrl ?? '')) {
      throw new CallerError('This interview comes from Teamwork.')
    }
    if (event.calendarId && this.allShares()[slug]?.[event.calendarId]) {
      throw new CallerError('Its whole calendar is shared already, so this event is on Teamwork.')
    }
    const touched = new Set<string>()
    // An event is picked for one profile at most.
    for (const [pid, pick] of Object.entries(this.allPicks()[slug] ?? {})) {
      if (pick.eventIds.includes(eventId) && pid !== profileId) {
        this.savePick(slug, pid, { ...pick, eventIds: pick.eventIds.filter((id) => id !== eventId) })
        touched.add(pid)
      }
    }
    if (profileId) {
      let pick = this.allPicks()[slug]?.[profileId]
      if (!pick) {
        const name = `${this.connection().userName || 'Member'}'s picked interviews`.slice(0, 80)
        const created = await this.request<ServerCalendar>(`/workspaces/${slug}/calendar/connections/shared`, {
          method: 'POST',
          body: { name, profileId }
        })
        pick = { connectionId: created.id, profileName: created.profile?.fullName ?? 'Profile', eventIds: [], lastUploadAt: null, lastError: null }
      }
      if (!pick.eventIds.includes(eventId)) this.savePick(slug, profileId, { ...pick, eventIds: [...pick.eventIds, eventId] })
      touched.add(profileId)
    }
    await Promise.all([...touched].map((pid) => this.uploadPick(slug, pid)))
    this.scheduleBusy()
    return this.eventShare(eventId)
  }

  /** After a calendar synced: sends again every pick holding one of its events (or an event that left it). */
  private async uploadPicksOf(calendarId: string): Promise<void> {
    for (const [slug, forWorkspace] of Object.entries(this.allPicks())) {
      for (const [profileId, pick] of Object.entries(forWorkspace)) {
        const affected = pick.eventIds.some((id) => {
          const event = eventRepository.get(id)
          return !event || event.calendarId === calendarId
        })
        if (affected) await this.uploadPick(slug, profileId)
      }
    }
  }

  private async uploadAllPicks(): Promise<void> {
    for (const [slug, forWorkspace] of Object.entries(this.allPicks())) {
      for (const profileId of Object.keys(forWorkspace)) await this.uploadPick(slug, profileId)
    }
  }

  /**
   * Sends one profile's picked events as its "picked interviews" calendar.
   * Events no longer in their calendar are dropped from the pick, so Teamwork
   * removes or cancels them like any removed invitation.
   */
  private uploadPick(slug: string, profileId: string): Promise<void> {
    if (!this.token()) return Promise.resolve()
    const key = `pick:${slug}:${profileId}`
    const previous = this.uploads.get(key) ?? Promise.resolve()
    const run = previous.then(async () => {
      const pick = this.allPicks()[slug]?.[profileId]
      if (!pick) return
      const events = pick.eventIds.map((id) => eventRepository.get(id)).filter((e): e is CalendarEvent => Boolean(e))
      const kept = events.map((e) => e.id)
      const ics = buildIcs(events, `Picked for ${pick.profileName}`)
      // The stamp line changes every time; the fingerprint ignores it.
      const hash = fingerprint(ics.replace(/^DTSTAMP:.*$/gm, ''))
      if (pick.lastHash === hash && !pick.lastError && kept.length === pick.eventIds.length) return
      try {
        const result = await this.request<ServerCalendar>(`/workspaces/${slug}/calendar/connections/${pick.connectionId}/ics`, {
          method: 'POST',
          body: { ics, fileName: 'picked-interviews.ics', hash }
        })
        this.savePick(slug, profileId, {
          ...pick,
          eventIds: kept,
          profileName: result.profile?.fullName ?? pick.profileName,
          lastUploadAt: new Date().toISOString(),
          lastError: result.status === 'error' ? (result.lastError ?? 'Teamwork could not read the events') : null,
          lastHash: result.status === 'error' ? null : hash
        })
      } catch (err) {
        if (err instanceof CallerError && err.status === 404) {
          // Removed on the website: the picks are gone there too.
          this.savePick(slug, profileId, null)
          return
        }
        this.savePick(slug, profileId, { ...pick, lastError: err instanceof Error ? err.message : String(err) })
        if (this.liveUp) this.scheduleRecheck(slug)
      }
    })
    const settled = run.catch(() => undefined)
    this.uploads.set(key, settled)
    return settled
  }

  /** Proton calendars are exported first (as their Sync button does); other calendars sync directly. */
  private async syncLocal(calendars: CalendarSource[]): Promise<void> {
    const accounts = [...new Set(calendars.map((c) => c.accountId).filter((id): id is string => Boolean(id)))]
    const others = calendars.filter((c) => !c.accountId)
    await Promise.all([
      ...accounts.map((id) => protonAccountService.sync(id)),
      ...others.map((c) => syncService.syncOne(c.id, { force: true }))
    ])
  }

  /** After a calendar synced: uploads it to every workspace it is shared in. */
  private uploadShared(calendar: CalendarSource, ics: string): Promise<void> {
    const targets = Object.keys(this.allShares()).filter((slug) => this.allShares()[slug]?.[calendar.id])
    if (targets.length === 0 || !this.token()) return Promise.resolve()
    const previous = this.uploads.get(calendar.id) ?? Promise.resolve()
    const run = previous.then(async () => {
      for (const slug of targets) {
        const share = this.allShares()[slug]?.[calendar.id]
        if (!share) continue
        const hash = fingerprint(ics)
        // Nothing changed since the last successful send: no request at all.
        if (share.lastHash === hash && !share.lastError) continue
        try {
          if (Buffer.byteLength(ics, 'utf8') > MAX_UPLOAD_BYTES) throw new CallerError('This calendar is too large to share (8 MB at most)')
          const result = await this.request<ServerCalendar>(`/workspaces/${slug}/calendar/connections/${share.connectionId}/ics`, {
            method: 'POST',
            body: { ics, fileName: calendar.name, hash }
          })
          this.saveShare(slug, calendar.id, {
            ...share,
            profileName: result.profile?.fullName ?? share.profileName,
            lastUploadAt: new Date().toISOString(),
            lastError: result.status === 'error' ? (result.lastError ?? 'Teamwork could not read the calendar') : null,
            eventCount: result.eventCount,
            lastHash: result.status === 'error' ? null : hash
          })
        } catch (err) {
          if (err instanceof CallerError && err.status === 404) {
            // Removed on the website: stop sharing here too.
            this.saveShare(slug, calendar.id, null)
            continue
          }
          this.saveShare(slug, calendar.id, { ...share, lastError: err instanceof Error ? err.message : String(err) })
          if (this.liveUp) this.scheduleRecheck(slug)
        }
      }
    })
    const settled = run.catch(() => undefined)
    this.uploads.set(calendar.id, settled)
    return settled
  }

  // ---------------------------------------------------------------------------
  // Interviews

}

export const callerService = new CallerService()

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Short fingerprint of a file's text, to skip sending an unchanged calendar. */
function fingerprint(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}
