import type { CalendarEvent } from '@shared/types'

/**
 * Writes picked events as an iCalendar file for Teamwork: one VEVENT per
 * event, with its title, time, place, description and guests. The UID is the
 * event's id from its own calendar, so the same event keeps the same interview
 * on Teamwork across uploads.
 */

const PARTSTAT: Record<string, string> = {
  accepted: 'ACCEPTED',
  tentative: 'TENTATIVE',
  declined: 'DECLINED',
  'needs-action': 'NEEDS-ACTION'
}

/** RFC 5545 text: backslash, semicolon, comma and newlines escaped. */
function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Parameter values with separators in them are quoted (quotes themselves can't appear). */
function param(value: string): string {
  const clean = value.replace(/"/g, "'")
  return /[;:,]/.test(clean) ? `"${clean}"` : clean
}

/** 20261110T150000Z */
function utc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** All-day events keep their calendar dates: 20261110 */
function date(isoOrDay: string): string {
  return isoOrDay.slice(0, 10).replace(/-/g, '')
}

/** Lines longer than 75 octets continue on the next line, starting with a space. */
function fold(line: string): string {
  const out: string[] = []
  let rest = line
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut--
    out.push(rest.slice(0, cut))
    rest = ` ${rest.slice(cut)}`
  }
  out.push(rest)
  return out.join('\r\n')
}

export function buildIcs(events: CalendarEvent[], name: string): string {
  const now = utc(new Date().toISOString())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//All-In-One//Picked interviews//EN', `X-WR-CALNAME:${text(name)}`]
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${text(e.externalId || e.id)}`, `DTSTAMP:${now}`)
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${date(e.startTime)}`, `DTEND;VALUE=DATE:${date(e.endTime)}`)
    } else {
      lines.push(`DTSTART:${utc(e.startTime)}`, `DTEND:${utc(e.endTime)}`)
    }
    lines.push(`SUMMARY:${text(e.title || 'Interview')}`)
    if (e.location) lines.push(`LOCATION:${text(e.location)}`)
    if (e.description) lines.push(`DESCRIPTION:${text(e.description)}`)
    const organizer = e.attendees.find((a) => a.isOrganizer && a.email)
    if (organizer) lines.push(`ORGANIZER${organizer.name ? `;CN=${param(organizer.name)}` : ''}:mailto:${organizer.email}`)
    for (const a of e.attendees) {
      if (!a.email) continue
      const params = [
        a.name ? `CN=${param(a.name)}` : null,
        `PARTSTAT=${PARTSTAT[a.status] ?? 'NEEDS-ACTION'}`,
        a.optional ? 'ROLE=OPT-PARTICIPANT' : null
      ].filter(Boolean)
      lines.push(`ATTENDEE;${params.join(';')}:mailto:${a.email}`)
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
