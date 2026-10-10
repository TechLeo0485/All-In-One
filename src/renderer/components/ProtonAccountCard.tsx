import { useMemo, useState, type FormEvent } from 'react'
import type { CalendarSource, ProtonAccount } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { formatAge } from '../utils/dates'
import { isProtonStale } from '../utils/proton'
import { useNow } from '../hooks/useNow'
import { CalendarCard } from './CalendarCard'
import { AlertIcon, ExternalIcon, RefreshIcon } from './icons'
import { Button, Field, Modal, Spinner, TextInput } from './ui'

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

function RenameAccountDialog({ account, onClose }: { account: ProtonAccount; onClose: () => void }) {
  const updateProtonAccount = useAppStore((s) => s.updateProtonAccount)
  const [label, setLabel] = useState(account.label)
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!label.trim()) return
    setSaving(true)
    if (await updateProtonAccount(account.id, { label: label.trim() })) onClose()
    setSaving(false)
  }

  return (
    <Modal
      title="Rename account"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="account-form" disabled={saving || !label.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={onSubmit}>
        <Field label="Account name" hint="Only shown in this app, e.g. your email address or “Work”.">
          <TextInput autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. me@proton.me" />
        </Field>
      </form>
    </Modal>
  )
}

/** A connected Proton account with its calendars; syncing happens per account. */
export function ProtonAccountCard({
  account,
  onEditCalendar
}: {
  account: ProtonAccount
  onEditCalendar: (calendar: CalendarSource) => void
}) {
  const now = useNow()
  const allCalendars = useAppStore((s) => s.calendars)
  const calendars = useMemo(() => allCalendars.filter((c) => c.accountId === account.id), [allCalendars, account.id])
  const removeProtonAccount = useAppStore((s) => s.removeProtonAccount)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const protonAction = useAppStore((s) => s.protonAction)
  const [renaming, setRenaming] = useState(false)
  const needsLogin = account.status === 'new' || account.status === 'login-required'
  const syncing = account.status === 'syncing'

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium">{account.label}</h3>
            <StatusBadge account={account} />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Proton account ·{' '}
            <span className={isProtonStale(account, now) ? 'text-amber-300/80' : undefined}>
              {account.lastExportAt ? `last synced ${formatAge(account.lastExportAt, now)}` : 'never synced'}
            </span>
            {calendars.length > 0 && ` · ${calendars.length} calendar${calendars.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
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
          <Button variant="ghost" onClick={() => setRenaming(true)}>
            Rename
          </Button>
          <Button
            variant="ghost"
            className="text-red-400!"
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

      {calendars.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {calendars.map((c) => (
            <CalendarCard key={c.id} calendar={c} nested onEdit={() => onEditCalendar(c)} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          {needsLogin
            ? 'Log in, then click Sync now to download this account’s calendars.'
            : 'Click Sync now to download this account’s calendars.'}
        </p>
      )}

      {renaming && <RenameAccountDialog account={account} onClose={() => setRenaming(false)} />}
    </li>
  )
}
