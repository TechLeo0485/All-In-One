import { useCallback, useEffect, useState } from 'react'
import type { CallerShares, CallerStatus, CallerSyncResult } from '@shared/types'
import { CloudUploadIcon } from '../components/icons'
import { Button, ColorDot, Field, inputClass, Spinner, TextInput, Toggle } from '../components/ui'
import { useAppStore } from '../stores/appStore'
import { errorMessage } from '../utils/errors'

/** "just now", "3 min ago", "2 h ago". */
function ago(iso: string | null): string {
  if (!iso) return 'not yet'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / 1440)} d ago`
}

const LIVE: Record<CallerStatus['live'], { label: string; tone: string }> = {
  connected: { label: '● Connected', tone: 'text-emerald-400' },
  connecting: { label: '○ Reconnecting…', tone: 'text-amber-300' },
  off: { label: '○ Not connected', tone: 'text-slate-500' }
}

/**
 * Teamwork, on the Connections page: sign in, pick the workspace, connect.
 * Then which calendars (and the local events) go to Teamwork, every event as
 * an interview, and the live connection's state.
 * Every time the connection opens, everything is checked against Teamwork and
 * whatever it doesn't hold in its latest copy is sent again.
 */
export function TeamworkConnection() {
  const [status, setStatus] = useState<CallerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void window.api.caller
      .status()
      .then(setStatus)
      .catch((err) => setError(errorMessage(err)))
  }, [])
  useEffect(() => {
    load()
    return window.api.caller.onChanged(load)
  }, [load])
  // "Checked 3 min ago" keeps its age current.
  useEffect(() => {
    const t = window.setInterval(load, 60_000)
    return () => window.clearInterval(t)
  }, [load])

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CloudUploadIcon size={16} /> Teamwork
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-400">
            Your Teamwork workspace. Every event of the calendars you send becomes an interview there, on your calendar in the
            team view. If you are a caller it is assigned to you; otherwise it waits unassigned for an owner to give it a caller.
          </p>
        </div>
        {status?.signedIn && !status.overview && (
          <span className={`text-xs ${LIVE[status.live].tone}`}>
            {LIVE[status.live].label}
            {status.lastCheckedAt && <span className="text-slate-500"> · checked {ago(status.lastCheckedAt)}</span>}
          </span>
        )}
      </header>
      <div className="p-4">
        {error && <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {status?.updateRequired && (
          <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <span className="font-semibold">Update required.</span> {status.updateRequired} Your waiting changes are kept and go once
            the app is updated (Settings → check for updates).
          </p>
        )}
        {status?.signedIn && !status.overview && !status.updateRequired && status.live !== 'connected' && (
          <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Teamwork can&apos;t be reached right now.
            {status.cachedAt && <> Showing what it had at {new Date(status.cachedAt).toLocaleString()}.</>} What you do here is saved
            and sent the moment it&apos;s back; your calendars catch up by themselves.
          </p>
        )}
        {status?.signedIn && status.queue.length > 0 && (
          <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="text-xs font-medium text-sky-200">
              ⏳ {status.queue.length} waiting to send
              <span className="font-normal text-slate-400">
                {' '}
                · sent in order when Teamwork is reachable, unless someone changed the same thing there meanwhile
              </span>
            </p>
            <ul className="mt-2 space-y-1">
              {status.queue.map((q) => (
                <li key={q.id} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{q.label}</span>
                  <span className="shrink-0 text-xs text-slate-500">{new Date(q.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void window.api.caller
                        .cancelQueued(q.id)
                        .then(setStatus)
                        .catch((err) => setError(errorMessage(err)))
                    }
                  >
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!status ? (
          <Spinner />
        ) : status.signedIn && status.overview ? (
          <OverviewConnected status={status} onStatus={setStatus} onError={setError} />
        ) : status.signedIn ? (
          <Connected status={status} onStatus={setStatus} onError={setError} />
        ) : (
          <SignIn status={status} onStatus={setStatus} onError={setError} />
        )}
      </div>
    </section>
  )
}

/**
 * Signed in with an overview account (e.g. the group's CEO): nothing of this
 * computer is shared; its groups show read-only in the sidebar under Groups, and
 * the Day view's Team switch dives into a group's day.
 */
function OverviewConnected({
  status,
  onStatus,
  onError
}: {
  status: CallerStatus
  onStatus: (s: CallerStatus) => void
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    try {
      onStatus(await window.api.caller.signOut())
      onError(null)
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <p>
        Signed in as <span className="font-medium text-slate-100">{status.userName}</span>{' '}
        <span className="text-slate-500">({status.email})</span> · overview account
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
        <li>
          Your groups show in the sidebar under <span className="text-slate-200">Groups</span>, one calendar each, in their color.
          Click an interview for its caller, bidder, round and what it&apos;s about.
        </li>
        <li>
          In the <span className="text-slate-200">Day</span> view, <span className="text-slate-200">Team</span> shows one group&apos;s
          day by caller or by bidder.
        </li>
        <li>Everything is read-only and stays current by itself. Nothing on this computer is shared.</li>
      </ul>
      <Button variant="ghost" onClick={() => void signOut()} disabled={busy}>
        {busy && <Spinner />} Sign out
      </Button>
    </div>
  )
}

function SignIn({
  status,
  onStatus,
  onError
}: {
  status: CallerStatus
  onStatus: (s: CallerStatus) => void
  onError: (message: string | null) => void
}) {
  const [serverUrl, setServerUrl] = useState(status.serverUrl)
  const [email, setEmail] = useState(status.email)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const insecure = /^http:\/\//i.test(serverUrl.trim())

  async function submit() {
    setBusy(true)
    onError(null)
    try {
      onStatus(await window.api.caller.signIn(serverUrl, email, password))
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-slate-300">Sign in with your Teamwork account, then pick the workspace to connect.</p>
      <Field label="Teamwork address" hint="The address you open Teamwork at, like https://teamwork.example.com">
        <TextInput value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://" autoComplete="url" />
      </Field>
      {insecure && (
        <p className="text-xs text-amber-300">
          This address is not secure (http): your password and calendars travel unencrypted. Use https when you can.
        </p>
      )}
      <Field label="Email">
        <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </Field>
      <Field label="Password">
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>
      <Button type="submit" variant="primary" disabled={busy || !serverUrl || !email || !password}>
        {busy && <Spinner />} Sign in
      </Button>
    </form>
  )
}

function Connected({
  status,
  onStatus,
  onError
}: {
  status: CallerStatus
  onStatus: (s: CallerStatus) => void
  onError: (message: string | null) => void
}) {
  const askConfirm = useAppStore((st) => st.askConfirm)
  const [shares, setShares] = useState<CallerShares | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [results, setResults] = useState<CallerSyncResult[]>([])

  const load = useCallback(async () => {
    try {
      setShares(await window.api.caller.listShares())
    } catch (err) {
      onError(errorMessage(err))
      onStatus(await window.api.caller.status())
    }
  }, [onError, onStatus])

  // Reload when the workspace changes, and after any calendar sync (its upload follows it).
  useEffect(() => {
    void load()
  }, [load, status.workspaceSlug])
  useEffect(
    () =>
      window.api.sync.onStatusChange((s) => {
        if (!s.running) window.setTimeout(() => void load(), 1500)
      }),
    [load]
  )

  async function act(localId: string, task: () => Promise<CallerShares>) {
    setBusyId(localId)
    onError(null)
    try {
      setShares(await task())
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function syncShared() {
    setSyncing(true)
    onError(null)
    setResults([])
    try {
      setResults(await window.api.caller.syncShared())
      await load()
      onStatus(await window.api.caller.status())
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSyncing(false)
    }
  }

  const sharedCount = (shares?.calendars.filter((c) => c.share).length ?? 0) + (shares?.local.send ? 1 : 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p>
            Signed in as <span className="font-medium">{status.userName || status.email}</span>
          </p>
          <p className="truncate text-xs text-slate-400">{status.serverUrl}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-400">
            <span className="mb-1 block">Workspace</span>
            {status.workspaces.length > 1 ? (
              <select
                className={`${inputClass} w-56`}
                value={status.workspaceSlug ?? ''}
                aria-label="Workspace"
                onChange={(e) => {
                  void window.api.caller
                    .selectWorkspace(e.target.value)
                    .then(onStatus)
                    .catch((err) => onError(errorMessage(err)))
                }}
              >
                {status.workspaces.map((w) => (
                  <option key={w.slug} value={w.slug}>
                    {w.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="block py-1.5 text-sm text-slate-200">{status.workspaces[0]?.name}</span>
            )}
          </label>
          <Button
            variant="ghost"
            onClick={() =>
              void (async () => {
                const waiting = status.queue.length
                if (
                  waiting > 0 &&
                  !(await askConfirm({
                    title: 'Disconnect from Teamwork?',
                    message: `${waiting} ${waiting === 1 ? 'change is' : 'changes are'} still waiting to be sent to Teamwork. Disconnecting drops ${waiting === 1 ? 'it' : 'them'}.`,
                    confirmLabel: 'Disconnect',
                    danger: true
                  }))
                ) {
                  return
                }
                onStatus(await window.api.caller.signOut())
              })()
            }
            title="Sign out of Teamwork here. Sharing choices are kept for when you connect again"
          >
            Disconnect
          </Button>
        </div>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Sent to Teamwork</h2>
            <p className="text-xs text-slate-400">
              Every event of the calendars switched on becomes an interview on Teamwork, yours to see. If you are a caller, it is
              assigned to you; otherwise it waits unassigned.
              {status.lastSyncAt ? ` Last sent ${new Date(status.lastSyncAt).toLocaleString()}.` : ''}
            </p>
          </div>
          <Button variant="primary" onClick={() => void syncShared()} disabled={syncing || sharedCount === 0}>
            {syncing ? <Spinner /> : <CloudUploadIcon />} Send now
          </Button>
        </div>

        {results.length > 0 && (
          <ul className="mb-3 space-y-1 rounded-xl border border-slate-800 p-4 text-sm">
            {results.map((r, i) => (
              <li key={`${r.name}-${i}`} className={r.ok ? 'text-slate-200' : 'text-red-300'}>
                <span className="font-medium">{r.name}</span>: {r.message}
              </li>
            ))}
          </ul>
        )}

        {!shares ? (
          <Spinner />
        ) : (
          <ul className="space-y-2">
            {shares.calendars.map((c) => (
              <ShareRow
                key={c.localCalendarId}
                name={c.name}
                color={c.color}
                source={c.source}
                send={c.send}
                blocked={c.blocked}
                sent={c.share ? { lastUploadAt: c.share.lastUploadAt, eventCount: c.share.eventCount, lastError: c.share.lastError } : null}
                busy={busyId === c.localCalendarId}
                onChange={(on) =>
                  void act(c.localCalendarId, () =>
                    on ? window.api.caller.share(c.localCalendarId) : window.api.caller.unshare(c.localCalendarId)
                  )
                }
              />
            ))}
            <ShareRow
              name="Local events"
              color="#10b981"
              source="Made in this app"
              send={shares.local.send}
              blocked={null}
              sent={shares.local.send && shares.local.eventCount !== null ? shares.local : null}
              busy={busyId === 'local'}
              onChange={(on) => void act('local', () => (on ? window.api.caller.share('local') : window.api.caller.unshare('local')))}
            />
          </ul>
        )}
      </section>
    </div>
  )
}

function ShareRow({
  name,
  color,
  source,
  send,
  blocked,
  sent,
  busy,
  onChange
}: {
  name: string
  color: string
  source: string
  send: boolean
  blocked: string | null
  sent: { lastUploadAt: string | null; eventCount: number | null; lastError: string | null } | null
  busy: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 p-3">
      <ColorDot color={color} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-xs text-slate-400">
          {source}
          {!send
            ? ' · not sent'
            : sent?.lastUploadAt
              ? ` · sent ${new Date(sent.lastUploadAt).toLocaleString()}${sent.eventCount !== null ? ` · ${sent.eventCount} events` : ''}`
              : ' · not sent yet'}
        </p>
        {send && sent?.lastError && <p className="text-xs text-red-300">{sent.lastError}</p>}
        {blocked && <p className="text-xs text-slate-500">{blocked}</p>}
      </div>
      {busy && <Spinner />}
      {!blocked && (
        <span className={busy ? 'pointer-events-none opacity-60' : ''}>
          <Toggle checked={send} onChange={onChange} label={`Send ${name} to Teamwork`} />
        </span>
      )}
    </li>
  )
}
