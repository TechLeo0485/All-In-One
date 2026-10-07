/**
 * IANA timezone helpers built on Intl (no tz database bundled). Used by the ICS
 * parser in main and by the renderer's primary/secondary timezone display.
 */

/** Max length of the "Home" / "Work" labels shown above the time columns. */
export const MAX_TIME_ZONE_LABEL = 16

/** One formatter per zone (construction is expensive); null = invalid zone. */
const wallFormatters = new Map<string, Intl.DateTimeFormat | null>()

/** en-US / h23 formatter whose parts give the wall-clock fields in `tz`; null if `tz` is invalid. */
export function zoneFormatter(tz: string): Intl.DateTimeFormat | null {
  if (!wallFormatters.has(tz)) {
    try {
      wallFormatters.set(
        tz,
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      )
    } catch {
      wallFormatters.set(tz, null)
    }
  }
  return wallFormatters.get(tz)!
}

export function isValidTimeZone(tz: string): boolean {
  return zoneFormatter(tz) !== null
}

/** Intl option for showing times in `tz` ('' or invalid = the computer's zone). */
export function timeZoneOption(tz: string): { timeZone?: string } {
  return tz && isValidTimeZone(tz) ? { timeZone: tz } : {}
}

/** The computer's own IANA zone, e.g. "Europe/Helsinki". */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Wall-clock fields of the instant `utcMs` in `fmt`'s zone: [year, month0, day, hour, minute, second]. */
export function wallFields(utcMs: number, fmt: Intl.DateTimeFormat): number[] {
  const parts = fmt.formatToParts(new Date(utcMs))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  // Some engines print midnight as "24" even with h23.
  return [get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')]
}

/** Offset of the zone from UTC at the instant `utcMs`, in ms (positive east of Greenwich). */
export function tzOffsetMs(utcMs: number, fmt: Intl.DateTimeFormat): number {
  const [y, mo, d, h, mi, s] = wallFields(utcMs, fmt)
  return Date.UTC(y, mo, d, h, mi, s) - (utcMs - (((utcMs % 1000) + 1000) % 1000))
}

/** Interprets wall-clock fields (month 0-based) in the formatter's zone; returns UTC ms. */
export function zonedWallTimeToUtc(
  fmt: Intl.DateTimeFormat,
  year: number,
  month0: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): number {
  const asUtc = Date.UTC(year, month0, day, hour, minute, second)
  // Two passes handle DST transitions correctly in nearly all real cases.
  let guess = asUtc - tzOffsetMs(asUtc, fmt)
  guess = asUtc - tzOffsetMs(guess, fmt)
  return guess
}

/** "GMT-04", "GMT+05:30": offset of `tz` (or the local zone) at `date`; it changes with DST. */
export function gmtOffsetLabel(date: Date, tz?: string): string {
  const fmt = tz ? zoneFormatter(tz) : null
  const offset = fmt ? Math.round(tzOffsetMs(date.getTime(), fmt) / 60_000) : -date.getTimezoneOffset()
  const abs = Math.abs(offset)
  const minutes = abs % 60
  return `GMT${offset < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`
}
