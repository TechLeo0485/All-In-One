/**
 * "Get availability": free time slots from busy time, and the message that
 * lists them. Pure functions (no imports), so the renderer and the tests share
 * them. Times are UTC milliseconds; days and hours are wall time in `timeZone`.
 */

export interface Span {
  start: number
  end: number
}

export interface DaySlots {
  /** YYYY-MM-DD in the message's zone. */
  date: string
  slots: Span[]
}

export interface SlotOptions {
  /** Days to look at, YYYY-MM-DD in `timeZone`. */
  days: string[]
  timeZone: string
  /** Hours of the day to offer, minutes after midnight in `timeZone` (end may be 1440). */
  dayStart: number
  dayEnd: number
  /** Shorter free gaps are left out. */
  minMinutes: number
  /**
   * Longest slot offered (0 = a whole free gap). A longer gap gives slots of
   * this length with a break as long between them: 9–11, 1–3, 5–6.
   */
  maxMinutes?: number
  /** Kept free before and after each busy block. */
  bufferMinutes: number
  /** Nothing earlier than this is offered. */
  now: number
  /**
   * `all`: free when every person is (one person: their free time).
   * `any`: free when at least one person is (any caller can take it).
   */
  mode: 'all' | 'any'
}

const MINUTE = 60_000
/** Slots start and end on the quarter hour. */
const GRID = 15 * MINUTE

const formatters = new Map<string, Intl.DateTimeFormat>()
function wallFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(zone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    formatters.set(zone, fmt)
  }
  return fmt
}

function wall(ms: number, zone: string): number[] {
  const parts = wallFormatter(zone).formatToParts(new Date(ms))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  return [get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')]
}

function offset(ms: number, zone: string): number {
  const [y, mo, d, h, mi, s] = wall(ms, zone)
  return Date.UTC(y, mo, d, h, mi, s) - (ms - (((ms % 1000) + 1000) % 1000))
}

/** The instant of a wall time (`minutes` after midnight of `date`) in `zone`. */
export function wallTimeToUtc(date: string, minutes: number, zone: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const asUtc = Date.UTC(y, m - 1, d) + minutes * MINUTE
  let guess = asUtc - offset(asUtc, zone)
  guess = asUtc - offset(guess, zone)
  return guess
}

/** YYYY-MM-DD of an instant in `zone`. */
export function dateIn(ms: number, zone: string): string {
  const [y, mo, d] = wall(ms, zone)
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function addDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function isWeekend(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 || day === 6
}

/** `count` days from `first` on, weekends skipped unless asked for. */
export function pickDays(first: string, count: number, weekends: boolean): string[] {
  const days: string[] = []
  for (let date = first; days.length < count && days.length < 60; date = addDate(date, 1)) {
    if (weekends || !isWeekend(date)) days.push(date)
  }
  return days
}

/** Sorted, overlapping or touching spans joined. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  const out: Span[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else out.push({ ...s })
  }
  return out
}

/** `window` minus the (merged) busy spans. */
function subtract(window: Span, busy: Span[]): Span[] {
  const free: Span[] = []
  let cursor = window.start
  for (const b of busy) {
    if (b.end <= cursor) continue
    if (b.start >= window.end) break
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, window.end) })
    cursor = Math.max(cursor, b.end)
    if (cursor >= window.end) break
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end })
  return free
}

/** Pieces of `max` length with a break as long between them (the last may be shorter). */
function split(span: Span, max: number): Span[] {
  const out: Span[] = []
  for (let start = span.start; start < span.end; start += 2 * max) out.push({ start, end: Math.min(start + max, span.end) })
  return out
}

/** Spans in both lists. */
function intersect(a: Span[], b: Span[]): Span[] {
  const out: Span[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start)
    const end = Math.min(a[i].end, b[j].end)
    if (end > start) out.push({ start, end })
    if (a[i].end < b[j].end) i++
    else j++
  }
  return out
}

/**
 * Free slots per day. `busy` has one list per person (any order, may overlap).
 * Each slot is on the quarter-hour grid of the day's hours and at least
 * `minMinutes` long; days without any slot are left out.
 */
export function freeSlots(busy: Span[][], o: SlotOptions): DaySlots[] {
  const buffer = o.bufferMinutes * MINUTE
  const people = (busy.length ? busy : [[]]).map((list) =>
    mergeSpans(list.map((b) => ({ start: b.start - buffer, end: b.end + buffer })))
  )
  const out: DaySlots[] = []
  for (const date of o.days) {
    const dayStart = wallTimeToUtc(date, o.dayStart, o.timeZone)
    const window = { start: Math.max(dayStart, o.now), end: wallTimeToUtc(date, o.dayEnd, o.timeZone) }
    if (window.end <= window.start) continue
    const each = people.map((p) => subtract(window, p))
    const free =
      o.mode === 'all' ? each.reduce((acc, f) => intersect(acc, f)) : mergeSpans(each.flat())
    const min = Math.max(o.minMinutes, 1) * MINUTE
    const max = o.maxMinutes ? Math.max(o.maxMinutes * MINUTE, min) : 0
    const slots = free
      .map((s) => ({
        start: dayStart + Math.ceil((s.start - dayStart) / GRID) * GRID,
        end: dayStart + Math.floor((s.end - dayStart) / GRID) * GRID
      }))
      .flatMap((s) => (max ? split(s, max) : [s]))
      .filter((s) => s.end - s.start >= min)
    if (slots.length) out.push({ date, slots })
  }
  return out
}

// ---------------------------------------------------------------------------
// The message

export interface MessageFormat {
  /** First line; {zone} is the zone's name. Empty = none. */
  header: string
  /** One per day; {day} and {times}. */
  line: string
  /** Between the times of one day. */
  separator: string
  /** Between the days: a new line, or e.g. "; " for one line. */
  dayJoiner: string
  /** Last line. Empty = none. */
  footer: string
  /** "Tue, Nov 19" · "Tuesday, November 19" · "Tue 11/19". */
  dayStyle: 'short' | 'long' | 'numeric'
  clock: '12h' | '24h'
}

export const DEFAULT_MESSAGE_FORMAT: MessageFormat = {
  header: "I'm available at the following times ({zone}):",
  line: '• {day}: {times}',
  separator: ', ',
  dayJoiner: '\n',
  footer: '',
  dayStyle: 'short',
  clock: '12h'
}

/** The day as the format names it. */
export function formatDay(date: string, style: MessageFormat['dayStyle']): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d, 12))
  if (style === 'numeric') {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(at)
    return `${weekday} ${m}/${d}`
  }
  return new Intl.DateTimeFormat('en-US', {
    weekday: style,
    month: style,
    day: 'numeric',
    timeZone: 'UTC'
  }).format(at)
}

function clockParts(ms: number, zone: string): { hour: number; minute: number } {
  const [, , , hour, minute] = wall(ms, zone)
  return { hour, minute }
}

/** "10:00 AM – 12:00 PM", "9:00 – 11:30 AM" (same half of the day), or "14:00 – 17:00". */
export function formatSpan(span: Span, zone: string, clock: MessageFormat['clock']): string {
  const a = clockParts(span.start, zone)
  const b = clockParts(span.end, zone)
  // A slot to midnight ends at "24:00" / "12:00 AM".
  if (b.hour === 0 && b.minute === 0 && span.end > span.start) b.hour = 24
  const mm = (n: number): string => String(n).padStart(2, '0')
  if (clock === '24h') return `${mm(a.hour)}:${mm(a.minute)} – ${mm(b.hour)}:${mm(b.minute)}`
  const half = (h: number): string => (h % 24 < 12 ? 'AM' : 'PM')
  const h12 = (h: number): number => (h % 12 === 0 ? 12 : h % 12)
  const left = `${h12(a.hour)}:${mm(a.minute)}`
  const right = `${h12(b.hour)}:${mm(b.minute)} ${half(b.hour)}`
  return half(a.hour) === half(b.hour) ? `${left} – ${right}` : `${left} ${half(a.hour)} – ${right}`
}

/** The message listing the slots. */
export function formatAvailability(days: DaySlots[], zone: string, zoneName: string, f: MessageFormat): string {
  const lines = days.map((d) =>
    f.line
      .replaceAll('{day}', formatDay(d.date, f.dayStyle))
      .replaceAll('{times}', d.slots.map((s) => formatSpan(s, zone, f.clock)).join(f.separator))
  )
  const body = lines.join(f.dayJoiner)
  return [f.header.replaceAll('{zone}', zoneName).trim(), body, f.footer.replaceAll('{zone}', zoneName).trim()]
    .filter(Boolean)
    .join('\n')
}
