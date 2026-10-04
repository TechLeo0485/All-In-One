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

const PROVIDERS: { id: Provider; title: string; subtitle: string; badge: string; badgeClass: string }[] = [
  { id: 'proton', title: 'Proton', subtitle: 'Login, link or file', badge: 'P', badgeClass: 'bg-violet-500/20 text-violet-300' },
  { id: 'google', title: 'Google', subtitle: 'Secret iCal address', badge: 'G', badgeClass: 'bg-blue-500/20 text-blue-300' },
  { id: 'outlook', title: 'Outlook', subtitle: 'Published ICS link', badge: 'O', badgeClass: 'bg-sky-500/20 text-sky-300' },
  { id: 'other', title: 'Other', subtitle: 'Any ICS link or file', badge: 'ICS', badgeClass: 'bg-slate-700 text-slate-300' }
]

const METHODS: Record<Provider, { id: Method; title: string; subtitle: string; recommended?: boolean }[]> = {
  proton: [
    {
      id: 'account',
      title: 'Log in to your Proton account',
      subtitle: 'Downloads all calendars of the account when you click Sync. Works on free plans.',
      recommended: true
    },
    { id: 'link', title: 'Share link', subtitle: 'A “Share with anyone” link of one calendar. Needs a paid plan.' },
    { id: 'file', title: 'Exported .ics file', subtitle: 'Export from Proton yourself and pick the file.' }
  ],
  google: [{ id: 'link', title: '', subtitle: '' }],
  outlook: [{ id: 'link', title: '', subtitle: '' }],
  other: [
    { id: 'link', title: 'ICS link', subtitle: 'An https:// or webcal:// address from any calendar app.' },
    { id: 'file', title: '.ics file', subtitle: 'A calendar file on this computer.' }
  ]
}

/** Numbered heading that separates the dialog's steps. */
function StepHeading({ step, title }: { step: number; title: string }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
      <span className="flex size-5 items-center justify-center rounded-full bg-slate-800 text-[11px] text-slate-300">
        {step}
      </span>
      {title}
    </h3>
  )
}

function ProviderPicker({ value, onChange }: { value: Provider; onChange: (provider: Provider) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Calendar service">
      {PROVIDERS.map((p) => {
        const selected = value === p.id
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(p.id)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition ${
              selected
                ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'
            }`}
          >
            <span className={`flex size-9 items-center justify-center rounded-lg text-sm font-bold ${p.badgeClass}`}>
              {p.badge}
            </span>
            <span className="text-sm font-medium">{p.title}</span>
            <span className="text-[11px] leading-tight text-slate-400">{p.subtitle}</span>
          </button>
        )
      })}
    </div>
  )
}

function MethodPicker({
  options,
  value,
  onChange
}: {
  options: (typeof METHODS)[Provider]
  value: Method
  onChange: (method: Method) => void
}) {
  return (
    <div className="divide-y divide-slate-800 rounded-xl border border-slate-800" role="radiogroup" aria-label="How to connect">
      {options.map((o) => {
        const selected = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.id)}
            className={`flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition first:rounded-t-xl last:rounded-b-xl ${
              selected ? 'bg-slate-800/70' : 'hover:bg-slate-800/40'
            }`}
          >
            <span
              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                selected ? 'border-blue-500' : 'border-slate-600'
              }`}
            >
              {selected && <span className="size-2 rounded-full bg-blue-500" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                {o.title}
                {o.recommended && (
                  <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-300">
                    Recommended
                  </span>
                )}
              </span>
              <span className="block text-xs text-slate-400">{o.subtitle}</span>
            </span>
          </button>
        )
      })}
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
      width={isAccountCalendar ? undefined : 'max-w-2xl'}
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
          <>
            <section>
              <StepHeading step={1} title="Calendar service" />
              <ProviderPicker value={provider} onChange={chooseProvider} />
            </section>
            {methods.length > 1 && (
              <section>
                <StepHeading step={2} title="How to connect" />
                <MethodPicker options={methods} value={method} onChange={chooseMethod} />
              </section>
            )}
            <hr className="border-slate-800" />
            <StepHeading step={methods.length > 1 ? 3 : 2} title={isLogin ? 'Account' : 'Details'} />
          </>
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
