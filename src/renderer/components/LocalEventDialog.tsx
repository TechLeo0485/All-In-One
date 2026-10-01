import { useState, type FormEvent } from 'react'
import type { LocalEventInput } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { addDays, fromLocalInputValue, toDateString, toLocalInputValue } from '../utils/dates'
import { ColorPicker } from './ColorPicker'
import { Button, Field, inputClass, Modal, TextInput } from './ui'

const REMINDER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No reminder', value: null },
  { label: 'At start time', value: 0 },
  { label: '5 minutes before', value: 5 },
  { label: '10 minutes before', value: 10 },
  { label: '15 minutes before', value: 15 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '1 day before', value: 1440 }
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
  color: string
  reminderMinutes: number | null
}

function initialState(input: Partial<LocalEventInput>, defaultColor: string): FormState {
  const allDay = input.allDay ?? false
  let start: string
  let end: string
  if (allDay) {
    start = input.startTime ?? toDateString(new Date())
    end = input.endTime ? addDays(input.endTime, -1) : start
  } else {
    const s = input.startTime ? new Date(input.startTime) : nextHalfHour()
    const e = input.endTime ? new Date(input.endTime) : new Date(s.getTime() + 60 * 60_000)
    start = toLocalInputValue(s)
    end = toLocalInputValue(e)
  }
  return {
    title: input.title ?? '',
    allDay,
    start,
    end,
    location: input.location ?? '',
    description: input.description ?? '',
    color: input.color ?? defaultColor,
    reminderMinutes: input.reminderMinutes ?? null
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
  const defaultColor = useAppStore((s) => s.settings?.localEventColor ?? '#10b981')

  const [form, setForm] = useState<FormState>(() =>
    initialState(
      editor?.mode === 'edit' ? { ...editor.event, color: editor.event.color ?? undefined } : (editor?.defaults ?? {}),
      defaultColor
    )
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
    if (form.end < form.start) return setError('End must be after start')

    const input: LocalEventInput = {
      title: form.title.trim(),
      allDay: form.allDay,
      startTime: form.allDay ? form.start : fromLocalInputValue(form.start),
      endTime: form.allDay ? addDays(form.end, 1) : fromLocalInputValue(form.end),
      location: form.location,
      description: form.description,
      color: form.color,
      reminderMinutes: form.reminderMinutes
    }
    setSaving(true)
    const ok = await save(input)
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
                update(start > form.end ? { start, end: start } : { start })
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
          <Field label="Color">
            <ColorPicker value={form.color} onChange={(color) => update({ color })} />
          </Field>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Modal>
  )
}
