import { useCallback, useEffect, useState } from 'react'
import type { CallerInterview, CallerShareRow, CallerShares, CallerStatus, CallerSyncResult } from '@shared/types'
import { CloudUploadIcon, ExternalIcon } from '../components/icons'
import { Button, ColorDot, Field, inputClass, Spinner, TextInput } from '../components/ui'
import { errorMessage } from '../utils/errors'

/**
 * Teamwork: share some of this app's calendars with a workspace profile. Only
 * shared calendars' events go to Teamwork, every time they sync; links, Proton
 * logins and files stay on this computer. Below, the workspace's interviews as
 * the member's role lets them see them.
 */
export function CallerPage() {
  const [status, setStatus] = useState<CallerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.caller.status().then(setStatus).catch((err) => setError(errorMessage(err)))
  }, [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Teamwork</h1>
          <p className="mt-1 text-sm text-slate-400">
            Share calendars with your workspace. Each shared calendar belongs to a profile: its events become that
            profile&apos;s interviews on Teamwork, updated every time the calendar syncs here. Calendars you don&apos;t share
            never leave this computer.
          </p>
        </div>
        {error && <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {!status ? (
          <Spinner />
        ) : status.signedIn ? (
          <Connected status={status} onStatus={setStatus} onError={setError} />
        ) : (
          <SignIn status={status} onStatus={setStatus} onError={setError} />
        )}
      </div>
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
      className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-slate-300">Sign in with your Teamwork account.</p>
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="min-w-0 text-sm">
          <p>
            Signed in as <span className="font-medium">{status.userName || status.email}</span>
          </p>
          <p className="truncate text-xs text-slate-400">{status.serverUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          {status.workspaces.length > 1 ? (
            <select
              className={inputClass}
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
            <span className="text-sm text-slate-300">{status.workspaces[0]?.name}</span>
          )}
          <Button onClick={() => void window.api.caller.signOut().then(onStatus)}>Sign out</Button>
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

      <Interviews workspaceSlug={status.workspaceSlug} />
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
            : ' · not shared'}
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
        <option value="">Not shared</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            Share with {p.fullName}
          </option>
        ))}
      </select>
    </li>
  )
}

/** The workspace's interviews from yesterday to two weeks ahead, as the member may see them. */
function Interviews({ workspaceSlug }: { workspaceSlug: string | null }) {
  const [items, setItems] = useState<CallerInterview[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    window.api.caller
      .interviews()
      .then(setItems)
      .catch((err) => setError(errorMessage(err)))
  }, [])
  useEffect(() => {
    setItems(null)
    load()
  }, [load, workspaceSlug])
  // Teamwork says interviews changed: the list follows, no refresh needed.
  useEffect(() => window.api.caller.onChanged(load), [load])

  const byDay = new Map<string, CallerInterview[]>()
  for (const i of items ?? []) {
    const day = new Date(i.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    byDay.set(day, [...(byDay.get(day) ?? []), i])
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Workspace interviews</h2>
          <p className="text-xs text-slate-400">
            Yesterday to two weeks ahead, as your role in the workspace lets you see them. Updates by itself when something changes.
          </p>
        </div>
        <Button onClick={load}>Refresh</Button>
      </div>
      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : !items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 px-6 py-8 text-center text-sm text-slate-400">No interviews in this period.</p>
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{day}</h3>
              <ul className="space-y-1.5">
                {list.map((i) => (
                  <li key={i.id} className={`flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 p-3 text-sm ${i.cancelled ? 'opacity-60' : ''}`}>
                    <span className="w-28 shrink-0 text-xs text-slate-400 tabular-nums">
                      {new Date(i.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                      {new Date(i.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-medium ${i.cancelled ? 'line-through' : ''}`}>
                        {i.company && i.role ? `${i.company} – ${i.role}` : i.title}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {[i.profile, i.round, i.caller ? `Caller: ${i.caller}` : 'No caller yet'].filter(Boolean).join(' · ')}
                        {!i.company && !i.cancelled ? ' · needs company and role' : ''}
                      </p>
                    </div>
                    {i.meetingUrl && (
                      <a href={i.meetingUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                        Join
                      </a>
                    )}
                    <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
                      <ExternalIcon size={12} /> Open
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
