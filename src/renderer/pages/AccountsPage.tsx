import { useMemo, useState, type FormEvent } from 'react'
import type { ProtonAccount } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { formatRelative } from '../utils/dates'
import { useNow } from '../hooks/useNow'
import { AlertIcon, ExternalIcon, PlusIcon, RefreshIcon } from '../components/icons'
import { Button, ColorDot, Field, Modal, Spinner, TextInput } from '../components/ui'

function StatusBadge({ account }: { account: ProtonAccount }) {
  const styles: Record<ProtonAccount['status'], [string, string]> = {
    new: ['bg-slate-800 text-slate-300', 'Not logged in'],
    ready: ['bg-blue-500/10 text-blue-300', 'Logged in · not synced yet'],
    ok: ['bg-emerald-500/10 text-emerald-300', 'Connected'],
    syncing: ['bg-blue-500/10 text-blue-300', 'Syncing…'],
    'login-required': ['bg-amber-500/10 text-amber-300', 'Login needed'],
    error: ['bg-red-500/10 text-red-300', 'Sync failed']
  }
  const [cls, text] = styles[account.status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {account.status === 'syncing' && <Spinner className="h-2.5! w-2.5!" />}
      {text}
    </span>
  )
}

function AccountDialog({ account, onClose }: { account?: ProtonAccount; onClose: () => void }) {
  const addProtonAccount = useAppStore((s) => s.addProtonAccount)
  const updateProtonAccount = useAppStore((s) => s.updateProtonAccount)
  const [label, setLabel] = useState(account?.label ?? '')
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!label.trim()) return
    setSaving(true)
    const ok = account ? await updateProtonAccount(account.id, { label: label.trim() }) : await addProtonAccount(label.trim())
    if (ok) onClose()
    setSaving(false)
  }

  return (
    <Modal
      title={account ? 'Rename account' : 'Connect a Proton account'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="account-form" disabled={saving || !label.trim()}>
            {account ? 'Save' : 'Continue to Proton login'}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Account name" hint="Only shown in this app, e.g. your email address or “Work”.">
          <TextInput autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. me@proton.me" />
        </Field>
        {!account && (
          <div className="space-y-1.5 rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
            <p>
              A Proton login window opens next. Sign in as usual (including 2FA). It closes by itself when you're in.
              Then click <span className="font-medium">Sync now</span> to download that account's calendars.
            </p>
            <p>
              Your password goes only to Proton. The app keeps the login session on this computer, separately for each
              account, and uses it only when you click Sync now or refresh.
            </p>
          </div>
        )}
      </form>
    </Modal>
  )
}

function AccountCard({ account, onRename }: { account: ProtonAccount; onRename: () => void }) {
  const allCalendars = useAppStore((s) => s.calendars)
  const calendars = useMemo(() => allCalendars.filter((c) => c.accountId === account.id), [allCalendars, account.id])
  const removeProtonAccount = useAppStore((s) => s.removeProtonAccount)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const protonAction = useAppStore((s) => s.protonAction)
  const needsLogin = account.status === 'new' || account.status === 'login-required'
  const syncing = account.status === 'syncing'

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium">{account.label}</h3>
          <StatusBadge account={account} />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {account.lastExportAt ? `Last synced ${formatRelative(account.lastExportAt)}` : 'Never synced'}
          {calendars.length > 0 && ` · ${calendars.length} calendar${calendars.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {account.status === 'login-required' && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertIcon size={14} className="mt-px shrink-0" />
          Proton signed this account out. Log in again to resume syncing. Your calendars still show the last synced
          events.
        </p>
      )}
      {account.status === 'error' && account.lastError && (
        <p className="selectable mt-3 flex items-start gap-1.5 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertIcon size={14} className="mt-px shrink-0" />
          <span>{account.lastError}</span>
        </p>
      )}

      {calendars.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {calendars.map((c) => (
            <li
              key={c.id}
              className={`flex items-center gap-1.5 rounded-full border border-slate-800 px-2 py-0.5 text-xs ${
                c.enabled ? 'text-slate-200' : 'text-slate-500 line-through'
              }`}
              title={c.lastSyncError ?? undefined}
            >
              <ColorDot color={c.color} size={8} />
              {c.name}
              {c.lastSyncError && <AlertIcon size={12} className="text-amber-400" />}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {needsLogin ? (
          <Button variant="primary" onClick={() => void protonAction('openLogin', account.id)}>
            Log in
          </Button>
        ) : (
          <Button
            variant={account.status === 'ready' ? 'primary' : 'secondary'}
            disabled={syncing}
            onClick={() => void protonAction('syncAccount', account.id)}
          >
            {syncing ? <Spinner /> : <RefreshIcon />} Sync now
          </Button>
        )}
        <Button
          variant="ghost"
          title="Opens Proton's Import/export page. Clicking “Download ICS” there imports the file automatically."
          onClick={() => void protonAction('openProton', account.id)}
        >
          <ExternalIcon /> Open Proton
        </Button>
        <Button variant="ghost" onClick={onRename}>
          Rename
        </Button>
        <Button
          variant="ghost"
          className="ml-auto text-red-400!"
          onClick={() => {
            void askConfirm({
              title: 'Remove account?',
              message: `"${account.label}", its calendars and their notes are removed from this app, and the saved login is cleared. Nothing changes in Proton.`,
              confirmLabel: 'Remove account',
              danger: true
            }).then((ok) => {
              if (ok) void removeProtonAccount(account.id)
            })
          }}
        >
          Remove
        </Button>
      </div>
    </li>
  )
}

export function AccountsPage() {
  useNow() // keeps "Last synced … ago" current
  const accounts = useAppStore((s) => s.protonAccounts)
  const syncAll = useAppStore((s) => s.syncAllProtonAccounts)
  const [dialog, setDialog] = useState<{ account?: ProtonAccount } | null>(null)
  const anySyncing = accounts.some((a) => a.status === 'syncing')

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Proton accounts</h1>
            <p className="mt-1 text-sm text-slate-400">
              Log in once per account; works with free plans. Calendars are downloaded only when you click Sync.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => void syncAll()} disabled={anySyncing || accounts.length === 0}>
              {anySyncing ? <Spinner /> : <RefreshIcon />} Sync all
            </Button>
            <Button variant="primary" onClick={() => setDialog({})}>
              <PlusIcon /> Add account
            </Button>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-6 py-12 text-center">
            <p className="font-medium">No Proton accounts connected</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
              Connect each Proton account once. Then click Sync whenever you want the latest events from all of its
              calendars. No share links or paid plan needed.
            </p>
            <Button variant="primary" className="mt-4" onClick={() => setDialog({})}>
              <PlusIcon /> Connect your first account
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {accounts.map((a) => (
              <AccountCard key={a.id} account={a} onRename={() => setDialog({ account: a })} />
            ))}
          </ul>
        )}

        <p className="mt-6 text-xs text-slate-500">
          How it works: when you click Sync, the app opens Proton's own Import/export page in a hidden window using the
          saved login and clicks “Download ICS” for each calendar, exactly as you would. Nothing runs in the background.
          If Proton changes its website and this stops working, use “Open Proton” and click Download ICS yourself; the
          file is imported automatically.
        </p>
      </div>

      {dialog && <AccountDialog account={dialog.account} onClose={() => setDialog(null)} />}
    </div>
  )
}
