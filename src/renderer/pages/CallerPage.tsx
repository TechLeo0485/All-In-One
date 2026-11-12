import { useCallback, useEffect, useState } from 'react'
import type { CallerShareRow, CallerShares, CallerStatus, CallerSyncResult } from '@shared/types'
import { CloudUploadIcon } from '../components/icons'
import { Button, ColorDot, Field, inputClass, Spinner, TextInput } from '../components/ui'
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
 * Then which calendar goes to which profile (every other calendar counts as
 * busy time), single events shared one by one, and the live connection's state.
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
            Your Teamwork workspace. Calendars you share with a profile become its interviews; every other calendar counts as
            busy time only (no titles, guests or places), so whoever assigns knows when you&apos;re free.
          </p>
        </div>
        {status?.signedIn && (
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
        {status?.signedIn && !status.updateRequired && status.live !== 'connected' && (
          <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Teamwork can&apos;t be reached right now.
            {status.cachedAt && <> Showing what it had at {new Date(status.cachedAt).toLocaleString()}.</>} What you do here is saved
            and sent the moment it&apos;s back; your calendars and busy time catch up by themselves.
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
        ) : status.signedIn ? (
          <Connected status={status} onStatus={setStatus} onError={setError} />
        ) : (
          <SignIn status={status} onStatus={setStatus} onError={setError} />
        )}
      </div>
    </section>
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

  const sharedCount = (shares?.calendars.filter((c) => c.share).length ?? 0) + (shares?.picks.length ?? 0)

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
            <h2 className="text-sm font-semibold">Shared calendars</h2>
            <p className="text-xs text-slate-400">
              {status.lastSyncAt ? `Last sent ${new Date(status.lastSyncAt).toLocaleString()}. ` : ''}
              Shared calendars are also sent whenever they sync on their own.
            </p>
          </div>
          <Button variant="primary" onClick={() => void syncShared()} disabled={syncing || sharedCount === 0}>
            {syncing ? <Spinner /> : <CloudUploadIcon />} Sync shared calendars
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
        ) : shares.calendars.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 px-6 py-10 text-center text-sm text-slate-400">
            Add calendars under Manage calendars first, then share them here.
          </p>
        ) : (
          <>
            {shares.profiles.length === 0 && (
              <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                You don&apos;t work any profile in this workspace, so you can&apos;t share calendars yet. Ask an owner to assign you
                a profile.
              </p>
            )}
            <ul className="space-y-2">
              {shares.calendars.map((c) => (
                <ShareRow
                  key={c.localCalendarId}
                  row={c}
                  profiles={shares.profiles}
                  busy={busyId === c.localCalendarId}
                  onShare={(profileId) => void act(c.localCalendarId, () => window.api.caller.share(c.localCalendarId, profileId))}
                  onUnshare={() => void act(c.localCalendarId, () => window.api.caller.unshare(c.localCalendarId))}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {shares && shares.picks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">Shared one by one</h2>
          <p className="mb-3 text-xs text-slate-400">
            Single events shared without their calendar (share one from its details card). They&apos;re sent again whenever their
            calendar syncs.
          </p>
          <div className="space-y-3">
            {shares.picks.map((pick) => (
              <div key={pick.profileId} className="rounded-lg border border-slate-800 p-3">
                <p className="text-sm font-medium">
                  {pick.profileName}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {pick.lastUploadAt ? `sent ${new Date(pick.lastUploadAt).toLocaleString()}` : 'not sent yet'}
                  </span>
                </p>
                {pick.lastError && <p className="text-xs text-red-300">{pick.lastError}</p>}
                <ul className="mt-2 space-y-1">
                  {pick.events.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 text-sm">
                      <span className="w-40 shrink-0 text-xs text-slate-400 tabular-nums">
                        {e.startTime ? new Date(e.startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                      </span>
                      <span className={`min-w-0 flex-1 truncate ${e.missing ? 'text-slate-500 italic' : ''}`}>{e.title}</span>
                      <Button
                        disabled={busyId === e.id}
                        onClick={() =>
                          void act(e.id, async () => {
                            await window.api.caller.shareEvent(e.id, null)
                            return window.api.caller.listShares()
                          })
                        }
                      >
                        Stop sharing
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  )
}

function ShareRow({
  row,
  profiles,
  busy,
  onShare,
  onUnshare
}: {
  row: CallerShareRow
  profiles: CallerShares['profiles']
  busy: boolean
  onShare: (profileId: string) => void
  onUnshare: () => void
}) {
  const share = row.share
  // A profile shared before but no longer offered (e.g. an owner moved it) still shows.
  const options = share && !profiles.some((p) => p.id === share.profileId) ? [...profiles, { id: share.profileId, fullName: share.profileName }] : profiles
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 p-3">
      <ColorDot color={row.color} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{row.name}</p>
        <p className="truncate text-xs text-slate-400">
          {row.source}
          {share
            ? share.lastUploadAt
              ? ` · sent ${new Date(share.lastUploadAt).toLocaleString()}${share.eventCount !== null ? ` · ${share.eventCount} events` : ''}`
              : ' · not sent yet'
            : ' · busy time only'}
        </p>
        {share?.lastError && <p className="text-xs text-red-300">{share.lastError}</p>}
        {row.blocked && <p className="text-xs text-slate-500">{row.blocked}</p>}
      </div>
      {busy && <Spinner />}
      <select
        className={`${inputClass} w-56`}
        aria-label={`Profile for ${row.name}`}
        value={share?.profileId ?? ''}
        disabled={busy || Boolean(row.blocked) || (options.length === 0 && !share)}
        onChange={(e) => {
          if (e.target.value) onShare(e.target.value)
          else onUnshare()
        }}
      >
        <option value="">Busy time only</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            Share with {p.fullName}
          </option>
        ))}
      </select>
    </li>
  )
}
