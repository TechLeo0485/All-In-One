import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CalendarEvent, LocalEventInput, RecurrenceRule, RecurrenceScope } from '@shared/types'
import { daysBetween, occurrenceDates, shiftDate } from '@shared/recurrence'
import { eventSearchText } from '@shared/search'
import { getDb } from './connection'
import { eventRepository } from './eventRepository'

/**
 * Local events, including repeating ones.
 *
 * A repeating event is a row in `local_series` (rule + details) plus one ordinary
 * `events` row per date, generated ahead up to a horizon and extended as the user
 * browses further. Date rows have the ID "<series>_<original date>" and the
 * external ID "<series>::<original date>", so:
 *  - regenerating a series reproduces the same IDs (notes and statuses stay put),
 *  - search merges the dates into one result, like synced recurring events.
 *
 * Dates are computed in the main process' local time zone (the user's), so a
 * 09:00 meeting stays at 09:00 across DST changes.
 */

interface SeriesRow {
  id: string
  title: string
  description: string
  location: string
  color: string | null
  reminder_minutes: number | null
  all_day: number
  start_time: string
  end_time: string
  rule: string
  exdates: string
  generated_until: string
  created_at: string
}

interface LocalRow {
  id: string
  external_id: string | null
  series_id: string | null
  start_time: string
  all_day: number
}

/** Dates are generated this far ahead of today (like synced feeds: ~18 months). */
const HORIZON_DAYS = 548
/** Browsing further ahead extends series up to this limit. */
const MAX_AHEAD_DAYS = 3660
/** generated_until value for series whose rule has no more dates. */
const COMPLETE = '9999-12-31'

const pad = (n: number): string => String(n).padStart(2, '0')

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const today = (): string => localDate(new Date())

/** Local calendar date an event starts on. */
function startDateOf(startTime: string, allDay: boolean): string {
  return allDay ? startTime : localDate(new Date(startTime))
}

/** The date a series row was generated for (before any "This event" move). */
function originalDate(row: LocalRow): string {
  const marker = row.external_id?.lastIndexOf('::') ?? -1
  return marker >= 0 ? row.external_id!.slice(marker + 2) : startDateOf(row.start_time, row.all_day === 1)
}

const rowId = (seriesId: string, date: string): string => `${seriesId}_${date}`
const externalId = (seriesId: string, date: string): string => `${seriesId}::${date}`

function parseRule(json: string | null | undefined): RecurrenceRule | null {
  if (!json) return null
  try {
    return JSON.parse(json) as RecurrenceRule
  } catch {
    return null
  }
}

function parseDates(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Start/end of a series' date `date`, keeping the first date's time of day and duration. */
function timesOn(
  base: { start_time: string; end_time: string; all_day: number },
  date: string
): { start: string; end: string } {
  if (base.all_day) return { start: date, end: shiftDate(date, daysBetween(base.start_time, base.end_time)) }
  const s = new Date(base.start_time)
  const duration = new Date(base.end_time).getTime() - s.getTime()
  const [y, m, d] = date.split('-').map(Number)
  const start = new Date(y, m - 1, d, s.getHours(), s.getMinutes(), s.getSeconds())
  return { start: start.toISOString(), end: new Date(start.getTime() + duration).toISOString() }
}

/** Keeps weekly days in step when a whole series moves by `delta` days (Tue → Wed). */
function shiftWeekdays(rule: RecurrenceRule, previous: RecurrenceRule | null, delta: number): RecurrenceRule {
  if (rule.freq !== 'weekly' || previous?.freq !== 'weekly' || delta % 7 === 0) return rule
  const same = [...rule.weekdays].sort().join() === [...previous.weekdays].sort().join()
  if (!same) return rule // the user picked new days themselves
  return { ...rule, weekdays: rule.weekdays.map((wd) => (((wd + delta) % 7) + 7) % 7) }
}

function getSeries(db: Database.Database, id: string): SeriesRow | null {
  return (db.prepare('SELECT * FROM local_series WHERE id = ?').get(id) as SeriesRow | undefined) ?? null
}

function getLocalRow(db: Database.Database, id: string): LocalRow {
  const row = db
    .prepare('SELECT id, external_id, series_id, start_time, all_day FROM events WHERE id = ? AND is_local_event = 1')
    .get(id) as LocalRow | undefined
  if (!row) throw new Error('Local event not found')
  return row
}

/** Inserts the series' missing dates up to `through` (existing rows, incl. edited ones, are kept). */
function generate(db: Database.Database, series: SeriesRow, through: string): void {
  const rule = parseRule(series.rule)
  if (!rule) return
  const skip = new Set(parseDates(series.exdates))
  const { dates, complete } = occurrenceDates(rule, startDateOf(series.start_time, series.all_day === 1), through)
  const insert = db.prepare(
    `INSERT OR IGNORE INTO events (id, calendar_id, external_id, series_id, title, description, start_time, end_time,
                                   all_day, location, is_local_event, color, reminder_minutes, search_text, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  )
  const searchText = eventSearchText({ ...series, attendees: [] })
  const now = new Date().toISOString()
  for (const date of dates) {
    if (skip.has(date)) continue
    const { start, end } = timesOn(series, date)
    insert.run(
      rowId(series.id, date),
      externalId(series.id, date),
      series.id,
      series.title,
      series.description,
      start,
      end,
      series.all_day,
      series.location,
      series.color,
      series.reminder_minutes,
      searchText,
      now
    )
  }
  db.prepare('UPDATE local_series SET generated_until = ? WHERE id = ?').run(complete ? COMPLETE : through, series.id)
}

function insertSeries(db: Database.Database, input: LocalEventInput, rule: RecurrenceRule, exdates: string[] = []): SeriesRow {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO local_series (id, title, description, location, color, reminder_minutes, all_day,
                               start_time, end_time, rule, exdates, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.description,
    input.location,
    input.color,
    input.reminderMinutes,
    input.allDay ? 1 : 0,
    input.startTime,
    input.endTime,
    JSON.stringify(rule),
    JSON.stringify(exdates),
    new Date().toISOString()
  )
  const series = getSeries(db, id)!
  generate(db, series, shiftDate(today(), HORIZON_DAYS))
  return series
}

function insertSingle(db: Database.Database, input: LocalEventInput, id = randomUUID()): string {
  db.prepare(
    `INSERT INTO events (id, calendar_id, external_id, title, description, start_time, end_time,
                         all_day, location, is_local_event, color, reminder_minutes, search_text, created_at)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.description,
    input.startTime,
    input.endTime,
    input.allDay ? 1 : 0,
    input.location,
    input.color,
    input.reminderMinutes,
    eventSearchText({ ...input, attendees: [] }),
    new Date().toISOString()
  )
  return id
}

/** Overwrites one event row with `input` (series fields are left to the caller). */
function writeRow(db: Database.Database, id: string, input: LocalEventInput, extraSql = ''): void {
  db.prepare(
    `UPDATE events SET title = ?, description = ?, start_time = ?, end_time = ?, all_day = ?,
                       location = ?, color = ?, reminder_minutes = ?, search_text = ?${extraSql}
     WHERE id = ? AND is_local_event = 1`
  ).run(
    input.title,
    input.description,
    input.startTime,
    input.endTime,
    input.allDay ? 1 : 0,
    input.location,
    input.color,
    input.reminderMinutes,
    eventSearchText({ ...input, attendees: [] }),
    id
  )
}

/** Moves notes and statuses to new event IDs (two passes, so swapped IDs don't collide). */
function moveEventData(db: Database.Database, moves: [from: string, to: string][]): void {
  const pairs = moves.filter(([from, to]) => from !== to)
  if (!pairs.length) return
  for (const table of ['notes', 'event_statuses']) {
    const update = db.prepare(`UPDATE OR REPLACE ${table} SET event_id = ? WHERE event_id = ?`)
    for (const [from, to] of pairs) update.run(`~moving~${to}`, from)
    for (const [, to] of pairs) update.run(to, `~moving~${to}`)
  }
}

function deleteRows(db: Database.Database, ids: string[]): void {
  const statements = ['DELETE FROM events WHERE id = ?', 'DELETE FROM notes WHERE event_id = ?', 'DELETE FROM event_statuses WHERE event_id = ?'].map(
    (sql) => db.prepare(sql)
  )
  for (const id of ids) for (const s of statements) s.run(id)
}

function seriesRows(db: Database.Database, seriesId: string, fromDate?: string): LocalRow[] {
  const sql = 'SELECT id, external_id, series_id, start_time, all_day FROM events WHERE series_id = ?'
  return (
    fromDate === undefined
      ? db.prepare(sql).all(seriesId)
      : db.prepare(`${sql} AND external_id >= ?`).all(seriesId, externalId(seriesId, fromDate))
  ) as LocalRow[]
}

/** The row to show after saving: the given date if it exists, else the next/first date. */
function pickResult(db: Database.Database, seriesId: string, preferredId: string): CalendarEvent {
  const exact = eventRepository.get(preferredId)
  if (exact) return exact
  const next = db
    .prepare('SELECT id FROM events WHERE series_id = ? ORDER BY start_time >= ? DESC, start_time LIMIT 1')
    .pluck()
    .get(seriesId, today()) as string | undefined
  if (!next) throw new Error('The repeat settings produce no dates')
  return eventRepository.get(next)!
}

/** Ends a series the day before `date`. */
function endSeriesBefore(db: Database.Database, series: SeriesRow, date: string): void {
  const rule = parseRule(series.rule)!
  rule.end = { type: 'until', date: shiftDate(date, -1) }
  db.prepare('UPDATE local_series SET rule = ?, generated_until = ? WHERE id = ?').run(JSON.stringify(rule), COMPLETE, series.id)
}

function deleteSeries(db: Database.Database, seriesId: string): void {
  deleteRows(db, seriesRows(db, seriesId).map((r) => r.id))
  db.prepare('DELETE FROM local_series WHERE id = ?').run(seriesId)
}

/* ---------- edits of a repeating event ---------- */

/** "All events": rewrites the series; a moved date moves every date by the same days. */
function updateAll(db: Database.Database, row: LocalRow, series: SeriesRow, input: LocalEventInput): CalendarEvent {
  const occurrence = originalDate(row)

  if (!input.recurrence) {
    // "Does not repeat": keep only this date, as a single event (its notes stay).
    deleteRows(db, seriesRows(db, series.id).filter((r) => r.id !== row.id).map((r) => r.id))
    writeRow(db, row.id, input, ', series_id = NULL, external_id = NULL, is_exception = 0')
    db.prepare('DELETE FROM local_series WHERE id = ?').run(series.id)
    return eventRepository.get(row.id)!
  }

  const delta = daysBetween(occurrence, startDateOf(input.startTime, input.allDay))
  const firstDate = shiftDate(startDateOf(series.start_time, series.all_day === 1), delta)
  const { start, end } = timesOn({ start_time: input.startTime, end_time: input.endTime, all_day: input.allDay ? 1 : 0 }, firstDate)
  const rule = shiftWeekdays(input.recurrence, parseRule(series.rule), delta)

  const oldRows = seriesRows(db, series.id)
  moveEventData(db, oldRows.map((r) => [r.id, rowId(series.id, shiftDate(originalDate(r), delta))]))
  db.prepare('DELETE FROM events WHERE series_id = ?').run(series.id)
  db.prepare(
    `UPDATE local_series SET title = ?, description = ?, location = ?, color = ?, reminder_minutes = ?, all_day = ?,
                             start_time = ?, end_time = ?, rule = ?, exdates = ?, generated_until = ''
     WHERE id = ?`
  ).run(
    input.title,
    input.description,
    input.location,
    input.color,
    input.reminderMinutes,
    input.allDay ? 1 : 0,
    start,
    end,
    JSON.stringify(rule),
    JSON.stringify(parseDates(series.exdates).map((d) => shiftDate(d, delta))),
    series.id
  )
  const through = series.generated_until === COMPLETE || series.generated_until === '' ? today() : series.generated_until
  generate(db, getSeries(db, series.id)!, maxDate(shiftDate(through, delta), shiftDate(today(), HORIZON_DAYS)))
  return pickResult(db, series.id, rowId(series.id, shiftDate(occurrence, delta)))
}

/** "This and following events": ends the series before this date and starts a new one from it. */
function updateFollowing(db: Database.Database, row: LocalRow, series: SeriesRow, input: LocalEventInput): CalendarEvent {
  const occurrence = originalDate(row)
  const seriesStart = startDateOf(series.start_time, series.all_day === 1)
  if (occurrence <= seriesStart) return updateAll(db, row, series, input)

  const oldRule = parseRule(series.rule)
  const later = seriesRows(db, series.id, occurrence)
  endSeriesBefore(db, series, occurrence)
  const delta = daysBetween(occurrence, startDateOf(input.startTime, input.allDay))

  if (!input.recurrence) {
    // The following dates are replaced by this one date.
    db.prepare('DELETE FROM events WHERE id = ?').run(row.id)
    const id = insertSingle(db, input)
    moveEventData(db, [[row.id, id]])
    deleteRows(db, later.filter((r) => r.id !== row.id).map((r) => r.id))
    return eventRepository.get(id)!
  }

  let rule = shiftWeekdays(input.recurrence, oldRule, delta)
  if (rule.end.type === 'count' && oldRule?.end.type === 'count' && rule.end.count === oldRule.end.count) {
    // Unchanged "N times": the new series only gets the remaining dates.
    const before = occurrenceDates(oldRule, seriesStart, shiftDate(occurrence, -1)).dates.length
    rule = { ...rule, end: { type: 'count', count: Math.max(1, oldRule.end.count - before) } }
  }
  const exdates = parseDates(series.exdates)
    .filter((d) => d >= occurrence)
    .map((d) => shiftDate(d, delta))
  db.prepare(`DELETE FROM events WHERE series_id = ? AND external_id >= ?`).run(series.id, externalId(series.id, occurrence))
  const next = insertSeries(db, input, rule, exdates)
  moveEventData(db, later.map((r) => [r.id, rowId(next.id, shiftDate(originalDate(r), delta))]))
  return pickResult(db, next.id, rowId(next.id, startDateOf(input.startTime, input.allDay)))
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b
}

/* ---------- public API ---------- */

export const localEventRepository = {
  create(input: LocalEventInput): CalendarEvent {
    const db = getDb()
    return db.transaction(() => {
      if (!input.recurrence) return eventRepository.get(insertSingle(db, input))!
      const series = insertSeries(db, input, input.recurrence)
      return pickResult(db, series.id, rowId(series.id, startDateOf(input.startTime, input.allDay)))
    })()
  },

  update(id: string, input: LocalEventInput, scope: RecurrenceScope = 'this'): CalendarEvent {
    const db = getDb()
    return db.transaction(() => {
      const row = getLocalRow(db, id)
      const series = row.series_id ? getSeries(db, row.series_id) : null

      if (!series) {
        if (!input.recurrence) {
          writeRow(db, id, input)
          return eventRepository.get(id)!
        }
        // A single event starts repeating: it becomes the series' first date.
        db.prepare('DELETE FROM events WHERE id = ?').run(id)
        const created = insertSeries(db, input, input.recurrence)
        const result = pickResult(db, created.id, rowId(created.id, startDateOf(input.startTime, input.allDay)))
        moveEventData(db, [[id, result.id]])
        return result
      }

      if (scope === 'all') return updateAll(db, row, series, input)
      if (scope === 'following') return updateFollowing(db, row, series, input)
      // "This event": detach the date from later series edits' regeneration.
      writeRow(db, id, input, ', is_exception = 1')
      return eventRepository.get(id)!
    })()
  },

  remove(id: string, scope: RecurrenceScope = 'this'): void {
    const db = getDb()
    db.transaction(() => {
      const row = getLocalRow(db, id)
      const series = row.series_id ? getSeries(db, row.series_id) : null
      if (!series) return deleteRows(db, [id])

      const occurrence = originalDate(row)
      const isFirst = occurrence <= startDateOf(series.start_time, series.all_day === 1)
      if (scope === 'all' || (scope === 'following' && isFirst)) return deleteSeries(db, series.id)

      if (scope === 'following') {
        endSeriesBefore(db, series, occurrence)
        deleteRows(db, seriesRows(db, series.id, occurrence).map((r) => r.id))
        return
      }
      // "This event": remember the date so regeneration doesn't bring it back.
      const exdates = [...new Set([...parseDates(series.exdates), occurrence])]
      db.prepare('UPDATE local_series SET exdates = ? WHERE id = ?').run(JSON.stringify(exdates), series.id)
      deleteRows(db, [id])
      const left = db.prepare('SELECT 1 FROM events WHERE series_id = ? LIMIT 1').get(series.id)
      if (!left && series.generated_until === COMPLETE) db.prepare('DELETE FROM local_series WHERE id = ?').run(series.id)
    })()
  },

  /**
   * Generates series dates up to `throughDate` (YYYY-MM-DD), at least the standard
   * horizon. Called before range queries, so browsing ahead always shows them.
   */
  ensureGeneratedThrough(throughDate: string): void {
    const db = getDb()
    const limit = shiftDate(today(), MAX_AHEAD_DAYS)
    const target = maxDate(throughDate > limit ? limit : throughDate, shiftDate(today(), HORIZON_DAYS))
    const pending = db.prepare('SELECT * FROM local_series WHERE generated_until < ?').all(target) as SeriesRow[]
    if (!pending.length) return
    db.transaction(() => {
      for (const series of pending) generate(db, series, target)
    })()
  }
}
