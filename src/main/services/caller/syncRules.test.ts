import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { backoff, busyBlocksFrom, missedSummary, queuedOutcome, teamworkHasLatest, type BusyCandidate } from './syncRules.ts'

const HOUR = 3_600_000
const ev = (id: string, calendarId: string | null, start: string, hours: number, extra: Partial<BusyCandidate> = {}): BusyCandidate => ({
  id,
  calendarId,
  startTime: start,
  endTime: new Date(Date.parse(start) + hours * HOUR).toISOString(),
  allDay: false,
  myResponse: null,
  title: `Event ${id}`,
  location: '',
  attendees: [],
  ...extra
})

describe('busy time', () => {
  const exclude = { calendarIds: new Set(['shared', 'teamwork']), eventIds: new Set(['picked']) }

  it('keeps timed events of the member’s own calendars, sorted, with title, place and guests only', () => {
    const guest = { name: 'Hannah', email: 'h@example.com', status: 'accepted', isOrganizer: true }
    const got = busyBlocksFrom(
      [
        ev('b', 'work', '2026-11-12T15:00:00.000Z', 1),
        ev('a', 'work', '2026-11-12T09:00:00.000Z', 0.5, { location: 'Teams', attendees: [{ ...guest, optional: false } as never] })
      ],
      exclude,
      16 * HOUR
    )
    assert.deepEqual(got, [
      { start: '2026-11-12T09:00:00.000Z', end: '2026-11-12T09:30:00.000Z', title: 'Event a', location: 'Teams', attendees: [guest] },
      { start: '2026-11-12T15:00:00.000Z', end: '2026-11-12T16:00:00.000Z', title: 'Event b', location: '', attendees: [] }
    ])
    // Nothing else of the event goes (no description, links or notes).
    assert.deepEqual(Object.keys(got[0]).sort(), ['attendees', 'end', 'location', 'start', 'title'])
  })

  it('leaves out shared calendars, Teamwork’s own, picked, declined, all-day, local, empty and multi-day events', () => {
    const got = busyBlocksFrom(
      [
        ev('1', 'shared', '2026-11-12T09:00:00Z', 1),
        ev('2', 'teamwork', '2026-11-12T09:00:00Z', 1),
        ev('picked', 'work', '2026-11-12T09:00:00Z', 1),
        ev('4', 'work', '2026-11-12T09:00:00Z', 1, { myResponse: 'declined' }),
        ev('5', 'work', '2026-11-12T00:00:00Z', 24, { allDay: true }),
        ev('6', null, '2026-11-12T09:00:00Z', 1),
        ev('7', 'work', '2026-11-12T09:00:00Z', 0),
        ev('8', 'work', '2026-11-12T09:00:00Z', 20),
        ev('keep', 'work', '2026-11-12T09:00:00Z', 1, { myResponse: 'accepted' })
      ],
      exclude,
      16 * HOUR
    )
    assert.equal(got.length, 1)
  })
})

describe('changes made offline', () => {
  it('sends when Teamwork still says what it said when the change was made', () => {
    assert.equal(queuedOutcome({ kind: 'assign', base: '', callerId: 'ann' }, ''), 'send')
    assert.equal(queuedOutcome({ kind: 'link', base: 'https://a', url: 'https://b' }, 'https://a'), 'send')
    assert.equal(queuedOutcome({ kind: 'resume', base: 'file-1' }, 'file-1'), 'send')
  })

  it('never overwrites what someone else changed meanwhile', () => {
    assert.equal(queuedOutcome({ kind: 'assign', base: '', callerId: 'ann' }, 'bob'), 'changed')
    assert.equal(queuedOutcome({ kind: 'resume', base: '' }, 'file-2'), 'changed')
    assert.equal(queuedOutcome({ kind: 'color', base: '#111111', color: '#222222' }, '#333333'), 'changed')
  })

  it('counts a change Teamwork already shows as done (never sent twice)', () => {
    assert.equal(queuedOutcome({ kind: 'assign', base: '', callerId: 'ann' }, 'ann'), 'done')
    assert.equal(queuedOutcome({ kind: 'assign', base: 'ann', callerId: null }, ''), 'done')
    assert.equal(queuedOutcome({ kind: 'link', base: '', url: null }, ''), 'done')
    assert.equal(queuedOutcome({ kind: 'color', base: '#111111', color: '#ABCDEF' }, '#abcdef'), 'done')
  })

  it('drops a change whose interview or calendar is gone', () => {
    assert.equal(queuedOutcome({ kind: 'assign', base: '', callerId: 'ann' }, null), 'gone')
  })
})

describe('what Teamwork holds', () => {
  it('holds the latest only when the fingerprints match and the last send didn’t fail', () => {
    assert.equal(teamworkHasLatest({ clientHash: 'h1' }, { lastHash: 'h1', lastError: null }), true)
    assert.equal(teamworkHasLatest({ clientHash: 'h1' }, { lastHash: 'h2', lastError: null }), false)
    assert.equal(teamworkHasLatest({ clientHash: 'h1' }, { lastHash: 'h1', lastError: 'boom' }), false)
    // Not listed, or an older server without fingerprints: send again (a definite "not found" stops sharing).
    assert.equal(teamworkHasLatest(undefined, { lastHash: 'h1' }), false)
    assert.equal(teamworkHasLatest({ clientHash: null }, { lastHash: null }), false)
  })
})

describe('While you were away', () => {
  const now = Date.parse('2026-11-12T12:00:00Z')
  const n = (type: string, at: string, readAt: string | null = null) => ({ type, createdAt: at, readAt })

  it('counts each notification once', () => {
    const line = missedSummary(
      [
        n('event.assigned', '2026-11-12T10:00:00Z'),
        n('interview.assigned', '2026-11-12T10:05:00Z'),
        n('interview.changed', '2026-11-12T10:10:00Z'),
        n('event.rescheduled', '2026-11-12T10:15:00Z'),
        n('study.assigned', '2026-11-12T10:20:00Z')
      ],
      '2026-11-12T09:00:00Z',
      now,
      7
    )
    assert.equal(line, '2 interviews assigned to you, 2 interview updates, 1 other notification.')
  })

  it('leaves out what was read, came before going away, or is older than the limit', () => {
    const items = [
      n('interview.assigned', '2026-11-12T10:00:00Z', '2026-11-12T11:00:00Z'),
      n('interview.assigned', '2026-11-12T08:00:00Z'),
      n('interview.assigned', '2026-10-01T08:00:00Z')
    ]
    assert.equal(missedSummary(items, '2026-11-12T09:00:00Z', now, 7), null)
    assert.equal(missedSummary(items, '2026-09-01T00:00:00Z', now, 7), '1 interview assigned to you.')
  })
})

describe('backoff', () => {
  it('doubles from the shortest wait up to the longest', () => {
    assert.deepEqual([0, 1, 2, 3, 10].map((t) => backoff(t, 30_000, 600_000)), [30_000, 60_000, 120_000, 240_000, 600_000])
  })
})
