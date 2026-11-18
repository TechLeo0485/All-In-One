import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_MESSAGE_FORMAT,
  formatAvailability,
  formatSpan,
  freeSlots,
  pickDays,
  wallTimeToUtc,
  type SlotOptions
} from '../../shared/availability.ts'

const ET = 'America/New_York'
const at = (date: string, hh: number, mm = 0): number => wallTimeToUtc(date, hh * 60 + mm, ET)
const base: SlotOptions = {
  days: ['2026-11-19'],
  timeZone: ET,
  dayStart: 9 * 60,
  dayEnd: 18 * 60,
  minMinutes: 30,
  bufferMinutes: 0,
  now: 0,
  mode: 'all'
}

describe('pickDays', () => {
  it('skips weekends unless asked', () => {
    assert.deepEqual(pickDays('2026-11-20', 3, false), ['2026-11-20', '2026-11-23', '2026-11-24'])
    assert.deepEqual(pickDays('2026-11-20', 3, true), ['2026-11-20', '2026-11-21', '2026-11-22'])
  })
})

describe('freeSlots', () => {
  it('is the day minus the busy time, in the zone', () => {
    const busy = [[{ start: at('2026-11-19', 12), end: at('2026-11-19', 14) }]]
    const [day] = freeSlots(busy, base)
    assert.deepEqual(day.slots, [
      { start: at('2026-11-19', 9), end: at('2026-11-19', 12) },
      { start: at('2026-11-19', 14), end: at('2026-11-19', 18) }
    ])
  })

  it('keeps the buffer, rounds to the quarter hour and drops short gaps', () => {
    const busy = [
      [
        { start: at('2026-11-19', 10, 5), end: at('2026-11-19', 11) },
        { start: at('2026-11-19', 11, 40), end: at('2026-11-19', 17, 50) }
      ]
    ]
    const [day] = freeSlots(busy, { ...base, bufferMinutes: 15 })
    // 9:00–9:50 → 9:00–9:45; 11:15–11:25 is too short; nothing after 17:50 + 15.
    assert.deepEqual(day.slots, [{ start: at('2026-11-19', 9), end: at('2026-11-19', 9, 45) }])
  })

  it('all: everyone free; any: someone free', () => {
    const a = [{ start: at('2026-11-19', 9), end: at('2026-11-19', 13) }]
    const b = [{ start: at('2026-11-19', 12), end: at('2026-11-19', 18) }]
    assert.deepEqual(freeSlots([a, b], base), [])
    const [any] = freeSlots([a, b], { ...base, mode: 'any' })
    // 12–13 both are busy.
    assert.deepEqual(any.slots, [
      { start: at('2026-11-19', 9), end: at('2026-11-19', 12) },
      { start: at('2026-11-19', 13), end: at('2026-11-19', 18) }
    ])
  })

  it('cuts long free time into slots with breaks', () => {
    const [day] = freeSlots([[]], { ...base, maxMinutes: 120 })
    assert.deepEqual(day.slots, [
      { start: at('2026-11-19', 9), end: at('2026-11-19', 11) },
      { start: at('2026-11-19', 13), end: at('2026-11-19', 15) },
      { start: at('2026-11-19', 17), end: at('2026-11-19', 18) }
    ])
    // A last piece shorter than the shortest slot is left out.
    const [short] = freeSlots([[]], { ...base, maxMinutes: 120, minMinutes: 90 })
    assert.equal(short.slots.length, 2)
  })

  it('offers nothing in the past', () => {
    const [day] = freeSlots([[]], { ...base, now: at('2026-11-19', 15, 7) })
    assert.deepEqual(day.slots, [{ start: at('2026-11-19', 15, 15), end: at('2026-11-19', 18) }])
  })
})

describe('the message', () => {
  it('formats times as in the example', () => {
    assert.equal(formatSpan({ start: at('2026-11-19', 10), end: at('2026-11-19', 12) }, ET, '12h'), '10:00 AM – 12:00 PM')
    assert.equal(formatSpan({ start: at('2026-11-19', 9), end: at('2026-11-19', 11, 30) }, ET, '12h'), '9:00 – 11:30 AM')
    assert.equal(formatSpan({ start: at('2026-11-19', 14), end: at('2026-11-19', 17) }, ET, '24h'), '14:00 – 17:00')
  })

  it('follows the format, in the message zone', () => {
    const days = [
      {
        date: '2026-11-19',
        slots: [
          { start: at('2026-11-19', 10), end: at('2026-11-19', 12) },
          { start: at('2026-11-19', 14), end: at('2026-11-19', 17) }
        ]
      }
    ]
    assert.equal(
      formatAvailability(days, ET, 'ET', DEFAULT_MESSAGE_FORMAT),
      "I'm available at the following times (ET):\n• Thu, Nov 19: 10:00 AM – 12:00 PM, 2:00 – 5:00 PM"
    )
    const oneLine = { ...DEFAULT_MESSAGE_FORMAT, header: '', line: '{day} {times}', dayStyle: 'numeric' as const, footer: 'Times in {zone}.' }
    assert.equal(formatAvailability(days, ET, 'ET', oneLine), 'Thu 11/19 10:00 AM – 12:00 PM, 2:00 – 5:00 PM\nTimes in ET.')
    // Shown in another zone, the same slots read three hours earlier.
    assert.match(formatAvailability(days, 'America/Los_Angeles', 'PT', DEFAULT_MESSAGE_FORMAT), /7:00 – 9:00 AM, 11:00 AM – 2:00 PM/)
  })
})
