import { useCallback, useEffect, useState } from 'react'
import type { ConnectionStatus, ConnectionSyncResult, ConnectionsStatus } from '@shared/types'
import { Button, ColorDot, Field, Spinner, TextInput } from '../components/ui'
import { errorMessage } from '../utils/errors'

/** "3 min ago", "2 h ago", "5 d ago". */
function ago(iso: string | null): string {
  if (!iso) return 'never'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / 1440)} d ago`
}

/**
 * Connections: send some of this app's calendars to other platforms. A platform
 * gives you a connection address and an API key; this app tells it which
 * calendars it has, grouped by Proton account; on the platform you choose the
 * ones it should get; and every time one of those syncs here, it is sent.
 * Works with any platform that supports calendar connections.
 */
export function ConnectionsPage() {
  const [status, setStatus] = useState<ConnectionsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    void window.api.connections.status().then(setStatus).catch((err) => setError(errorMessage(err)))
  }, [])
  useEffect(() => {
    load()
    return window.api.connections.onChanged(load)
  }, [load])

  const none = status !== null && status.connections.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <h1 className="text-xl font-semibold">Connections</h1>
            <p className="mt-1 text-sm text-slate-400">
              Send calendars to other platforms, free Proton accounts included. A platform gives you a connection address
              and an API key. This app tells it which calendars it has; there, you choose the ones it should get. Those are
              sent every time they sync here. Links, Proton logins and files stay on this computer.
            </p>
          </div>
          {status && !none && !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add connection
            </Button>
          )}
        </div>
        {error && <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {!status ? (
          <Spinner />
        ) : (
          <div className="space-y-6">
            {status.ended.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    {status.ended.map((e) => (
                      <p key={`${e.name}-${e.at}`} className="text-amber-200">
                        <span className="font-medium">{e.name}</span> was disconnected: {e.reason}
                      </p>
                    ))}
                    <p className="text-xs text-slate-400">To connect it again, make it a connection on the platform and add it here.</p>
                  </div>
                  <Button variant="ghost" onClick={() => void window.api.connections.dismissEnded().then(setStatus)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
            {(adding || none) && (
              <Connect
                onDone={(s) => {
                  setStatus(s)
                  setAdding(false)
                }}
                onCancel={none ? undefined : () => setAdding(false)}
                onError={setError}
              />
            )}
            {status.connections.map((connection) => (
              <ConnectionCard key={connection.id} connection={connection} clientName={status.clientName} onStatus={setStatus} onError={setError} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Connect({ onDone, onCancel, onError }: {
  onDone: (s: ConnectionsStatus) => void
  onCancel?: () => void
  onError: (message: string | null) => void
}) {
  const [address, setAddress] = useState('')
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const insecure = /^http:\/\//i.test(address.trim())

  async function submit() {
    setBusy(true)
    onError(null)
    try {
      onDone(await window.api.connections.connect(address, key, name))
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
      <p className="text-sm text-slate-300">
        On the platform, make a calendar connection and an API key, then paste both here. One address works with one app.
      </p>
      <Field label="Connection address" hint="The address the platform shows for the connection.">
        <TextInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://" autoComplete="off" spellCheck={false} />
      </Field>
      {insecure && (
        <p className="text-xs text-amber-300">
          This address is not secure (http): the API key and your calendars travel unencrypted. Use https when you can.
        </p>
      )}
      <Field label="API key" hint="Kept encrypted on this computer.">
        <TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Name (optional)" hint="What to call this connection here. Without one, the platform's address is used.">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy || !address.trim() || !key.trim()}>
          {busy && <Spinner />} Connect
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function ConnectionCard({ connection, clientName, onStatus, onError }: {
  connection: ConnectionStatus
  clientName: string
  onStatus: (s: ConnectionsStatus) => void
  onError: (message: string | null) => void
}) {
  const [working, setWorking] = useState<'refresh' | 'sync' | null>(null)
  const [results, setResults] = useState<ConnectionSyncResult[]>([])
  const wanted = connection.groups.flatMap((g) => g.calendars).filter((c) => c.wantedFor)

  async function refresh() {
    setWorking('refresh')
    onError(null)
    try {
      onStatus(await window.api.connections.refresh(connection.id))
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setWorking(null)
    }
  }

  async function sync() {
    setWorking('sync')
    onError(null)
    setResults([])
    try {
      setResults(await window.api.connections.sync(connection.id))
      onStatus(await window.api.connections.status())
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setWorking(null)
    }
  }

  async function disconnect() {
    onError(null)
    onStatus(await window.api.connections.disconnect(connection.id))
  }

  async function setListen(on: boolean) {
    onError(null)
    try {
      onStatus(await window.api.connections.setListen(connection.id, on))
    } catch (err) {
      onError(errorMessage(err))
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50">
      <header className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 text-sm">
          <p className="truncate font-semibold">{connection.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {connection.host}
            {connection.account && <> · as {connection.account}</>} · shown there as {clientName} · asked {ago(connection.lastCheckedAt)}
          </p>
          {connection.lastError && <p className="mt-1 text-xs text-amber-300">{connection.lastError}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void refresh()} disabled={working !== null} title="Ask the platform again which calendars it wants">
            {working === 'refresh' && <Spinner />} Check what&apos;s wanted
          </Button>
          <Button variant="primary" onClick={() => void sync()} disabled={working !== null || wanted.length === 0} title="Sync the wanted calendars now and send them">
            {working === 'sync' && <Spinner />} Sync &amp; send
          </Button>
          <Button variant="ghost" onClick={() => void disconnect()} disabled={working !== null} title="Disconnect here and on the platform. The calendars it already has stay there, no longer updated">
            Disconnect
          </Button>
        </div>
      </header>

      <label className="flex cursor-pointer items-start gap-2.5 border-t border-slate-800 px-4 py-3">
        <input
          type="checkbox"
          checked={connection.listen}
          onChange={(e) => void setListen(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-600"
        />
        <span className="text-xs text-slate-400">
          <span className="font-medium text-slate-200">Let it ask for a sync</span>
          <span className={`ml-2 ${connection.listening ? 'text-emerald-400' : 'text-slate-500'}`}>
            {!connection.listen ? 'Off' : connection.listening ? '● Listening' : '○ Not connected right now'}
          </span>
          <span className="block">
            When someone on the platform wants a fresh copy, the calendars it gets are synced and sent, as if you had
            clicked Sync &amp; send. Keeps one idle connection open to the platform; off, nothing is open and you sync by hand.
          </span>
        </span>
      </label>

      {results.length > 0 && (
        <ul className="space-y-1 border-t border-slate-800 px-4 py-3 text-sm">
          {results.map((r) => (
            <li key={r.name} className={r.ok ? 'text-slate-300' : 'text-amber-300'}>
              <span className="font-medium">{r.name}</span>: {r.message}
            </li>
          ))}
        </ul>
      )}

      {wanted.length === 0 && (
        <p className="border-t border-slate-800 px-4 py-3 text-sm text-slate-300">
          The platform has not chosen a calendar yet. Choose there which of the calendars below it should get, then click{' '}
          <span className="font-medium">Check what&apos;s wanted</span>.
        </p>
      )}

      {connection.groups.map((group) => (
        <div key={group.id} className="border-t border-slate-800 px-4 py-3">
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.name}</h2>
          <ul className="space-y-1.5">
            {group.calendars.map((c) => (
              <li key={c.id} className="flex items-center gap-3">
                <ColorDot color={c.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className={`text-xs ${c.error ? 'text-amber-300' : 'text-slate-500'}`}>
                    {c.error
                      ? c.error
                      : !c.wantedFor
                        ? 'Not sent: the platform does not want it'
                        : c.lastSentAt
                          ? `${c.eventCount ?? 0} events · sent ${ago(c.lastSentAt)}`
                          : 'Wanted, not sent yet. Click Sync & send'}
                  </p>
                </div>
                {c.wantedFor && (
                  <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300" title="What the platform uses this calendar for">
                    {c.wantedFor}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
