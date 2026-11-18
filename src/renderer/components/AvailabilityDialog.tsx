import { useEffect, useMemo, useState } from 'react'
import type { AvailabilityBusy, AvailabilityPeople } from '@shared/types'
import {
  addDate,
  dateIn,
  DEFAULT_MESSAGE_FORMAT,
  formatAvailability,
  formatDay,
  formatSpan,
  freeSlots,
  pickDays,
  wallTimeToUtc,
  type DaySlots,
  type MessageFormat
} from '@shared/availability'
import { gmtOffsetLabel, isValidTimeZone } from '@shared/timezone'
import { useAppStore } from '../stores/appStore'
import { displayTimeZone } from '../utils/dates'
import { errorMessage } from '../utils/errors'
import { Button, Field, inputClass, Modal, Spinner, Toggle } from './ui'
import { XIcon } from './icons'

/** Zones recruiters usually write in: [IANA zone, name in the message, name in the list]. */
const ZONES: Array<[string, string, string]> = [
  ['America/New_York', 'ET', 'Eastern (ET)'],
  ['America/Chicago', 'CT', 'Central (CT)'],
  ['America/Denver', 'MT', 'Mountain (MT)'],
  ['America/Phoenix', 'MST', 'Arizona (MST)'],
  ['America/Los_Angeles', 'PT', 'Pacific (PT)'],
  ['America/Anchorage', 'AKT', 'Alaska (AKT)'],
  ['Pacific/Honolulu', 'HT', 'Hawaii (HT)'],
  ['UTC', 'UTC', 'UTC'],
  ['Europe/London', 'UK time', 'London (UK)'],
  ['Europe/Berlin', 'CET', 'Central Europe (CET)'],
  ['Asia/Kolkata', 'IST', 'India (IST)']
]

interface Prefs {
  who: string
  days: number
  weekends: boolean
  dayStart: string
  dayEnd: string
  zone: string
  zoneName: string
  minMinutes: number
  /** 0 = a whole free gap. */
  maxMinutes: number
  bufferMinutes: number
  /** 0 = every slot. */
  maxPerDay: number
  format: MessageFormat
}

const PREFS_KEY = 'availability.prefs'
const DEFAULT_PREFS: Prefs = {
  who: 'me',
  days: 3,
  weekends: false,
  dayStart: '09:00',
  dayEnd: '18:00',
  zone: 'America/New_York',
  zoneName: 'ET',
  minMinutes: 30,
  maxMinutes: 120,
  bufferMinutes: 0,
  maxPerDay: 2,
  format: DEFAULT_MESSAGE_FORMAT
}

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null
    if (!saved) return DEFAULT_PREFS
    const prefs = { ...DEFAULT_PREFS, ...saved, format: { ...DEFAULT_MESSAGE_FORMAT, ...saved.format } }
    return isValidTimeZone(prefs.zone) ? prefs : { ...prefs, zone: DEFAULT_PREFS.zone, zoneName: DEFAULT_PREFS.zoneName }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Remembering the choices is a convenience only.
  }
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const slotKey = (s: { start: number; end: number }): string => `${s.start}-${s.end}`

const JOINERS: Array<[string, string]> = [
  ['\n', 'A line per day'],
  ['; ', 'One line ("; " between days)'],
  [' | ', 'One line (" | " between days)']
]

const selectClass = `${inputClass} pr-7`

/**
 * Get availability: free times of the member, a caller, or any caller over the
 * next few days, written as a message to send (in the recruiter's time zone),
 * ready to copy. The message's wording is editable and remembered.
 */
export function AvailabilityDialog({ onClose }: { onClose: () => void }) {
  const notify = useAppStore((s) => s.notify)
  const eventsVersion = useAppStore((s) => s.eventsVersion)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const update = (patch: Partial<Prefs>): void =>
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  const setFormat = (patch: Partial<MessageFormat>): void => update({ format: { ...prefs.format, ...patch } })

  const [first, setFirst] = useState(() => addDate(dateIn(Date.now(), prefs.zone), 1))
  const [people, setPeople] = useState<AvailabilityPeople | null>(null)
  const [busy, setBusy] = useState<AvailabilityBusy[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<string | null>(null)
  const [showFormat, setShowFormat] = useState(false)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.api.availability
        .people()
        .then((p) => alive && setPeople(p))
        .catch(() => alive && setPeople({ connected: false, callers: [] }))
    }
    load()
    const off = window.api.caller.onChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [])

  // A caller who's gone (or not connected any more): back to Me.
  const callers = people?.callers ?? []
  const who = prefs.who === 'me' || (prefs.who === 'any' && callers.length) || callers.some((c) => c.userId === prefs.who) ? prefs.who : 'me'

  const days = useMemo(() => pickDays(first, prefs.days, prefs.weekends), [first, prefs.days, prefs.weekends])
  const range = useMemo(() => {
    if (!days.length) return null
    return {
      from: new Date(wallTimeToUtc(days[0], 0, prefs.zone) - 86_400_000).toISOString(),
      to: new Date(wallTimeToUtc(addDate(days[days.length - 1], 1), 0, prefs.zone) + 86_400_000).toISOString()
    }
  }, [days, prefs.zone])

  useEffect(() => {
    if (!range || !people) return
    let alive = true
    setError(null)
    window.api.availability
      .busy(who, range.from, range.to)
      .then((b) => alive && setBusy(b))
      .catch((err) => {
        if (!alive) return
        setBusy(null)
        setError(errorMessage(err))
      })
    return () => {
      alive = false
    }
  }, [who, range, people, eventsVersion])

  const found: DaySlots[] = useMemo(() => {
    if (!busy) return []
    const dayStart = minutesOf(prefs.dayStart)
    const dayEnd = prefs.dayEnd === '00:00' ? 1440 : minutesOf(prefs.dayEnd)
    return freeSlots(
      busy.map((p) => p.blocks.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))),
      {
        days,
        timeZone: prefs.zone,
        dayStart,
        dayEnd,
        minMinutes: prefs.minMinutes,
        maxMinutes: prefs.maxMinutes,
        bufferMinutes: prefs.bufferMinutes,
        now: Date.now(),
        mode: who === 'any' ? 'any' : 'all'
      }
    )
  }, [busy, days, prefs.zone, prefs.dayStart, prefs.dayEnd, prefs.minMinutes, prefs.maxMinutes, prefs.bufferMinutes, who])

  // Different slots: the ones taken out before don't apply any more.
  useEffect(() => setRemoved(new Set()), [found])

  // Up to N per day (the longest, kept in time order), minus the ones taken out.
  const chosen = useMemo(
    () =>
      found
        .map((d) => {
          let slots = d.slots.filter((s) => !removed.has(slotKey(s)))
          if (prefs.maxPerDay > 0 && slots.length > prefs.maxPerDay) {
            const keep = new Set([...slots].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, prefs.maxPerDay))
            slots = slots.filter((s) => keep.has(s))
          }
          return { date: d.date, slots }
        })
        .filter((d) => d.slots.length),
    [found, removed, prefs.maxPerDay]
  )

  const generated = useMemo(
    () => (chosen.length ? formatAvailability(chosen, prefs.zone, prefs.zoneName.trim() || prefs.zone, prefs.format) : ''),
    [chosen, prefs.zone, prefs.zoneName, prefs.format]
  )
  // Typing in the message keeps it until the slots or the format change.
  useEffect(() => setDraft(null), [generated])
  const message = draft ?? generated

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message)
      notify('Availability copied', 'info')
    } catch (err) {
      notify(`Could not copy: ${errorMessage(err)}`, 'error')
    }
  }

  const pickZone = (zone: string): void => {
    const known = ZONES.find(([z]) => z === zone)
    // The days stay; their hours now read in the new zone.
    update({ zone, zoneName: known ? known[1] : gmtOffsetLabel(new Date(), zone) })
  }

  const myZone = displayTimeZone()
  const zoneOptions = ZONES.some(([z]) => z === myZone) ? ZONES : [[myZone, gmtOffsetLabel(new Date(), myZone), `My time (${myZone})`] as [string, string, string], ...ZONES]
  const noApp = (busy ?? []).filter((p) => !p.hasApp).map((p) => p.name)
  const today = dateIn(Date.now(), prefs.zone)

  return (
    <Modal
      title="Get availability"
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void copy()} disabled={!message.trim()}>
            Copy message
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Field label="Whose free time">
            <select className={selectClass} value={who} onChange={(e) => update({ who: e.target.value })}>
              <option value="me">Me (my calendars and my interviews)</option>
              {callers.length > 0 && <option value="any">Any caller (at least one is free)</option>}
              {callers.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                  {c.mine ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              <input type="date" className={inputClass} value={first} min={today} onChange={(e) => e.target.value && setFirst(e.target.value)} />
            </Field>
            <Field label="Days">
              <select className={selectClass} value={prefs.days} onChange={(e) => update({ days: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 7, 10, 14].map((n) => (
                  <option key={n} value={n}>
                    {n} {prefs.weekends ? (n === 1 ? 'day' : 'days') : n === 1 ? 'working day' : 'working days'}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Button variant="secondary" className="px-2! py-1! text-xs!" onClick={() => setFirst(today)}>
              Today
            </Button>
            <Button variant="secondary" className="px-2! py-1! text-xs!" onClick={() => setFirst(addDate(today, 1))}>
              Tomorrow
            </Button>
            <span className="ml-auto flex items-center gap-2 text-slate-300">
              Weekends
              <Toggle checked={prefs.weekends} onChange={(weekends) => update({ weekends })} label="Include weekends" />
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Time zone of the message">
              <select className={selectClass} value={prefs.zone} onChange={(e) => pickZone(e.target.value)}>
                {zoneOptions.map(([z, , label]) => (
                  <option key={z} value={z}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Named in the message">
              <input className={inputClass} value={prefs.zoneName} maxLength={40} onChange={(e) => update({ zoneName: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={`From (${prefs.zoneName || 'zone'})`}>
              <input type="time" step={900} className={inputClass} value={prefs.dayStart} onChange={(e) => e.target.value && update({ dayStart: e.target.value })} />
            </Field>
            <Field label="Until">
              <input type="time" step={900} className={inputClass} value={prefs.dayEnd} onChange={(e) => e.target.value && update({ dayEnd: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Slot length">
              <select className={selectClass} value={prefs.maxMinutes} onChange={(e) => update({ maxMinutes: Number(e.target.value) })}>
                {[30, 60, 90, 120, 180].map((n) => (
                  <option key={n} value={n}>
                    {n < 60 ? `${n} min` : `${n / 60} ${n === 60 ? 'hour' : 'hours'}`}
                  </option>
                ))}
                <option value={0}>Whole free time</option>
              </select>
            </Field>
            <Field label="Shortest slot">
              <select className={selectClass} value={prefs.minMinutes} onChange={(e) => update({ minMinutes: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120].map((n) => (
                  <option key={n} value={n}>
                    {n} min
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Buffer">
              <select className={selectClass} value={prefs.bufferMinutes} onChange={(e) => update({ bufferMinutes: Number(e.target.value) })}>
                {[0, 10, 15, 30].map((n) => (
                  <option key={n} value={n}>
                    {n ? `${n} min` : 'None'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Per day">
              <select className={selectClass} value={prefs.maxPerDay} onChange={(e) => update({ maxPerDay: Number(e.target.value) })}>
                <option value={0}>All</option>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    Up to {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="rounded-lg border border-slate-800">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-300 hover:text-white"
              aria-expanded={showFormat}
              onClick={() => setShowFormat((v) => !v)}
            >
              Message format
              <span aria-hidden>{showFormat ? '▴' : '▾'}</span>
            </button>
            {showFormat && <FormatEditor format={prefs.format} onChange={setFormat} onReset={() => update({ format: DEFAULT_MESSAGE_FORMAT })} />}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {noApp.length > 0 && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {noApp.join(', ')} {noApp.length === 1 ? "doesn't" : "don't"} send busy time from the app (or you can't see it): only
              their Teamwork interviews count.
            </p>
          )}

          <div>
            <div className="mb-1 text-xs font-medium text-slate-300">Free times</div>
            {!busy && !error ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                <Spinner /> Looking at the calendars…
              </div>
            ) : found.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-700 p-4 text-center text-sm text-slate-400">
                No free time in these hours. Try more days, longer hours or a shorter slot.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {found.map((d) => (
                  <li key={d.date} className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="w-28 shrink-0 text-slate-400">{formatDay(d.date, 'short')}</span>
                    {d.slots.map((s) => {
                      const out = removed.has(slotKey(s)) || !chosen.some((c) => c.slots.includes(s))
                      return (
                        <span
                          key={slotKey(s)}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                            out ? 'border-slate-800 text-slate-500 line-through' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                          }`}
                        >
                          {formatSpan(s, prefs.zone, prefs.format.clock)}
                          <button
                            type="button"
                            className="rounded-full p-0.5 hover:bg-slate-700"
                            aria-label={out ? 'Put back' : 'Leave out'}
                            title={out ? 'Put back' : 'Leave out of the message'}
                            onClick={() =>
                              setRemoved((r) => {
                                const next = new Set(r)
                                if (next.has(slotKey(s))) next.delete(slotKey(s))
                                else next.add(slotKey(s))
                                return next
                              })
                            }
                          >
                            {out ? <span className="px-0.5 text-[10px]">↺</span> : <XIcon size={12} />}
                          </button>
                        </span>
                      )
                    })}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Field label="Message" hint={draft !== null ? 'Edited by hand: changing a setting writes it again.' : 'You can edit it before copying.'}>
            <textarea
              className={`${inputClass} min-h-48 font-mono text-[13px] leading-relaxed`}
              value={message}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="The free times appear here."
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function FormatEditor({ format, onChange, onReset }: { format: MessageFormat; onChange: (patch: Partial<MessageFormat>) => void; onReset: () => void }) {
  return (
    <div className="space-y-2.5 border-t border-slate-800 px-3 py-3">
      <Field label="First line" hint="{zone} is the time zone's name. Leave empty for none.">
        <input className={inputClass} value={format.header} maxLength={300} onChange={(e) => onChange({ header: e.target.value })} />
      </Field>
      <Field label="Each day" hint="{day} and {times}, e.g. “• {day}: {times}”.">
        <input className={inputClass} value={format.line} maxLength={200} onChange={(e) => onChange({ line: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Between times">
          <input className={inputClass} value={format.separator} maxLength={20} onChange={(e) => onChange({ separator: e.target.value })} />
        </Field>
        <Field label="Between days">
          <select className={selectClass} value={format.dayJoiner} onChange={(e) => onChange({ dayJoiner: e.target.value })}>
            {JOINERS.map(([v, label]) => (
              <option key={label} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day as">
          <select className={selectClass} value={format.dayStyle} onChange={(e) => onChange({ dayStyle: e.target.value as MessageFormat['dayStyle'] })}>
            <option value="short">{formatDay('2026-11-19', 'short')}</option>
            <option value="long">{formatDay('2026-11-19', 'long')}</option>
            <option value="numeric">{formatDay('2026-11-19', 'numeric')}</option>
          </select>
        </Field>
        <Field label="Clock">
          <select className={selectClass} value={format.clock} onChange={(e) => onChange({ clock: e.target.value as MessageFormat['clock'] })}>
            <option value="12h">2:00 PM</option>
            <option value="24h">14:00</option>
          </select>
        </Field>
      </div>
      <Field label="Last line" hint="E.g. “Let me know what works best.” Leave empty for none.">
        <input className={inputClass} value={format.footer} maxLength={300} onChange={(e) => onChange({ footer: e.target.value })} />
      </Field>
      <div className="flex justify-end">
        <Button variant="ghost" className="text-xs!" onClick={onReset}>
          Back to the default
        </Button>
      </div>
    </div>
  )
}
