import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { APP_NAME, APP_TAGLINE } from '@shared/brand'
import type { AllDayReminder, AppInfo, UpdateStatus } from '@shared/types'
import { AUTO_SYNC_OPTIONS } from '@shared/sources'
import type { EventStatusDef } from '@shared/types'
import { FOLLOW_UP_ID, MAX_STATUS_LABEL, MAX_STATUSES, newStatusId } from '@shared/eventStatus'
import { nextUnusedColor } from '@shared/colors'
import { DEFAULT_SHORTCUT, shortcutFromKeyEvent, shortcutKeys } from '@shared/shortcut'
import { DEFAULT_HOUR_HEIGHT, HOUR_HEIGHT_STEP, MAX_HOUR_HEIGHT, MIN_HOUR_HEIGHT } from '@shared/hourHeight'
import { MAX_TIME_ZONE_LABEL, systemTimeZone, tzOffsetMs, zoneFormatter } from '@shared/timezone'
import { useAppStore } from '../stores/appStore'
import { AppLogo } from '../components/AppLogo'
import { ColorPicker } from '../components/ColorPicker'
import { BellIcon, PlusIcon, RefreshIcon } from '../components/icons'
import { Button, ColorDot, Toggle, inputClass } from '../components/ui'
import { useNow } from '../hooks/useNow'
import { useUpdateStatus } from '../hooks/useUpdateStatus'
import { formatReminder, REMINDER_MINUTES } from '../utils/dates'
import { errorMessage } from '../utils/errors'

const REMINDER_OPTIONS = [
  { label: 'No reminder', value: -1 },
  ...REMINDER_MINUTES.map((m) => ({ label: formatReminder(m), value: m }))
]

const AUTO_SYNC_LABELS: Record<(typeof AUTO_SYNC_OPTIONS)[number], string> = {
  0: 'Off',
  15: 'Every 15 minutes',
  30: 'Every 30 minutes',
  60: 'Every hour',
  180: 'Every 3 hours'
}

const ALL_DAY_OPTIONS: { label: string; value: AllDayReminder }[] = [
  { label: 'No reminder', value: 'off' },
  { label: 'On the day at 9:00', value: 'same-day' },
  { label: 'The evening before at 18:00', value: 'day-before' }
]

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 px-5 shadow-sm first:mt-0">
      <h2 className="pt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      <div className="divide-y divide-slate-800">{children}</div>
    </section>
  )
}

/** System-wide show/hide shortcut: shows the current keys, records a new combination. */
function ShortcutRow() {
  const shortcut = useAppStore((s) => s.settings?.globalShortcut ?? '')
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    // Otherwise pressing the current shortcut would hide the window instead of being recorded.
    void window.api.app.suspendShortcut(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return setRecording(false)
      const result = shortcutFromKeyEvent(e)
      if ('pending' in result) return // only modifiers so far
      if ('error' in result) return setHint(result.error)
      setRecording(false)
      void updateSettings({ globalShortcut: result.accelerator })
    }
    const stop = (): void => setRecording(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', stop)
      void window.api.app.suspendShortcut(false)
    }
  }, [recording, updateSettings])

  const start = (): void => {
    setHint(null)
    setRecording(true)
  }

  return (
    <Row
      title="Show / hide shortcut"
      description={
        recording
          ? (hint ?? 'Press the new key combination, or Esc to cancel.')
          : 'Works anywhere in Windows: brings the app to the front, or hides it to the tray when it is already in front.'
      }
    >
      <div className="flex items-center gap-2">
        {recording ? (
          <span className="rounded-md border border-blue-500 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300">Press keys…</span>
        ) : shortcut ? (
          <span className="flex items-center gap-1">
            {shortcutKeys(shortcut).map((k) => (
              <kbd key={k} className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-sans text-xs text-slate-200">
                {k}
              </kbd>
            ))}
          </span>
        ) : (
          <span className="text-xs text-slate-500">Off</span>
        )}
        {recording ? (
          <Button onClick={() => setRecording(false)}>Cancel</Button>
        ) : (
          <>
            <Button onClick={start}>{shortcut ? 'Change' : 'Set'}</Button>
            {shortcut ? (
              <Button variant="ghost" onClick={() => void updateSettings({ globalShortcut: '' })}>
                Turn off
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void updateSettings({ globalShortcut: DEFAULT_SHORTCUT })}>
                Use default
              </Button>
            )}
          </>
        )}
      </div>
    </Row>
  )
}

/** Per-calendar notification switches, grouped by Proton account. */
function CalendarNotifyList({ disabled }: { disabled: boolean }) {
  const calendars = useAppStore((s) => s.calendars)
  const accounts = useAppStore((s) => s.protonAccounts)
  const updateCalendar = useAppStore((s) => s.updateCalendar)

  const groups = useMemo(() => {
    const enabled = calendars.filter((c) => c.enabled)
    const result = accounts
      .map((a) => ({ title: a.label, items: enabled.filter((c) => c.accountId === a.id) }))
      .filter((g) => g.items.length > 0)
    const other = enabled.filter((c) => !c.accountId || !accounts.some((a) => a.id === c.accountId))
    if (other.length) result.push({ title: result.length ? 'Other calendars' : '', items: other })
    return result
  }, [calendars, accounts])

  if (groups.length === 0) {
    return <p className="py-4 text-xs text-slate-500">No calendars yet.</p>
  }
  return (
    <div className={`py-3 ${disabled ? 'opacity-50' : ''}`}>
      <p className="mb-2 text-sm font-medium">Notify for these calendars</p>
      {groups.map((g) => (
        <div key={g.title || 'other'} className="mb-2">
          {g.title && <p className="mt-2 mb-1 text-[11px] font-medium text-slate-400">{g.title}</p>}
          <ul className="space-y-1">
            {g.items.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-slate-800/60">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <ColorDot color={c.color} />
                  <span className="truncate">{c.name}</span>
                </span>
                <Toggle
                  checked={c.notify}
                  label={c.notify ? `Turn off notifications for ${c.name}` : `Turn on notifications for ${c.name}`}
                  onChange={(notify) => void updateCalendar(c.id, { notify })}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function updateText(status: UpdateStatus): string {
  switch (status.state) {
    case 'unsupported':
      return 'Automatic updates work in the installed app (not in development).'
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return status.skipped
        ? `Version ${status.version} is available (skipped).`
        : `Version ${status.version} is available.`
    case 'downloading':
      return `Downloading version ${status.version}… ${status.percent ?? 0}%. The app restarts when it’s done.`
    case 'ready':
      return `Installing version ${status.version}…`
    case 'up-to-date':
      return 'You have the latest version.'
    case 'error':
      return `Could not check for updates: ${status.error}`
    default:
      return 'The app checks for updates when it starts and every few hours, and asks before downloading.'
  }
}

function UpdateRow() {
  const status = useUpdateStatus()
  if (!status) return null
  const busy = status.state === 'checking' || status.state === 'downloading'

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {status.state === 'ready' ? (
        <Button variant="primary" onClick={() => void window.api.updates.install()}>
          Restart now
        </Button>
      ) : status.state === 'available' ? (
        <Button variant="primary" onClick={() => void window.api.updates.download()}>
          Download and install
        </Button>
      ) : (
        status.state !== 'unsupported' && (
          <Button onClick={() => void window.api.updates.check()} disabled={busy}>
            <RefreshIcon size={14} /> Check for updates
          </Button>
        )
      )}
      <span className={`text-xs ${status.state === 'error' ? 'text-amber-300' : 'text-slate-400'}`}>{updateText(status)}</span>
    </div>
  )
}

function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    window.api.app.info().then(setInfo, () => undefined)
  }, [])

  return (
    <section className="mt-6 flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
      <AppLogo size={48} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">
          {APP_NAME} <span className="font-normal text-slate-400">{info ? `version ${info.version}` : ''}</span>
        </p>
        <p className="text-slate-400">{APP_TAGLINE}</p>
        <UpdateRow />
        <p className="mt-3 text-xs text-slate-500">
          Everything (accounts, cached events, local events and notes) stays on this computer
          {info && (
            <>
              {' '}
              in <span className="selectable font-mono break-all">{info.dataFolder}</span>
            </>
          )}
          . Nothing is ever written back to Proton.
        </p>
      </div>
    </section>
  )
}

/** One status: editable name (saved on Enter / leaving the field), color, order, delete. */
function StatusRow({
  status,
  onChange,
  onMove,
  onDelete
}: {
  status: EventStatusDef
  onChange: (patch: Partial<EventStatusDef>) => void
  onMove: (delta: -1 | 1) => void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(status.label)
  useEffect(() => setLabel(status.label), [status.label])
  const commit = (): void => {
    const trimmed = label.trim()
    if (trimmed && trimmed !== status.label) onChange({ label: trimmed })
    else setLabel(status.label)
  }
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="w-44 shrink-0">
        <input
          className={inputClass}
          value={label}
          maxLength={MAX_STATUS_LABEL}
          aria-label="Status name"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setLabel(status.label)
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <ColorPicker value={status.color} onChange={(color) => onChange({ color })} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" className="px-1.5!" title="Move up" onClick={() => onMove(-1)}>
          ↑
        </Button>
        <Button variant="ghost" className="px-1.5!" title="Move down" onClick={() => onMove(1)}>
          ↓
        </Button>
        {status.id === FOLLOW_UP_ID ? (
          <span className="w-[3.75rem] text-center text-xs text-slate-500" title="Built in: events marked Follow-Up can get a reminder">
            Fixed
          </span>
        ) : (
          <Button variant="ghost" className="text-red-400!" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </li>
  )
}

/** Settings → Event status: add, rename, recolor, reorder and delete statuses. */
function StatusEditor() {
  const statuses = useAppStore((s) => s.settings?.eventStatuses ?? [])
  const updateSettings = useAppStore((s) => s.updateSettings)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const save = (next: EventStatusDef[]): void => void updateSettings({ eventStatuses: next })

  const move = (id: string, delta: -1 | 1): void => {
    const list = [...statuses]
    const from = list.findIndex((s) => s.id === id)
    const to = from + delta
    if (to < 0 || to >= list.length) return
    ;[list[from], list[to]] = [list[to], list[from]]
    save(list)
  }

  return (
    <>
      <p className="pt-2 text-sm text-slate-400">
        Pick a status in an event's details; the event is then outlined in the status color. Events without a status
        have no outline. Follow-Up is built in: events marked Follow-Up can get a reminder notification.
      </p>
      <ul className="divide-y divide-slate-800">
        {statuses.map((status) => (
          <StatusRow
            key={status.id}
            status={status}
            onChange={(patch) => save(statuses.map((s) => (s.id === status.id ? { ...s, ...patch } : s)))}
            onMove={(delta) => move(status.id, delta)}
            onDelete={() => {
              void askConfirm({
                title: 'Delete status?',
                message: `Events marked “${status.label}” will no longer have a status.`,
                confirmLabel: 'Delete status',
                danger: true
              }).then((ok) => {
                if (ok) save(statuses.filter((s) => s.id !== status.id))
              })
            }}
          />
        ))}
      </ul>
      <div className="pb-4">
        <Button
          disabled={statuses.length >= MAX_STATUSES}
          onClick={() =>
            save([
              ...statuses,
              { id: newStatusId(), label: 'New status', color: nextUnusedColor(statuses.map((s) => s.color)) }
            ])
          }
        >
          <PlusIcon /> Add status
        </Button>
      </div>
    </>
  )
}

/** Zone choices for the dropdowns, built once on first use (a few hundred zones). */
let zoneOptionCache: Map<string, ZoneOption> | null = null
type ZoneOption = { value: string; label: string; offset: number }

function zoneOption(zone: string, now: Date): ZoneOption | null {
  const fmt = zoneFormatter(zone)
  if (!fmt) return null
  const offset = Math.round(tzOffsetMs(now.getTime(), fmt) / 60_000)
  const abs = Math.abs(offset)
  const gmt = `GMT${offset < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
  const city = zone.split('/').pop()!.replace(/_/g, ' ')
  const name = new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: 'longGeneric' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value
  // Zones without a proper name come back as "GMT+03:00"; then the city is enough.
  const label = name && !name.startsWith('GMT') ? `(${gmt}) ${name} - ${city}` : `(${gmt}) ${city}`
  return { value: zone, label, offset }
}

/** Google Calendar style: sorted by the current UTC offset, then by name. `extra` adds zones the list lacks (old aliases). */
function timeZoneOptions(extra: string[]): ZoneOption[] {
  const now = new Date()
  if (!zoneOptionCache) {
    zoneOptionCache = new Map()
    for (const zone of ['UTC', ...Intl.supportedValuesOf('timeZone')]) {
      const option = zoneOption(zone, now)
      if (option) zoneOptionCache.set(zone, option)
    }
  }
  const options = new Map(zoneOptionCache)
  for (const zone of extra) {
    const option = zone && !options.has(zone) ? zoneOption(zone, now) : null
    if (option) options.set(zone, option)
  }
  return [...options.values()].sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label))
}

/** Short name for a time column ("Home"); saved on Enter / leaving the field. */
function ZoneLabelInput({ value, onSave, ariaLabel }: { value: string; onSave: (label: string) => void; ariaLabel: string }) {
  const [label, setLabel] = useState(value)
  useEffect(() => setLabel(value), [value])
  const commit = (): void => {
    const trimmed = label.trim()
    if (trimmed !== value) onSave(trimmed)
    setLabel(trimmed)
  }
  return (
    <input
      className={`${inputClass} w-28!`}
      value={label}
      maxLength={MAX_TIME_ZONE_LABEL}
      placeholder="Label"
      aria-label={ariaLabel}
      onChange={(e) => setLabel(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setLabel(value)
      }}
    />
  )
}

/** Week/Day hour height; saved shortly after the slider stops moving. */
function HourHeightRow() {
  const saved = useAppStore((s) => s.settings!.hourHeight)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [value, setValue] = useState(saved)
  useEffect(() => setValue(saved), [saved])
  useEffect(() => {
    if (value === saved) return
    const timer = setTimeout(() => void updateSettings({ hourHeight: value }), 300)
    return () => clearTimeout(timer)
  }, [value, saved, updateSettings])

  return (
    <Row
      title="Hour height"
      description="How tall one hour is in Week and Day views. You can also hold Ctrl and scroll over the calendar."
    >
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={MIN_HOUR_HEIGHT}
          max={MAX_HOUR_HEIGHT}
          step={HOUR_HEIGHT_STEP}
          value={value}
          aria-label="Hour height"
          className="w-40 accent-blue-500"
          onChange={(e) => setValue(Number(e.target.value))}
        />
        <span className="w-12 text-right text-sm text-slate-300 tabular-nums">{value}px</span>
        <Button variant="ghost" disabled={value === DEFAULT_HOUR_HEIGHT} onClick={() => setValue(DEFAULT_HOUR_HEIGHT)}>
          Reset
        </Button>
      </div>
    </Row>
  )
}

/** Primary zone (whole calendar) and an optional secondary zone (extra time column in Week/Day). */
function TimeZoneSection() {
  const settings = useAppStore((s) => s.settings)!
  const updateSettings = useAppStore((s) => s.updateSettings)
  const system = systemTimeZone()
  const { primaryTimeZone, secondaryTimeZone, showSecondaryTimeZone } = settings
  const options = useMemo(
    () => timeZoneOptions([system, primaryTimeZone, secondaryTimeZone]),
    [system, primaryTimeZone, secondaryTimeZone]
  )
  const zoneSelect = (value: string, onChange: (zone: string) => void, first: ReactNode, ariaLabel: string) => (
    <select className={`${inputClass} w-72!`} value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
      {first}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
  const swap = (): void =>
    void updateSettings({
      primaryTimeZone: secondaryTimeZone,
      secondaryTimeZone: primaryTimeZone || system,
      primaryTimeZoneLabel: settings.secondaryTimeZoneLabel,
      secondaryTimeZoneLabel: settings.primaryTimeZoneLabel
    })

  return (
    <Section title="Time zone">
      <Row
        title="Primary time zone"
        description="The calendar, event times and the event editor use this zone. Reminders still come at the right moment."
      >
        <div className="flex items-center gap-2">
          <ZoneLabelInput
            value={settings.primaryTimeZoneLabel}
            ariaLabel="Primary time zone label"
            onSave={(primaryTimeZoneLabel) => void updateSettings({ primaryTimeZoneLabel })}
          />
          {zoneSelect(
            primaryTimeZone,
            (primaryTimeZone) => void updateSettings({ primaryTimeZone }),
            <option value="">Computer’s time zone ({system.split('/').pop()!.replace(/_/g, ' ')})</option>,
            'Primary time zone'
          )}
        </div>
      </Row>
      <Row title="Display secondary time zone" description="Adds a second column of times in Week and Day views.">
        <Toggle
          checked={showSecondaryTimeZone}
          label="Display secondary time zone"
          onChange={(show) => void updateSettings({ showSecondaryTimeZone: show })}
        />
      </Row>
      {showSecondaryTimeZone && (
        <Row title="Secondary time zone">
          <div className="flex items-center gap-2">
            <ZoneLabelInput
              value={settings.secondaryTimeZoneLabel}
              ariaLabel="Secondary time zone label"
              onSave={(secondaryTimeZoneLabel) => void updateSettings({ secondaryTimeZoneLabel })}
            />
            {zoneSelect(
              secondaryTimeZone,
              (zone) => void updateSettings({ secondaryTimeZone: zone }),
              <option value="" disabled>
                Choose a time zone
              </option>,
              'Secondary time zone'
            )}
          </div>
        </Row>
      )}
      {showSecondaryTimeZone && secondaryTimeZone && (
        <div className="flex justify-end py-3">
          <Button onClick={swap}>Swap time zones</Button>
        </div>
      )}
    </Section>
  )
}

export function SettingsPage() {
  useNow() // keeps the "paused until" state current
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const notify = useAppStore((s) => s.notify)
  if (!settings) return null

  const pausedUntil = settings.notificationsPausedUntil ? new Date(settings.notificationsPausedUntil) : null
  const paused = pausedUntil !== null && pausedUntil.getTime() > Date.now()
  const off = !settings.notificationsEnabled

  const sendTest = async (): Promise<void> => {
    try {
      await window.api.notifications.test()
      notify('Test notification sent. If you don’t see it, check Windows Settings → System → Notifications.')
    } catch (err) {
      notify(errorMessage(err), 'error')
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold">Settings</h1>

        <Section title="Notifications">
          <Row title="Desktop notifications" description="Windows notifications before your events, also while the app is in the tray.">
            <Toggle
              checked={settings.notificationsEnabled}
              label="Desktop notifications"
              onChange={(notificationsEnabled) => void updateSettings({ notificationsEnabled })}
            />
          </Row>

          {paused && (
            <div className="flex items-center justify-between gap-4 py-3">
              <p className="flex items-center gap-2 text-sm text-amber-300">
                <BellIcon className="shrink-0" /> Paused until{' '}
                {pausedUntil!.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              </p>
              <Button onClick={() => void updateSettings({ notificationsPausedUntil: '' })}>Resume now</Button>
            </div>
          )}

          <div className={off ? 'pointer-events-none opacity-50' : ''}>
            <Row
              title="Reminder for calendar events"
              description="For Proton and other calendar events. Your own local events use the reminder set on each event."
            >
              <select
                className={inputClass}
                value={settings.defaultReminderMinutes}
                onChange={(e) => void updateSettings({ defaultReminderMinutes: Number(e.target.value) })}
              >
                {REMINDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row title="All-day events">
              <select
                className={inputClass}
                value={settings.allDayReminder}
                onChange={(e) => void updateSettings({ allDayReminder: e.target.value as AllDayReminder })}
              >
                {ALL_DAY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row title="Play sound">
              <Toggle
                checked={settings.notificationSound}
                label="Play sound"
                onChange={(notificationSound) => void updateSettings({ notificationSound })}
              />
            </Row>
            <CalendarNotifyList disabled={off} />
          </div>

          <div className="flex items-center justify-between gap-4 py-4">
            <p className="text-xs text-slate-400">
              Pause temporarily from the tray icon menu. Windows Focus / Do not disturb can also hide notifications.
            </p>
            <Button onClick={() => void sendTest()}>
              <BellIcon /> Send test notification
            </Button>
          </div>
        </Section>

        <Section title="App">
          <Row
            title="Keep running in the tray when closed"
            description="Closing the window hides it to the system tray so reminders keep working. Quit from the tray icon."
          >
            <Toggle
              checked={settings.closeToTray}
              label="Keep running in the tray when closed"
              onChange={(closeToTray) => void updateSettings({ closeToTray })}
            />
          </Row>
          <ShortcutRow />
          <Row title="Start with Windows" description="Starts hidden in the tray when you sign in to Windows. Proton calendars are not downloaded.">
            <Toggle
              checked={settings.launchAtStartup}
              label="Start with Windows"
              onChange={(launchAtStartup) => void updateSettings({ launchAtStartup })}
            />
          </Row>
        </Section>

        <Section title="Calendar">
          <HourHeightRow />
        </Section>

        <TimeZoneSection />

        <Section title="Sync">
          <Row
            title="Auto-sync link calendars"
            description="Google, Outlook and other web links (not Proton). Also runs shortly after the app starts."
          >
            <select
              className={inputClass}
              value={settings.autoSyncMinutes}
              onChange={(e) => void updateSettings({ autoSyncMinutes: Number(e.target.value) })}
            >
              {AUTO_SYNC_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {AUTO_SYNC_LABELS[m]}
                </option>
              ))}
            </select>
          </Row>
          <p className="flex items-start gap-2 py-4 text-sm text-slate-300">
            <RefreshIcon className="mt-0.5 shrink-0 text-slate-500" />
            <span>
              Proton calendars are updated <span className="font-medium">only when you click refresh</span> (the button
              next to “Calendars” in the sidebar, “Sync now” on an account, or “Refresh calendars” in the tray menu).
            </span>
          </p>
        </Section>

        <Section title="Local events">
          <Row title="Show local events">
            <Toggle
              checked={settings.showLocalEvents}
              label="Show local events"
              onChange={(showLocalEvents) => void updateSettings({ showLocalEvents })}
            />
          </Row>
          <Row title="Default color" description="Used by every local event set to “Default” (existing ones change too) and the sidebar entry.">
            <ColorPicker value={settings.localEventColor} onChange={(localEventColor) => void updateSettings({ localEventColor })} />
          </Row>
        </Section>

        <Section title="Event status">
          <StatusEditor />
        </Section>

        <AboutSection />
      </div>
    </div>
  )
}
