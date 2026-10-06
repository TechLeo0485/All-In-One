import type { RecurrenceRule } from './types'

/**
 * Date math for repeating local events. Works on plain calendar dates
 * ("YYYY-MM-DD") so it is independent of time zones and DST; the caller applies
 * the time of day. Used by the main process (generating dates) and the renderer
 * (presets and descriptions).
 */

/** Safety caps so a rule can never produce an unbounded amount of work. */
export const MAX_OCCURRENCES = 5000
const MAX_ITERATIONS = 100_000

const DAY_MS = 86_400_000
const pad = (n: number): string => String(n).padStart(2, '0')

/** "YYYY-MM-DD" -> UTC midnight timestamp (pure date arithmetic, no DST). */
function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function ymd(y: number, m: number, d: number): string {
  return fromUtc(Date.UTC(y, m, d))
}

export function shiftDate(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: string): number {
  return new Date(toUtc(date)).getUTCDay()
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

/** Which occurrence of its weekday a date is in its month (1–5). */
export function weekOfMonth(date: string): number {
  return Math.ceil(Number(date.slice(8, 10)) / 7)
}

/** True when no later date in the month has the same weekday. */
export function isLastWeekdayOfMonth(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  return d + 7 > daysInMonth(y, m - 1)
}

/** The nth (1–5) or last (-1) `weekday` of a month; null if it doesn't exist. */
function nthWeekday(y: number, m: number, weekday: number, nth: number): string | null {
  const total = daysInMonth(y, m)
  if (nth === -1) {
    const lastWd = new Date(Date.UTC(y, m, total)).getUTCDay()
    return ymd(y, m, total - ((lastWd - weekday + 7) % 7))
  }
  const firstWd = new Date(Date.UTC(y, m, 1)).getUTCDay()
  const day = 1 + ((weekday - firstWd + 7) % 7) + (nth - 1) * 7
  return day <= total ? ymd(y, m, day) : null
}

/** Weekdays in week order starting Monday (RFC 5545's default week start). */
const mondayFirst = (wd: number): number => (wd + 6) % 7

/**
 * Candidate dates of a rule, in order, before applying the end condition.
 * Candidates before `start` (e.g. earlier weekdays of the first week) are skipped.
 */
function* candidates(rule: RecurrenceRule, start: string): Generator<string> {
  const interval = Math.max(1, Math.floor(rule.interval))
  const [sy, sm, sd] = start.split('-').map(Number)
  const startWd = weekdayOf(start)

  switch (rule.freq) {
    case 'daily':
      for (let i = 0; ; i++) yield shiftDate(start, i * interval)
    case 'weekly': {
      const days = (rule.weekdays.length ? [...new Set(rule.weekdays)] : [startWd]).sort((a, b) => mondayFirst(a) - mondayFirst(b))
      const weekStart = shiftDate(start, -mondayFirst(startWd))
      for (let w = 0; ; w++) {
        const base = shiftDate(weekStart, w * 7 * interval)
        for (const wd of days) {
          const date = shiftDate(base, mondayFirst(wd))
          if (date >= start) yield date
        }
      }
    }
    case 'monthly': {
      const nth = rule.monthlyBy === 'lastWeekday' ? -1 : weekOfMonth(start)
      for (let i = 0; ; i++) {
        const total = sm - 1 + i * interval
        const y = sy + Math.floor(total / 12)
        const m = total % 12
        if (rule.monthlyBy === 'day') {
          if (sd <= daysInMonth(y, m)) yield ymd(y, m, sd) // months without that day are skipped
        } else {
          const date = nthWeekday(y, m, startWd, nth)
          if (date && date >= start) yield date
        }
      }
    }
    case 'yearly':
      for (let i = 0; ; i++) {
        const y = sy + i * interval
        if (sd <= daysInMonth(y, sm - 1)) yield ymd(y, sm - 1, sd) // Feb 29 only in leap years
      }
  }
}

export interface OccurrenceResult {
  dates: string[]
  /** True when the rule has no dates after `through` (it ended, or hit the cap). */
  complete: boolean
}

/** All dates of the rule from `start` up to and including `through`. */
export function occurrenceDates(rule: RecurrenceRule, start: string, through: string): OccurrenceResult {
  const until = rule.end.type === 'until' ? rule.end.date : null
  const count = rule.end.type === 'count' ? Math.max(1, Math.floor(rule.end.count)) : Infinity
  const dates: string[] = []
  let iterations = 0
  for (const date of candidates(rule, start)) {
    if (++iterations > MAX_ITERATIONS) return { dates, complete: true }
    if (until !== null && date > until) return { dates, complete: true }
    if (date > through) return { dates, complete: false }
    dates.push(date)
    if (dates.length >= count || dates.length >= MAX_OCCURRENCES) return { dates, complete: true }
  }
  return { dates, complete: true } // unreachable: candidates() is infinite
}

/* ---------- presets and descriptions (renderer) ---------- */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth']
const WORKWEEK = [1, 2, 3, 4, 5]

export function weekdayName(wd: number, short = false): string {
  return short ? WEEKDAY_NAMES[wd].slice(0, 3) : WEEKDAY_NAMES[wd]
}

export type RecurrencePreset = 'daily' | 'weekly' | 'weekdays' | 'monthlyDay' | 'monthlyWeekday' | 'monthlyLast' | 'yearly'

const baseRule = (freq: RecurrenceRule['freq']): RecurrenceRule => ({
  freq,
  interval: 1,
  weekdays: [],
  monthlyBy: 'day',
  end: { type: 'never' }
})

/** The rule behind a preset, for an event starting on `start`. */
export function presetRule(preset: RecurrencePreset, start: string): RecurrenceRule {
  switch (preset) {
    case 'daily':
      return baseRule('daily')
    case 'weekly':
      return { ...baseRule('weekly'), weekdays: [weekdayOf(start)] }
    case 'weekdays':
      return { ...baseRule('weekly'), weekdays: [...WORKWEEK] }
    case 'monthlyDay':
      return baseRule('monthly')
    case 'monthlyWeekday':
      return { ...baseRule('monthly'), monthlyBy: 'weekday' }
    case 'monthlyLast':
      return { ...baseRule('monthly'), monthlyBy: 'lastWeekday' }
    case 'yearly':
      return baseRule('yearly')
  }
}

/** Presets offered for a start date (like Google's repeat menu). */
export function presetsFor(start: string): RecurrencePreset[] {
  const out: RecurrencePreset[] = ['daily', 'weekly', 'weekdays', 'monthlyDay']
  if (weekOfMonth(start) <= 4) out.push('monthlyWeekday')
  if (isLastWeekdayOfMonth(start)) out.push('monthlyLast')
  out.push('yearly')
  return out
}

/** Which preset a rule is (ignoring its end), or null for a custom rule. */
export function matchPreset(rule: RecurrenceRule, start: string): RecurrencePreset | null {
  const sameDays = (a: number[], b: number[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join()
  for (const preset of presetsFor(start)) {
    const p = presetRule(preset, start)
    if (p.freq !== rule.freq || p.interval !== rule.interval) continue
    if (p.freq === 'weekly' && !sameDays(p.weekdays, rule.weekdays.length ? rule.weekdays : [weekdayOf(start)])) continue
    if (p.freq === 'monthly' && p.monthlyBy !== rule.monthlyBy) continue
    return preset
  }
  return null
}

const monthDayFmt = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' })
const fullDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** "Every 2 weeks on Monday, Wednesday · until Dec 31, 2026" */
export function describeRecurrence(rule: RecurrenceRule, start: string): string {
  const n = Math.max(1, rule.interval)
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq]
  let text = n === 1 ? (rule.freq === 'daily' ? 'Daily' : `${unit[0].toUpperCase()}${unit.slice(1)}ly`) : `Every ${n} ${unit}s`
  if (rule.freq === 'yearly' && n === 1) text = 'Annually'

  if (rule.freq === 'weekly') {
    const days = rule.weekdays.length ? rule.weekdays : [weekdayOf(start)]
    if (n === 1 && sameSet(days, WORKWEEK)) text = 'Every weekday (Monday to Friday)'
    else if (days.length === 7) text += ' on all days'
    else text += ` on ${[...days].sort((a, b) => mondayFirst(a) - mondayFirst(b)).map((d) => weekdayName(d)).join(', ')}`
  } else if (rule.freq === 'monthly') {
    const wd = weekdayName(weekdayOf(start))
    if (rule.monthlyBy === 'day') text += ` on day ${Number(start.slice(8, 10))}`
    else if (rule.monthlyBy === 'lastWeekday') text += ` on the last ${wd}`
    else text += ` on the ${ORDINALS[weekOfMonth(start) - 1]} ${wd}`
  } else if (rule.freq === 'yearly') {
    text += ` on ${monthDayFmt.format(new Date(toUtc(start)))}`
  }

  if (rule.end.type === 'until') text += ` · until ${fullDateFmt.format(new Date(toUtc(rule.end.date)))}`
  else if (rule.end.type === 'count') text += ` · ${rule.end.count} time${rule.end.count === 1 ? '' : 's'}`
  return text
}

/** Label of a preset in the repeat menu. */
export function presetLabel(preset: RecurrencePreset, start: string): string {
  return describeRecurrence(presetRule(preset, start), start)
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && b.every((x) => a.includes(x))
}
