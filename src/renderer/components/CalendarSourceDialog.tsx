import { useState, type FormEvent } from 'react'
import type { CalendarSource } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { nextUnusedColor } from '@shared/colors'
import {
  isFileSource,
  isGoogleCalendarUrl,
  isOutlookCalendarUrl,
  isProtonCalendarUrl,
  outlookIcsUrl
} from '@shared/sources'
import { fileNameFromUrl, filePathFromUrl } from '../utils/sources'
import { ColorPicker } from './ColorPicker'
import { Button, Field, Modal, TextInput } from './ui'

type Provider = 'proton' | 'google' | 'outlook' | 'other'
/** How a calendar is connected: a Proton login, an ICS link or an exported .ics file. */
type Method = 'account' | 'link' | 'file'

const PROVIDERS: { id: Provider; title: string; subtitle: string }[] = [
  { id: 'proton', title: 'Proton', subtitle: 'Account login, link or file' },
  { id: 'google', title: 'Google Calendar', subtitle: 'Secret iCal address' },
  { id: 'outlook', title: 'Outlook', subtitle: 'Published ICS link' },
  { id: 'other', title: 'Other', subtitle: 'Any ICS link or file' }
]

const METHODS: Record<Provider, { id: Method; title: string; subtitle: string }[]> = {
  proton: [
    {
      id: 'account',
      title: 'Log in to account',
      subtitle: 'All calendars, free plans'
    },
    { id: 'link', title: 'Share link', subtitle: 'Paid plans' },
    { id: 'file', title: 'Exported file', subtitle: 'Download ICS yourself' }
  ],
  google: [{ id: 'link', title: '', subtitle: '' }],
  outlook: [{ id: 'link', title: '', subtitle: '' }],
  other: [
    { id: 'link', title: 'ICS link', subtitle: 'https:// or webcal://' },
    { id: 'file', title: '.ics file', subtitle: 'From this computer' }
  ]
}

function ChoiceTabs<T extends string>({
  options,
  value,
  onChange,
  small = false
}: {
  options: { id: T; title: string; subtitle: string }[]
  value: T
  onChange: (value: T) => void
  small?: boolean
}) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`flex-1 rounded-lg border text-left transition ${small ? 'px-2.5 py-1.5' : 'px-3 py-2'} ${
            value === o.id
              ? 'border-blue-500 bg-slate-800/60 ring-1 ring-blue-500'
              : 'border-slate-800 hover:border-slate-600'
          }`}
        >
          <span className={`block font-medium ${small ? 'text-xs' : 'text-sm'}`}>{o.title}</span>
          <span className="block text-xs text-slate-400">{o.subtitle}</span>
        </button>
      ))}
    </div>
  )
}

function initialChoice(calendar?: CalendarSource): [Provider, Method] {
  if (!calendar) return ['proton', 'account']
  const url = calendar.sourceUrl
  // Files can't tell where they came from; most are Proton exports.
  if (isFileSource(url)) return ['proton', 'file']
  if (isGoogleCalendarUrl(url)) return ['google', 'link']
  if (isOutlookCalendarUrl(url)) return ['outlook', 'link']
  return [isProtonCalendarUrl(url) ? 'proton' : 'other', 'link']
}

/**
 * Add or edit a calendar: connect a Proton account (login), or add an ICS link
 * (Proton, Google, Outlook, any) or an exported .ics file.
 */
export function CalendarSourceDialog({ calendar, onClose }: { calendar?: CalendarSource; onClose: () => void }) {
  const calendars = useAppStore((s) => s.calendars)
  const createCalendar = useAppStore((s) => s.createCalendar)
  const updateCalendar = useAppStore((s) => s.updateCalendar)
  const addProtonAccount = useAppStore((s) => s.addProtonAccount)
  const pickIcsFile = useAppStore((s) => s.pickIcsFile)

  const [initialProvider, initialMethod] = initialChoice(calendar)
  const [provider, setProvider] = useState<Provider>(initialProvider)
  const [method, setMethod] = useState<Method>(initialMethod)
  const [name, setName] = useState(calendar?.name ?? '')
  const [color, setColor] = useState(calendar?.color ?? nextUnusedColor(calendars.map((c) => c.color)))
  const [linkUrl, setLinkUrl] = useState(calendar && initialMethod === 'link' ? calendar.sourceUrl : '')
  const [fileUrl, setFileUrl] = useState(calendar && initialMethod === 'file' ? calendar.sourceUrl : '')
  const [accountLabel, setAccountLabel] = useState('')
  const [enabled, setEnabled] = useState(calendar?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // An existing link/file calendar can't be turned into an account login.
  const methods = METHODS[provider].filter((m) => !(calendar && m.id === 'account'))
  const chooseProvider = (next: Provider): void => {
    setProvider(next)
    setError(null)
    const available = METHODS[next].filter((m) => !(calendar && m.id === 'account'))
    if (!available.some((m) => m.id === method)) setMethod(available[0].id)
  }
  const chooseMethod = (next: Method): void => {
    setMethod(next)
    setError(null)
  }

  const chooseFile = async (): Promise<void> => {
    const url = await pickIcsFile()
    if (!url) return
    setFileUrl(url)
    // Suggest a name from the file ("My calendar-2026-10-01.ics" -> "My calendar").
    if (!name.trim()) {
      setName(
        fileNameFromUrl(url)
          .replace(/\.(ics|ical|icalendar|ifb)$/i, '')
          .replace(/[-_ ]*\d{4}-\d{2}-\d{2}.*$/, '')
      )
    }
  }

  const isAccountCalendar = Boolean(calendar?.accountId)
  const isLogin = !calendar && method === 'account'

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)

    if (!calendar && method === 'account') {
      if (!accountLabel.trim()) return setError('Account name is required')
      setSaving(true)
      const ok = await addProtonAccount(accountLabel.trim())
      setSaving(false)
      if (ok) onClose()
      return
    }
    if (!name.trim()) return setError('Name is required')

    // Account calendars: the source is managed by the Proton exporter.
    if (calendar && isAccountCalendar) {
      setSaving(true)
      const ok = await updateCalendar(calendar.id, {
        name: name.trim(),
        color,
        enabled
      })
      setSaving(false)
      if (ok) onClose()
      return
    }

    const sourceUrl = method === 'file' ? fileUrl : provider === 'outlook' ? outlookIcsUrl(linkUrl) : linkUrl.trim()
    if (method === 'file' && !sourceUrl) {
      return setError(provider === 'proton' ? 'Choose the .ics file you exported from Proton' : 'Choose an .ics file')
    }
    if (
      (provider === 'proton' || provider === 'other') &&
      method === 'link' &&
      !/^(https?|webcals?):\/\//i.test(sourceUrl)
    ) {
      return setError('Paste the full share link, starting with https://')
    }
    if (provider === 'google' && !(isGoogleCalendarUrl(sourceUrl) && /\/ical\/.+\.ics/i.test(sourceUrl))) {
      return setError(
        'Paste the “Secret address in iCal format” (https://calendar.google.com/calendar/ical/…/basic.ics)'
      )
    }
    if (
      provider === 'outlook' &&
      !(isOutlookCalendarUrl(sourceUrl) && /\/owa\/calendar\/.+\.ics(?=$|[?#])/i.test(sourceUrl))
    ) {
      return setError(
        'Paste the ICS link from Outlook’s “Publish a calendar” (https://outlook.…/owa/calendar/…/calendar.ics)'
      )
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
            {saving ? 'Saving…' : calendar ? 'Save' : isLogin ? 'Continue to Proton login' : 'Add calendar'}
          </Button>
        </>
      }
    >
      <form id="calendar-form" onSubmit={onSubmit} className="space-y-4">
        {!isAccountCalendar && (
          <div className="space-y-2">
            <ChoiceTabs options={PROVIDERS} value={provider} onChange={chooseProvider} />
            {methods.length > 1 && <ChoiceTabs options={methods} value={method} onChange={chooseMethod} small />}
          </div>
        )}

        {isAccountCalendar ? (
          <p className="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
            This calendar is downloaded from a connected Proton account when you sync it
            {calendar?.protonCalendarName ? ` (“${calendar.protonCalendarName}” in Proton)` : ''}. You can change how it
            looks here.
          </p>
        ) : isLogin ? (
          <div className="space-y-3">
            <Field label="Account name" hint="Only shown in this app, e.g. your email address or “Work”.">
              <TextInput
                autoFocus
                value={accountLabel}
                onChange={(e) => setAccountLabel(e.target.value)}
                placeholder="e.g. me@proton.me"
              />
            </Field>
            <div className="space-y-1.5 rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
              <p>
                A Proton login window opens next. Sign in as usual (including 2FA). It closes by itself when you're in.
                Then click <span className="font-medium">Sync now</span> on the account to download all of its
                calendars.
              </p>
              <p>
                Your password goes only to Proton. The app keeps the login session on this computer, separately for each
                account, and uses it only when you click Sync.
              </p>
            </div>
          </div>
        ) : method === 'file' ? (
          <div className="space-y-3">
            {provider === 'proton' && (
              <ol className="list-decimal space-y-1 rounded-lg bg-slate-800/60 py-3 pr-3 pl-8 text-xs text-slate-300">
                <li>
                  Open <span className="font-medium">calendar.proton.me</span> →{' '}
                  <span className="font-medium">Settings</span> → <span className="font-medium">All settings</span> →{' '}
                  <span className="font-medium">Import/export</span>.
                </li>
                <li>
                  Under Export, pick the calendar and click <span className="font-medium">Download ICS</span>.
                </li>
                <li>Choose the downloaded file below.</li>
              </ol>
            )}
            <Field
              label={provider === 'proton' ? 'Exported .ics file' : '.ics file'}
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
        ) : provider === 'google' ? (
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
        ) : provider === 'outlook' ? (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 rounded-lg bg-slate-800/60 py-3 pr-3 pl-8 text-xs text-slate-300">
              <li>
                Open <span className="font-medium">outlook.live.com</span> (personal) or{' '}
                <span className="font-medium">outlook.office.com</span> (work or school) in a browser, or use the new
                Outlook for Windows.
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
            hint={
              provider === 'proton'
                ? 'Proton Calendar → Settings → All settings → Calendars → (calendar) → Share with anyone → Create link → Full view → Copy link. Requires a paid plan. Anyone with this link can read the calendar, so it is stored only on this computer.'
                : 'Any calendar app’s ICS / iCal / webcal link. Anyone with the link can read the calendar, so it is stored only on this computer.'
            }
          >
            <TextInput
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder={
                provider === 'proton'
                  ? 'https://calendar.proton.me/api/calendar/v1/url/…/calendar.ics?…'
                  : 'https://example.com/calendar.ics'
              }
              spellCheck={false}
            />
          </Field>
        )}

        {!isLogin && (
          <>
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
          </>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Modal>
  )
}
