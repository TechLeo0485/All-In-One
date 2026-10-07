import { useEffect, useRef, useState } from 'react'
import { todayString, toDateString } from '../utils/dates'

/** Same as FullCalendar's default (weeks start on Sunday). */
const FIRST_DAY = 0
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2026, 0, 4 + ((i + FIRST_DAY) % 7)))
)
const monthName = (month: number, style: 'long' | 'short'): string =>
  new Intl.DateTimeFormat(undefined, { month: style }).format(new Date(2026, month, 1))

/** The 6 weeks shown for a month, starting on FIRST_DAY. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() - FIRST_DAY + 7) % 7
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i))
}

/**
 * Small month calendar for jumping to a date. Clicking the month name switches to a
 * month grid with year arrows, for jumps further away.
 *
 * `rangeStart`/`rangeEnd` (end exclusive) are the dates the main calendar shows now;
 * they are shaded so it's clear where you are.
 */
export function DatePicker({
  rangeStart,
  rangeEnd,
  onPick,
  onClose,
  toggleSelector
}: {
  rangeStart: Date
  rangeEnd: Date
  onPick: (date: Date) => void
  onClose: () => void
  /** The element that opens/closes the picker; clicks on it are left to its own handler. */
  toggleSelector?: string
}) {
  const [mode, setMode] = useState<'days' | 'months'>('days')
  // The month on screen; starts at the month of the main calendar's current dates.
  const [shown, setShown] = useState(() => {
    const anchor = rangeStart.getDate() === 1 ? rangeStart : new Date((rangeStart.getTime() + rangeEnd.getTime()) / 2)
    return { year: anchor.getFullYear(), month: anchor.getMonth() }
  })
  const ref = useRef<HTMLDivElement>(null)

  // Click outside or Esc closes it.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element
      if (ref.current?.contains(target) || (toggleSelector && target.closest(toggleSelector))) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, toggleSelector])

  const moveMonth = (delta: number): void =>
    setShown(({ year, month }) => {
      const d = new Date(year, month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })

  const today = todayString()
  const startKey = toDateString(rangeStart)
  const endKey = toDateString(rangeEnd)
  const navButton = 'rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100'

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick a date"
      className="w-72 rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <button className={navButton} onClick={() => (mode === 'days' ? moveMonth(-1) : moveMonth(-12))} aria-label={mode === 'days' ? 'Previous month' : 'Previous year'}>
          ‹
        </button>
        <button
          className="rounded-md px-2 py-1 font-semibold text-slate-100 hover:bg-slate-800"
          onClick={() => setMode(mode === 'days' ? 'months' : 'days')}
          title={mode === 'days' ? 'Choose a month' : 'Back to days'}
        >
          {mode === 'days' ? `${monthName(shown.month, 'long')} ${shown.year}` : shown.year}
        </button>
        <button className={navButton} onClick={() => (mode === 'days' ? moveMonth(1) : moveMonth(12))} aria-label={mode === 'days' ? 'Next month' : 'Next year'}>
          ›
        </button>
      </div>

      {mode === 'days' ? (
        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {WEEKDAYS.map((d, i) => (
            <span key={i} className="pb-1 text-[11px] font-medium text-slate-500">
              {d}
            </span>
          ))}
          {monthGrid(shown.year, shown.month).map((date) => {
            const key = toDateString(date)
            const inMonth = date.getMonth() === shown.month
            const inRange = key >= startKey && key < endKey
            const isToday = key === today
            return (
              <button
                key={key}
                onClick={() => onPick(date)}
                className={`mx-auto flex size-8 items-center justify-center rounded-full transition ${
                  inRange ? 'bg-blue-600/30 text-blue-100' : inMonth ? 'text-slate-200' : 'text-slate-600'
                } ${isToday ? 'ring-1 ring-blue-400' : ''} hover:bg-slate-700 hover:text-white`}
                aria-label={date.toDateString()}
                aria-current={isToday ? 'date' : undefined}
              >
                {date.getDate()}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, m) => {
            const current = m === new Date().getMonth() && shown.year === new Date().getFullYear()
            return (
              <button
                key={m}
                onClick={() => {
                  setShown({ year: shown.year, month: m })
                  setMode('days')
                }}
                className={`rounded-md py-2 ${
                  m === shown.month ? 'bg-blue-600/30 text-blue-100' : 'text-slate-200'
                } ${current ? 'ring-1 ring-blue-400' : ''} hover:bg-slate-700`}
              >
                {monthName(m, 'short')}
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-2 flex justify-end border-t border-slate-800 pt-2">
        <button className="rounded-md px-2 py-1 text-xs font-medium text-blue-400 hover:bg-slate-800" onClick={() => onPick(new Date())}>
          Today
        </button>
      </div>
    </div>
  )
}
