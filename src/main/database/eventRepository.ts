import type { CalendarEvent, EventAttendee, EventSearchResult, RecurrenceRule, SearchMatchField } from '@shared/types'
import { eventSearchText, findMatches, foldText, guestsText, searchTerms, snippetAround } from '@shared/search'
import { htmlToPlainText } from '@shared/htmlText'
import { getDb } from './connection'

interface EventRow {
  id: string
  calendar_id: string | null
  external_id: string | null
  title: string
  description: string
  start_time: string
  end_time: string
  all_day: number
  location: string
  is_local_event: number
  color: string | null
  reminder_minutes: number | null
  attendees: string
  created_at: string
  series_id?: string | null
  /** From event_statuses, when the query joins it */
  status?: string | null
  /** From local_series, when the query joins it */
  series_rule?: string | null
}

/** Events plus the status the user picked (if any) and the repeat rule of local series. */
const SELECT_EVENTS = `SELECT e.*, s.status, ls.rule AS series_rule FROM events e
  LEFT JOIN event_statuses s ON s.event_id = e.id
  LEFT JOIN local_series ls ON ls.id = e.series_id`

/** Event shape produced by the ICS parser, before it is stored. */
export interface SyncedEventData {
  id: string
  externalId: string
  title: string
  description: string
  startTime: string
  endTime: string
  allDay: boolean
  location: string
  attendees: EventAttendee[]
}

function parseAttendees(json: string): EventAttendee[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? (value as EventAttendee[]) : []
  } catch {
    return []
  }
}

function parseRule(json: string | null | undefined): RecurrenceRule | null {
  if (!json) return null
  try {
    return JSON.parse(json) as RecurrenceRule
  } catch {
    return null
  }
}

function toEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    externalId: row.external_id,
    title: row.title,
    description: row.description,
    startTime: row.start_time,
    endTime: row.end_time,
    allDay: row.all_day === 1,
    location: row.location,
    isLocalEvent: row.is_local_event === 1,
    color: row.color,
    reminderMinutes: row.reminder_minutes,
    attendees: parseAttendees(row.attendees),
    status: row.status ?? null,
    seriesId: row.series_id ?? null,
    recurrence: parseRule(row.series_rule),
    createdAt: row.created_at
  }
}

/** Results shown at most (after merging recurring events). */
const MAX_SEARCH_RESULTS = 50
/** Rows read before merging; plenty for 50 results even with long recurring series. */
const MAX_SEARCH_ROWS = 5000

type SearchRow = EventRow & { note: string | null; calendar_name: string | null }

/** LIKE pattern for a term, with LIKE's wildcards escaped. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** First field that contains a search word, with the text to show around it. */
function describeMatch(row: SearchRow, terms: string[]): { matchedIn: SearchMatchField; snippet: string } {
  const fields: [SearchMatchField, string | null][] = [
    ['title', row.title],
    ['location', row.location],
    ['guests', guestsText(parseAttendees(row.attendees))],
    ['description', htmlToPlainText(row.description)],
    ['notes', row.note],
    ['calendar', row.calendar_name]
  ]
  for (const [field, text] of fields) {
    if (text && findMatches(text, terms).length) {
      return { matchedIn: field, snippet: field === 'title' ? '' : snippetAround(text, terms) }
    }
  }
  return { matchedIn: 'title', snippet: '' } // unreachable: SQL only returns rows where a field matched
}

export const eventRepository = {
  /**
   * One search box for everything: title, description, location, guests, notes and
   * calendar name. Every word must appear somewhere (in any field), ignoring case
   * and accents. Disabled calendars are left out.
   *
   * Recurring events are stored per date, so their dates are merged into one result
   * (the next matching date, or the latest past one). Upcoming results come first,
   * soonest first, then past ones, most recent first.
   */
  search(query: string): EventSearchResult[] {
    const terms = searchTerms(query)
    if (terms.length === 0) return []

    const db = getDb()
    // Few calendars: match their names here rather than per event in SQL.
    const calendars = db.prepare('SELECT id, name FROM calendars WHERE enabled = 1').all() as { id: string; name: string }[]

    // Every word must match somewhere: in the event's own fields (pre-folded
    // search_text), its note, or its calendar's name.
    const clauses: string[] = []
    const params: string[] = []
    for (const term of terms) {
      const pattern = likePattern(term)
      const parts = [`e.search_text LIKE ? ESCAPE '\\'`, `(n.content IS NOT NULL AND casefold(n.content) LIKE ? ESCAPE '\\')`]
      params.push(pattern, pattern)
      const calendarIds = calendars.filter((c) => foldText(c.name).includes(term)).map((c) => c.id)
      if (calendarIds.length) {
        parts.push(`e.calendar_id IN (${calendarIds.map(() => '?').join(', ')})`)
        params.push(...calendarIds)
      }
      clauses.push(`(${parts.join(' OR ')})`)
    }

    const rows = db
      .prepare(
        `SELECT e.*, n.content AS note, c.name AS calendar_name, s.status, ls.rule AS series_rule
         FROM events e
         LEFT JOIN notes n ON n.event_id = e.id
         LEFT JOIN event_statuses s ON s.event_id = e.id
         LEFT JOIN local_series ls ON ls.id = e.series_id
         LEFT JOIN calendars c ON c.id = e.calendar_id
         WHERE (e.is_local_event = 1 OR c.enabled = 1) AND ${clauses.join(' AND ')}
         ORDER BY e.start_time
         LIMIT ${MAX_SEARCH_ROWS}`
      )
      .all(...params) as SearchRow[]

    const nowIso = new Date().toISOString()
    const today = nowIso.slice(0, 10)
    // Timed events store ISO UTC, all-day events YYYY-MM-DD (end exclusive).
    const isUpcoming = (row: SearchRow): boolean => (row.all_day ? row.end_time > today : row.end_time > nowIso)

    // Merge the dates of a recurring event ("uid::recurrence-id" external IDs).
    const groups = new Map<string, { row: SearchRow; count: number }>()
    for (const row of rows) {
      const series = row.external_id?.includes('::') ? row.external_id.split('::')[0] : null
      const key = series ? `${row.calendar_id}|${series}` : row.id
      const group = groups.get(key)
      if (!group) {
        groups.set(key, { row, count: 1 })
        continue
      }
      group.count++
      // Rows come sorted by start: keep the first upcoming date, else the latest past one.
      if (!isUpcoming(group.row)) group.row = row
    }

    const results = [...groups.values()].map(({ row, count }) => ({
      upcoming: isUpcoming(row),
      result: {
        event: toEvent(row),
        calendarName: row.calendar_name,
        ...describeMatch(row, terms),
        occurrences: count
      } satisfies EventSearchResult
    }))
    // Sorted by the date each result shows (a series' chosen date, not its first one).
    const byStart = (a: EventSearchResult, b: EventSearchResult): number => a.event.startTime.localeCompare(b.event.startTime)
    const upcoming = results.filter((r) => r.upcoming).map((r) => r.result).sort(byStart)
    const past = results.filter((r) => !r.upcoming).map((r) => r.result).sort((a, b) => byStart(b, a))
    return [...upcoming, ...past].slice(0, MAX_SEARCH_RESULTS)
  },

  /**
   * Returns events overlapping [start, end). Timed events are stored as ISO UTC
   * strings and all-day events as YYYY-MM-DD, both of which sort correctly as
   * text; the renderer always requests a padded range so the ≤1 day imprecision
   * at the boundaries for all-day events doesn't matter.
   */
  listInRange(start: string, end: string): CalendarEvent[] {
    const rows = getDb()
      .prepare(`${SELECT_EVENTS} WHERE e.start_time < ? AND e.end_time > ? ORDER BY e.start_time`)
      .all(end, start) as EventRow[]
    return rows.map(toEvent)
  },

  get(id: string): CalendarEvent | null {
    const row = getDb().prepare(`${SELECT_EVENTS} WHERE e.id = ?`).get(id) as EventRow | undefined
    return row ? toEvent(row) : null
  },

  /**
   * Local events with a reminder starting in [from, to). Bounded, because repeating
   * events store a row per date. Bounds are ISO strings; all-day starts
   * (YYYY-MM-DD) compare correctly against them as text.
   */
  listLocalWithReminders(from: string, to: string): CalendarEvent[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM events
         WHERE is_local_event = 1 AND reminder_minutes IS NOT NULL AND start_time >= ? AND start_time < ?`
      )
      .all(from, to) as EventRow[]
    return rows.map(toEvent)
  },

  /** Works for synced (read-only) events too: the status is the app's own data. */
  setStatus(id: string, status: string | null): void {
    const db = getDb()
    if (status === null) {
      db.prepare('DELETE FROM event_statuses WHERE event_id = ?').run(id)
      return
    }
    db.prepare(
      `INSERT INTO event_statuses (event_id, status, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (event_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
    ).run(id, status, new Date().toISOString())
  },

  /** Drops statuses that were deleted in Settings, so those events go back to automatic. */
  pruneStatuses(validIds: string[]): void {
    getDb()
      .prepare(`DELETE FROM event_statuses WHERE status NOT IN (SELECT value FROM json_each(?))`)
      .run(JSON.stringify(validIds))
  },

  /**
   * Replaces the cached contents of one calendar with a fresh feed snapshot in a
   * single transaction: upsert everything we received, then delete what's gone.
   * Upserting (instead of delete-all + insert) keeps created_at stable.
   */
  replaceCalendarEvents(calendarId: string, events: SyncedEventData[]): void {
    const db = getDb()
    const upsert = db.prepare(
      `INSERT INTO events (id, calendar_id, external_id, title, description, start_time, end_time,
                           all_day, location, attendees, search_text, is_local_event, created_at)
       VALUES (@id, @calendarId, @externalId, @title, @description, @startTime, @endTime,
               @allDay, @location, @attendees, @searchText, 0, @createdAt)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title, description = excluded.description,
         start_time = excluded.start_time, end_time = excluded.end_time,
         all_day = excluded.all_day, location = excluded.location, attendees = excluded.attendees,
         search_text = excluded.search_text`
    )
    const now = new Date().toISOString()

    db.transaction(() => {
      db.exec('CREATE TEMP TABLE IF NOT EXISTS sync_keep (id TEXT PRIMARY KEY)')
      db.exec('DELETE FROM sync_keep')
      const keep = db.prepare('INSERT OR IGNORE INTO sync_keep (id) VALUES (?)')

      for (const e of events) {
        upsert.run({ ...e, calendarId, allDay: e.allDay ? 1 : 0, attendees: JSON.stringify(e.attendees), searchText: eventSearchText(e), createdAt: now })
        keep.run(e.id)
      }
      db.prepare('DELETE FROM events WHERE calendar_id = ? AND id NOT IN (SELECT id FROM sync_keep)').run(
        calendarId
      )
      db.exec('DELETE FROM sync_keep')
    })()
  }
}
