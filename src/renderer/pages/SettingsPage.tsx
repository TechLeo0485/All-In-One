import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { APP_NAME, APP_TAGLINE } from '@shared/brand'
import type { AllDayReminder, AppInfo, UpdateStatus } from '@shared/types'
import { AUTO_SYNC_OPTIONS } from '@shared/sources'
import { useAppStore } from '../stores/appStore'
import { AppLogo } from '../components/AppLogo'
import { ColorPicker } from '../components/ColorPicker'
import { BellIcon, RefreshIcon } from '../components/icons'
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
    case 'downloading':
      return `Downloading version ${status.version}… ${status.percent ?? 0}%`
    case 'ready':
      return `Version ${status.version} is ready. Restart to install it.`
    case 'up-to-date':
      return 'You have the latest version.'
    case 'error':
      return `Could not check for updates: ${status.error}`
    default:
      return 'Updates are checked automatically when the app starts and every few hours.'
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
          <Row title="Start with Windows" description="Starts hidden in the tray when you sign in to Windows. Proton calendars are not downloaded.">
            <Toggle
              checked={settings.launchAtStartup}
              label="Start with Windows"
              onChange={(launchAtStartup) => void updateSettings({ launchAtStartup })}
            />
          </Row>
        </Section>

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

        <AboutSection />
      </div>
    </div>
  )
}
