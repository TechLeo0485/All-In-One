import { createPlugin } from '@fullcalendar/core'
import { NamedTimeZoneImpl } from '@fullcalendar/core/internal'
import { tzOffsetMs, wallFields, zonedWallTimeToUtc, zoneFormatter } from '@shared/timezone'

/**
 * Lets FullCalendar show named timezones ("America/New_York") using Intl, so
 * no luxon / moment-timezone is needed. FullCalendar works with "wall time"
 * arrays: [year, month0, day, hour, minute, second, ms].
 */
class IntlNamedTimeZone extends NamedTimeZoneImpl {
  private readonly fmt: Intl.DateTimeFormat

  constructor(timeZoneName: string) {
    super(timeZoneName)
    // The zone is validated before it reaches FullCalendar; UTC is only a safety net.
    this.fmt = zoneFormatter(timeZoneName) ?? zoneFormatter('UTC')!
  }

  /** Offset in minutes of the zone at the given wall time. */
  offsetForArray(a: number[]): number {
    const [y, mo = 0, d = 1, h = 0, mi = 0, s = 0] = a
    const utc = zonedWallTimeToUtc(this.fmt, y, mo, d, h, mi, s)
    return Math.round(tzOffsetMs(utc, this.fmt) / 60_000)
  }

  timestampToArray(ms: number): number[] {
    return [...wallFields(ms, this.fmt), ((ms % 1000) + 1000) % 1000]
  }
}

export const intlTimeZonePlugin = createPlugin({
  name: 'intl-time-zone',
  namedTimeZonedImpl: IntlNamedTimeZone
})
