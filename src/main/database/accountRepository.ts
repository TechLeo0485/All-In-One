import { randomUUID } from 'node:crypto'
import type { ProtonAccount, ProtonAccountStatus } from '@shared/types'
import { getDb } from './connection'

interface AccountRow {
  id: string
  label: string
  status: string
  last_export_at: string | null
  last_error: string | null
  created_at: string
}

function toAccount(row: AccountRow): ProtonAccount {
  return {
    id: row.id,
    label: row.label,
    status: row.status as ProtonAccountStatus,
    lastExportAt: row.last_export_at,
    lastError: row.last_error,
    createdAt: row.created_at
  }
}

export const accountRepository = {
  list(): ProtonAccount[] {
    const rows = getDb().prepare('SELECT * FROM proton_accounts ORDER BY created_at').all() as AccountRow[]
    return rows.map(toAccount)
  },

  get(id: string): ProtonAccount | null {
    const row = getDb().prepare('SELECT * FROM proton_accounts WHERE id = ?').get(id) as AccountRow | undefined
    return row ? toAccount(row) : null
  },

  create(label: string): ProtonAccount {
    const id = randomUUID()
    getDb()
      .prepare('INSERT INTO proton_accounts (id, label, created_at) VALUES (?, ?, ?)')
      .run(id, label, new Date().toISOString())
    return this.get(id)!
  },

  update(id: string, patch: { label?: string }): ProtonAccount {
    const existing = this.get(id)
    if (!existing) throw new Error('Account not found')
    getDb().prepare('UPDATE proton_accounts SET label = ? WHERE id = ?').run(patch.label ?? existing.label, id)
    return this.get(id)!
  },

  /** After a successful login: logged in, waiting for the user to sync. */
  markReady(id: string): void {
    getDb()
      .prepare("UPDATE proton_accounts SET status = 'ready', last_error = NULL WHERE id = ? AND status IN ('new', 'login-required')")
      .run(id)
  },

  /** Records the outcome of an export run. 'syncing' is never persisted. */
  setResult(id: string, status: Exclude<ProtonAccountStatus, 'syncing'>, error: string | null): void {
    if (status === 'ok') {
      getDb()
        .prepare("UPDATE proton_accounts SET status = 'ok', last_error = NULL, last_export_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id)
    } else {
      getDb().prepare('UPDATE proton_accounts SET status = ?, last_error = ? WHERE id = ?').run(status, error, id)
    }
  },

  /** Deletes the account plus its calendars (cascade), their events (cascade) and notes. */
  remove(id: string): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare(
        `DELETE FROM notes WHERE event_id IN (
           SELECT e.id FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE c.account_id = ?)`
      ).run(id)
      db.prepare('DELETE FROM proton_accounts WHERE id = ?').run(id)
    })()
  }
}
