import { useState, type FormEvent } from 'react'
import type { LocalEventInput, RecurrenceRule, RecurrenceScope } from '@shared/types'
import {
  isLastWeekdayOfMonth,
  matchPreset,
  presetLabel,
  presetRule,
  presetsFor,
  weekdayName,
  weekdayOf,
  weekOfMonth,
  type RecurrencePreset
} from '@shared/recurrence'
import { useAppStore } from '../stores/appStore'
import {
  addDays,
  formatReminder,
  fromLocalInputValue,
  parseDateString,
  REMINDER_MINUTES,
  todayString,
  toLocalInputValue
} from '../utils/dates'
import { ColorPicker } from './ColorPicker'
import { Button, ColorDot, Field, inputClass, Modal, TextInput } from './ui'

const REMINDER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No reminder', value: null },
  ...REMINDER_MINUTES.map((m) => ({ label: formatReminder(m), value: m }))
]

/**
 * Form state keeps date/time as *input* strings in local time. For all-day events
 * the UI shows an inclusive end date, while storage uses an exclusive one
 * (iCalendar/FullCalendar convention), so we convert on load and save.
 */
interface FormState {
  title: string
  allDay: boolean
  start: string // datetime-local or date
  end: string
  location: string
  description: string
  /** null = follow the default color from Settings */
  color: string | null
  reminderMinutes: number | null
  repeat: 'none' | RecurrencePreset | 'custom'
  /** Used when repeat = 'custom' */
  custom: Pick<RecurrenceRule, 'freq' | 'interval' | 'weekdays' | 'monthlyBy'>
  endType: RecurrenceRule['end']['type']
  endDate: string
  endCount: number
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth']
const UNITS: Record<RecurrenceRule['freq'], string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }
/** Weekday toggles in week order, starting Monday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Local date (YYYY-MM-DD) the form's event starts on. */
const startDateOf = (form: Pick<FormState, 'start'>): string => form.start.slice(0, 10)

/** The repeat rule the form describes, or null for "Does not repeat". */
function buildRule(form: FormState): RecurrenceRule | null {
  if (form.repeat === 'none') return null
  const start = startDateOf(form)
  const rule: RecurrenceRule =
    form.repeat === 'custom'
      ? {
          ...form.custom,
          weekdays: form.custom.freq === 'weekly' ? (form.custom.weekdays.length ? form.custom.weekdays : [weekdayOf(start)]) : [],
          monthlyBy: form.custom.freq === 'monthly' ? form.custom.monthlyBy : 'day',
          end: { type: 'never' }
        }
      : presetRule(form.repeat, start)
  if (form.endType === 'until') rule.end = { type: 'until', date: form.endDate }
  else if (form.endType === 'count') rule.end = { type: 'count', count: form.endCount }
  return rule
}

/** Comparable form of a rule (weekday order doesn't matter). */
function ruleKey(rule: RecurrenceRule | null): string {
  return rule ? JSON.stringify({ ...rule, weekdays: [...rule.weekdays].sort() }) : 'none'
}

/** End for a new start, keeping the event's current duration. */
function shiftEnd(form: FormState, newStart: string): string {
  if (form.allDay) {
    const days = Math.round((parseDateString(form.end).getTime() - parseDateString(form.start).getTime()) / 86_400_000)
    return addDays(newStart, Math.max(days, 0))
  }
  const duration = new Date(form.end).getTime() - new Date(form.start).getTime()
  const ms = Number.isFinite(duration) && duration > 0 ? duration : 60 * 60_000
  return toLocalInputValue(new Date(new Date(newStart).getTime() + ms))
}

function initialState(input: Partial<LocalEventInput>): FormState {
  const allDay = input.allDay ?? false
  let start: string
  let end: string
  if (allDay) {
    start = input.startTime ?? todayString()
    end = input.endTime ? addDays(input.endTime, -1) : start
  } else {
    const s = input.startTime ? new Date(input.startTime) : nextHalfHour()
    const e = input.endTime ? new Date(input.endTime) : new Date(s.getTime() + 60 * 60_000)
    start = toLocalInputValue(s)
    end = toLocalInputValue(e)
  }
  const rule = input.recurrence ?? null
  const startDate = start.slice(0, 10)
  return {
    title: input.title ?? '',
    allDay,
    start,
    end,
    location: input.location ?? '',
    description: input.description ?? '',
    color: input.color ?? null,
    reminderMinutes: input.reminderMinutes ?? null,
    repeat: rule ? (matchPreset(rule, startDate) ?? 'custom') : 'none',
    custom: rule
      ? { freq: rule.freq, interval: rule.interval, weekdays: rule.weekdays, monthlyBy: rule.monthlyBy }
      : { freq: 'weekly', interval: 1, weekdays: [weekdayOf(startDate)], monthlyBy: 'day' },
    endType: rule?.end.type ?? 'never',
    endDate: rule?.end.type === 'until' ? rule.end.date : addDays(startDate, 30),
    endCount: rule?.end.type === 'count' ? rule.end.count : 10
  }
}

function nextHalfHour(): Date {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60)
  return d
}

export function LocalEventDialog() {
  const editor = useAppStore((s) => s.eventEditor)
  const close = useAppStore((s) => s.closeEventEditor)
  const save = useAppStore((s) => s.saveLocalEvent)
  const askRecurrenceScope = useAppStore((s) => s.askRecurrenceScope)
  const defaultColor = useAppStore((s) => s.settings?.localEventColor ?? '#10b981')

  const [form, setForm] = useState<FormState>(() =>
    initialState(editor?.mode === 'edit' ? editor.event : (editor?.defaults ?? {}))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!editor) return null
  const update = (patch: Partial<FormState>): void => setForm((f) => ({ ...f, ...patch }))

  const toggleAllDay = (allDay: boolean): void => {
    if (allDay === form.allDay) return
    if (allDay) {
      update({ allDay, start: form.start.slice(0, 10), end: form.end.slice(0, 10) })
    } else {
      update({ allDay, start: `${form.start}T09:00`, end: `${form.end}T10:00` })
    }
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!form.title.trim()) return setError('Title is required')
    if (!form.start || !form.end) return setError('Start and end are required')
    // All-day end dates are inclusive (same day = one day); timed events need end > start.
    if (form.allDay ? form.end < form.start : form.end <= form.start) return setError('End must be after start')
    const recurrence = buildRule(form)
    if (recurrence?.end.type === 'until' && (!form.endDate || form.endDate < startDateOf(form))) {
      return setError('The repeat end date must be on or after the start')
    }
    if (recurrence?.end.type === 'count' && !(Number.isInteger(form.endCount) && form.endCount >= 1)) {
      return setError('Enter how many times the event repeats')
    }

    // A date of a repeating event: ask which dates the change applies to. A changed
    // repeat rule can't apply to a single date, so "This event" isn't offered then.
    let scope: RecurrenceScope | undefined
    if (editor.mode === 'edit' && editor.event.seriesId) {
      const picked = await askRecurrenceScope('edit', ruleKey(recurrence) === ruleKey(editor.event.recurrence))
      if (!picked) return
      scope = picked
    }

    const input: LocalEventInput = {
      title: form.title.trim(),
      allDay: form.allDay,
      startTime: form.allDay ? form.start : fromLocalInputValue(form.start),
      endTime: form.allDay ? addDays(form.end, 1) : fromLocalInputValue(form.end),
      location: form.location,
      description: form.description,
      color: form.color,
      reminderMinutes: form.reminderMinutes,
      recurrence
    }
    setSaving(true)
    const ok = await save(input, scope)
    setSaving(false)
    if (!ok) setError('Could not save the event')
  }

  return (
    <Modal
      title={editor.mode === 'edit' ? 'Edit local event' : 'New local event'}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="local-event-form" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="local-event-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Title">
          <TextInput autoFocus value={form.title} onChange={(e) => update({ title: e.target.value })} placeholder="Event title" />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
          All day
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Field label={form.allDay ? 'Start date' : 'Starts'}>
            <TextInput
              type={form.allDay ? 'date' : 'datetime-local'}
              value={form.start}
              onChange={(e) => {
                // Keep the duration when the start moves past the end.
                const start = e.target.value
                const patch: Partial<FormState> = start && start > form.end ? { start, end: shiftEnd(form, start) } : { start }
                // Presets depend on the start date ("Monthly on the third Tuesday"); keep the choice valid.
                const repeat = form.repeat
                if (start && repeat !== 'none' && repeat !== 'custom' && !presetsFor(start.slice(0, 10)).includes(repeat)) {
                  patch.repeat = 'monthlyDay'
                }
                update(patch)
              }}
            />
          </Field>
          <Field label={form.allDay ? 'End date' : 'Ends'}>
            <TextInput
              type={form.allDay ? 'date' : 'datetime-local'}
              value={form.end}
              min={form.start}
              onChange={(e) => update({ end: e.target.value })}
            />
          </Field>
        </div>

        <RepeatFields form={form} update={update} />

        <Field label="Location">
          <TextInput value={form.location} onChange={(e) => update({ location: e.target.value })} placeholder="Optional" />
        </Field>

        <Field label="Description">
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Optional"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reminder" hint="Shown as a desktop notification while the app is running">
            <select
              className={inputClass}
              value={form.reminderMinutes ?? ''}
              onChange={(e) => update({ reminderMinutes: e.target.value === '' ? null : Number(e.target.value) })}
            >
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Color"
            hint={form.color === null ? 'Follows the local event color in Settings, also when you change it later.' : undefined}
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => update({ color: null })}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  form.color === null ? 'border-slate-300 text-slate-100' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                <ColorDot color={defaultColor} size={10} /> Default
              </button>
              <ColorPicker value={form.color} onChange={(color) => update({ color })} />
            </div>
          </Field>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Modal>
  )
}

/** "Repeat" menu (Google-style presets + Custom) and when the repeating ends. */
function RepeatFields({ form, update }: { form: FormState; update: (patch: Partial<FormState>) => void }) {
  const start = startDateOf(form)
  if (!start) return null
  const custom = form.custom
  const setCustom = (patch: Partial<FormState['custom']>): void => update({ custom: { ...custom, ...patch } })
  const plural = custom.interval === 1 ? '' : 's'
  const weekday = weekdayName(weekdayOf(start))

  const onRepeatChange = (value: FormState['repeat']): void => {
    if (value === 'custom' && form.repeat !== 'custom') {
      // Start the custom editor from the current choice (or weekly on the start's weekday).
      const base = presetRule(form.repeat === 'none' ? 'weekly' : form.repeat, start)
      update({ repeat: 'custom', custom: { freq: base.freq, interval: base.interval, weekdays: base.weekdays, monthlyBy: base.monthlyBy } })
      return
    }
    update({ repeat: value })
  }

  const toggleWeekday = (day: number): void => {
    const days = custom.weekdays.includes(day) ? custom.weekdays.filter((d) => d !== day) : [...custom.weekdays, day]
    setCustom({ weekdays: days.length ? days : [day] }) // keep at least one day
  }

  return (
    <div className="space-y-3">
      <Field label="Repeat">
        <select className={inputClass} value={form.repeat} onChange={(e) => onRepeatChange(e.target.value as FormState['repeat'])}>
          <option value="none">Does not repeat</option>
          {presetsFor(start).map((p) => (
            <option key={p} value={p}>
              {presetLabel(p, start)}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </Field>

      {form.repeat === 'custom' && (
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Every</span>
            <TextInput
              type="number"
              min={1}
              max={999}
              className={`${inputClass} w-20!`}
              value={custom.interval}
              onChange={(e) => setCustom({ interval: Math.max(1, Math.min(999, Math.floor(Number(e.target.value) || 1))) })}
            />
            <select
              className={`${inputClass} w-auto!`}
              value={custom.freq}
              onChange={(e) => {
                const freq = e.target.value as RecurrenceRule['freq']
                setCustom({ freq, weekdays: custom.weekdays.length ? custom.weekdays : [weekdayOf(start)] })
              }}
            >
              {(Object.keys(UNITS) as RecurrenceRule['freq'][]).map((f) => (
                <option key={f} value={f}>
                  {UNITS[f] + plural}
                </option>
              ))}
            </select>
          </div>

          {custom.freq === 'weekly' && (
            <div className="flex items-center gap-1.5">
              <span className="mr-1 text-sm text-slate-400">On</span>
              {WEEK_ORDER.map((day) => {
                const on = custom.weekdays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    title={weekdayName(day)}
                    aria-pressed={on}
                    onClick={() => toggleWeekday(day)}
                    className={`h-8 w-8 rounded-full text-xs font-medium transition ${
                      on ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {weekdayName(day, true).slice(0, 2)}
                  </button>
                )
              })}
            </div>
          )}

          {custom.freq === 'monthly' && (
            <select
              className={inputClass}
              value={custom.monthlyBy}
              onChange={(e) => setCustom({ monthlyBy: e.target.value as RecurrenceRule['monthlyBy'] })}
            >
              <option value="day">On day {Number(start.slice(8, 10))}</option>
              {weekOfMonth(start) <= 4 && (
                <option value="weekday">
                  On the {ORDINALS[weekOfMonth(start) - 1]} {weekday}
                </option>
              )}
              {isLastWeekdayOfMonth(start) && <option value="lastWeekday">On the last {weekday}</option>}
            </select>
          )}
        </div>
      )}

      {form.repeat !== 'none' && (
        <Field label="Ends">
          <div className="flex items-center gap-2">
            <select
              className={`${inputClass} w-auto!`}
              value={form.endType}
              onChange={(e) => update({ endType: e.target.value as FormState['endType'] })}
            >
              <option value="never">Never</option>
              <option value="until">On date</option>
              <option value="count">After</option>
            </select>
            {form.endType === 'until' && (
              <TextInput type="date" value={form.endDate} min={start} onChange={(e) => update({ endDate: e.target.value })} />
            )}
            {form.endType === 'count' && (
              <>
                <TextInput
                  type="number"
                  min={1}
                  max={5000}
                  className={`${inputClass} w-24!`}
                  value={form.endCount}
                  onChange={(e) => update({ endCount: Math.floor(Number(e.target.value)) })}
                />
                <span className="text-sm text-slate-400">times</span>
              </>
            )}
          </div>
        </Field>
      )}
    </div>
  )
}
