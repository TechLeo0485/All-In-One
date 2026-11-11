import { useCallback, useEffect, useState } from 'react'
import type { ConnectionStatus, ConnectionsStatus } from '@shared/types'
import { LinkIcon } from '../components/icons'
import { Button, ColorDot, Field, Spinner, TextInput } from '../components/ui'
import { errorMessage } from '../utils/errors'
import { TeamworkConnection } from './CallerPage'

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
 * Connections: send some of this app's calendars to other platforms. Paste the
 * platform's connection address (and, if you like, an API key); the platform
 * then chooses which calendars it gets, and they are kept up to date there by
 * themselves - whenever they change here, and whenever the platform asks.
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
  // "Sent 3 min ago" keeps its age current.
  useEffect(() => {
    const t = window.setInterval(load, 60_000)
    return () => window.clearInterval(t)
  }, [load])

  const none = status !== null && status.connections.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <h1 className="text-xl font-semibold">Connections</h1>
            <p className="mt-1 text-sm text-slate-400">
              Where your calendars go. Each card connects on its own and keeps itself up to date: whenever a calendar changes
              here, and every time a connection is made again, what&apos;s there is checked and brought up to date.
            </p>
          </div>
        </div>

        <div className="mb-8">
          <TeamworkConnection />
        </div>

        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <LinkIcon size={16} /> Pool
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Other platforms that support calendar connections, free Proton accounts included. Paste the connection address
              the platform gives you; there, choose which calendars it gets. Links, Proton logins and files stay on this computer.
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
                    <p className="text-xs text-slate-400">To connect it again, add its connection address here.</p>
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
                  setError(null)
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
      <p className="text-sm text-slate-300">Paste the connection address the platform shows. One address works with one app.</p>
      <Field label="Connection address">
        <TextInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://" autoComplete="off" spellCheck={false} />
      </Field>
      {insecure && (
        <p className="text-xs text-amber-300">
          This address is not secure (http): your calendars travel unencrypted. Use https when you can.
        </p>
      )}
      <Field
        label="API key (optional)"
        hint="Leave it empty and the platform gives this app a key of its own. Kept encrypted on this computer."
      >
        <TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Name (optional)" hint="What to call this connection here. Without one, the platform's address is used.">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy || !address.trim()}>
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

const STATE: Record<ConnectionStatus['state'], { label: string; tone: string }> = {
  sending: { label: 'Sending…', tone: 'text-blue-300' },
  waiting: { label: 'Waiting for the network: sent as soon as it can be', tone: 'text-amber-300' },
  'up-to-date': { label: 'Up to date', tone: 'text-emerald-400' }
}

function ConnectionCard({ connection, clientName, onStatus, onError }: {
  connection: ConnectionStatus
  clientName: string
  onStatus: (s: ConnectionsStatus) => void
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const wanted = connection.groups.flatMap((g) => g.calendars).filter((c) => c.wantedFor)
  const state = STATE[connection.state]

  async function run(task: () => Promise<ConnectionsStatus>) {
    setBusy(true)
    onError(null)
    try {
      onStatus(await task())
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50">
      <header className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 text-sm">
          <p className="truncate font-semibold">{connection.name}</p>
          <p className="mt-0.5 text-xs">
            <span className={state.tone}>{state.label}</span>
            <span className="text-slate-500">
              {wanted.length > 0 && connection.lastSentAt && <> · last sent {ago(connection.lastSentAt)}</>}
              {' · '}
              {connection.host}
              {connection.account && <> as {connection.account}</>}
            </span>
          </p>
          {connection.lastError && connection.state !== 'up-to-date' && (
            <p className="mt-1 text-xs text-amber-300">{connection.lastError}</p>
          )}
        </div>
        <Button
          variant="ghost"
          onClick={() => void run(() => window.api.connections.disconnect(connection.id))}
          disabled={busy}
          title="Disconnect here and on the platform. The calendars it already has stay there, no longer updated"
        >
          Disconnect
        </Button>
      </header>

      <label className="flex cursor-pointer items-start gap-2.5 border-t border-slate-800 px-4 py-3">
        <input
          type="checkbox"
          checked={connection.listen}
          disabled={busy}
          onChange={(e) => void run(() => window.api.connections.setListen(connection.id, e.target.checked))}
          className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-600"
        />
        <span className="text-xs text-slate-400">
          <span className="font-medium text-slate-200">Stay in touch</span>
          <span className={`ml-2 ${connection.listening ? 'text-emerald-400' : 'text-slate-500'}`}>
            {!connection.listen ? 'Off' : connection.listening ? '● Connected' : '○ Reconnecting'}
          </span>
          <span className="block">
            Keeps one quiet connection open, so the platform can ask for a fresh copy (Proton is then synced and sent) and
            newly chosen calendars go at once. Off: calendars still go whenever they sync here, and choices made on the
            platform arrive the next time the app starts. Shown there as {clientName}.
          </span>
        </span>
      </label>

      {wanted.length === 0 && (
        <p className="border-t border-slate-800 px-4 py-3 text-sm text-slate-300">
          The platform hasn&apos;t chosen a calendar yet. Choose there which of the calendars below it should get; they arrive by themselves.
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
                        ? 'Not sent: the platform did not choose it'
                        : c.lastSentAt
                          ? `${c.eventCount ?? 0} events · sent ${ago(c.lastSentAt)}`
                          : 'On its way'}
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
