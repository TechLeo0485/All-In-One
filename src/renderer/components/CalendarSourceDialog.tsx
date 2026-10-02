import { useState, type FormEvent } from 'react'
import type { CalendarSource } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { nextUnusedColor } from '@shared/colors'
import { isFileSource, isGoogleCalendarUrl, isOutlookCalendarUrl, outlookIcsUrl } from '@shared/sources'
import { fileNameFromUrl, filePathFromUrl } from '../utils/sources'
import { ColorPicker } from './ColorPicker'
import { Button, Field, Modal, TextInput } from './ui'

type SourceKind = 'file' | 'link' | 'google' | 'outlook'

function SourceKindTabs({ value, onChange }: { value: SourceKind; onChange: (kind: SourceKind) => void }) {
  const tab = (kind: SourceKind, title: string, subtitle: string) => (
    <button
      type="button"
      onClick={() => onChange(kind)}
      className={`flex-1 rounded-lg border px-3 py-2 text-left transition ${
        value === kind ? 'border-blue-500 bg-slate-800/60 ring-1 ring-blue-500' : 'border-slate-800 hover:border-slate-600'
      }`}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-xs text-slate-400">{subtitle}</span>
    </button>
  )
  return (
    <div className="flex gap-2">
      {tab('file', 'Exported file', 'Free Proton accounts')}
      {tab('link', 'Share link', 'Proton paid plans, any ICS URL')}
      {tab('google', 'Google Calendar', 'Secret iCal address')}
      {tab('outlook', 'Outlook', 'Published ICS link')}
    </div>
  )
}

/** Add or edit a calendar source: an exported .ics file or an ICS share link. */
export function CalendarSourceDialog({ calendar, onClose }: { calendar?: CalendarSource; onClose: () => void }) {
  const calendars = useAppStore((s) => s.calendars)
  const createCalendar = useAppStore((s) => s.createCalendar)
  const updateCalendar = useAppStore((s) => s.updateCalendar)
  const pickIcsFile = useAppStore((s) => s.pickIcsFile)

  const initialKind: SourceKind = !calendar
    ? 'file'
    : isFileSource(calendar.sourceUrl)
      ? 'file'
      : isGoogleCalendarUrl(calendar.sourceUrl)
        ? 'google'
        : isOutlookCalendarUrl(calendar.sourceUrl)
          ? 'outlook'
          : 'link'
  const [kind, setKind] = useState<SourceKind>(initialKind)
  const [name, setName] = useState(calendar?.name ?? '')
  const [color, setColor] = useState(calendar?.color ?? nextUnusedColor(calendars.map((c) => c.color)))
  const [linkUrl, setLinkUrl] = useState(calendar && initialKind !== 'file' ? calendar.sourceUrl : '')
  const [fileUrl, setFileUrl] = useState(calendar && initialKind === 'file' ? calendar.sourceUrl : '')
  const [enabled, setEnabled] = useState(calendar?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chooseFile = async (): Promise<void> => {
    const url = await pickIcsFile()
    if (!url) return
    setFileUrl(url)
    // Suggest a name from the file ("My calendar-2026-10-01.ics" -> "My calendar").
    if (!name.trim()) {
      setName(fileNameFromUrl(url).replace(/\.(ics|ical|icalendar|ifb)$/i, '').replace(/[-_ ]*\d{4}-\d{2}-\d{2}.*$/, ''))
    }
  }

  const isAccountCalendar = Boolean(calendar?.accountId)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Name is required')

    // Account calendars: the source is managed by the Proton exporter.
    if (calendar && isAccountCalendar) {
      setSaving(true)
      const ok = await updateCalendar(calendar.id, { name: name.trim(), color, enabled })
      setSaving(false)
      if (ok) onClose()
      return
    }

    const sourceUrl = kind === 'file' ? fileUrl : kind === 'outlook' ? outlookIcsUrl(linkUrl) : linkUrl.trim()
    if (kind === 'file' && !sourceUrl) return setError('Choose the .ics file you exported from Proton')
    if (kind === 'link' && !/^(https?|webcals?):\/\//i.test(sourceUrl)) {
      return setError('Paste the full share link, starting with https://')
    }
    if (kind === 'google' && !(isGoogleCalendarUrl(sourceUrl) && /\/ical\/.+\.ics/i.test(sourceUrl))) {
      return setError('Paste the “Secret address in iCal format” (https://calendar.google.com/calendar/ical/…/basic.ics)')
    }
    if (kind === 'outlook' && !(isOutlookCalendarUrl(sourceUrl) && /\/owa\/calendar\/.+\.ics(?=$|[?#])/i.test(sourceUrl))) {
      return setError('Paste the ICS link from Outlook’s “Publish a calendar” (https://outlook.…/owa/calendar/…/calendar.ics)')
    }

    setSaving(true)
    const input = { name: name.trim(), color, sourceUrl, enabled }
    const ok = calendar ? await updateCalendar(calendar.id, input) : await createCalendar(input)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title={calendar ? 'Edit calendar' : 'Add calendar'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="calendar-form" disabled={saving}>
            {saving ? 'Saving…' : calendar ? 'Save' : 'Add calendar'}
          </Button>
        </>
      }
    >
      <form id="calendar-form" onSubmit={onSubmit} className="space-y-4">
        {!isAccountCalendar && <SourceKindTabs value={kind} onChange={setKind} />}

        {isAccountCalendar ? (
          <p className="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
            This calendar is downloaded from a connected Proton account when you sync it
            {calendar?.protonCalendarName ? ` (“${calendar.protonCalendarName}” in Proton)` : ''}. You can change how it
            looks here.
          </p>
        ) : kind === 'file' ? (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 rounded-lg bg-slate-800/60 py-3 pr-3 pl-8 text-xs text-slate-300">
              <li>
                Open <span className="font-medium">calendar.proton.me</span> → <span className="font-medium">Settings</span> →{' '}
                <span className="font-medium">All settings</span> → <span className="font-medium">Import/export</span>.
              </li>
              <li>
                Under Export, pick the calendar and click <span className="font-medium">Download ICS</span>.
              </li>
              <li>Choose the downloaded file below.</li>
            </ol>
            <Field
              label="Exported .ics file"
              hint="To update later, export again and use “Update from file”, or save the new export over this file and click refresh."
            >
              <div className="flex items-center gap-2">
                <Button onClick={() => void chooseFile()}>{fileUrl ? 'Choose another file…' : 'Choose file…'}</Button>
                {fileUrl ? (
                  <span className="truncate text-sm text-slate-200" title={filePathFromUrl(fileUrl)}>
                    {fileNameFromUrl(fileUrl)}
                  </span>
                ) : (
                  <span className="text-sm text-slate-500">No file selected</span>
                )}
              </div>
            </Field>
          </div>
        ) : kind === 'google' ? (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 rounded-lg bg-slate-800/60 py-3 pr-3 pl-8 text-xs text-slate-300">
              <li>
                Open <span className="font-medium">calendar.google.com</span> in a browser (not the phone app).
              </li>
              <li>
                Click the gear → <span className="font-medium">Settings</span>, then pick the calendar on the left under{' '}
                <span className="font-medium">Settings for my calendars</span>.
              </li>
              <li>
                Under <span className="font-medium">Integrate calendar</span>, copy{' '}
                <span className="font-medium">Secret address in iCal format</span> and paste it below.
              </li>
            </ol>
            <Field
              label="Secret address in iCal format"
              hint="Read-only. Google can take a few hours to publish changes to this link, so very recent edits may show up late. Anyone with the link can read the calendar; it is stored only on this computer."
            >
              <TextInput
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
                spellCheck={false}
              />
            </Field>
          </div>
        ) : kind === 'outlook' ? (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 rounded-lg bg-slate-800/60 py-3 pr-3 pl-8 text-xs text-slate-300">
              <li>
                Open <span className="font-medium">outlook.live.com</span> (personal) or{' '}
                <span className="font-medium">outlook.office.com</span> (work or school) in a browser, or use the new Outlook
                for Windows.
              </li>
              <li>
                Click the gear → <span className="font-medium">Calendar</span> →{' '}
                <span className="font-medium">Shared calendars</span>.
              </li>
              <li>
                Under <span className="font-medium">Publish a calendar</span>, pick the calendar, choose{' '}
                <span className="font-medium">Can view all details</span> and click{' '}
                <span className="font-medium">Publish</span>.
              </li>
              <li>
                Click the <span className="font-medium">ICS</span> link → <span className="font-medium">Copy link</span>{' '}
                and paste it below.
              </li>
            </ol>
            <Field
              label="Published ICS link"
              hint="Read-only. Outlook can take a while to publish changes, so very recent edits may show up late. Anyone with the link can read the calendar; it is stored only on this computer. If “Publish a calendar” is missing on a work account, your organization has turned it off."
            >
              <TextInput
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://outlook.live.com/owa/calendar/…/calendar.ics"
                spellCheck={false}
              />
            </Field>
          </div>
        ) : (
          <Field
            label="ICS share URL"
            hint="Proton Calendar → Settings → All settings → Calendars → (calendar) → Share with anyone → Create link → Full view → Copy link. Requires a paid plan. Anyone with this link can read the calendar, so it is stored only on this computer."
          >
            <TextInput
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://calendar.proton.me/api/calendar/v1/url/…/calendar.ics?…"
              spellCheck={false}
            />
          </Field>
        )}

        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Personal" />
        </Field>
        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled (sync and show this calendar)
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Modal>
  )
}
