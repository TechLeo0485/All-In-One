import { useState } from 'react'
import { TEAMWORK_COLORS } from '@shared/colors'
import { errorMessage } from '../utils/errors'
import { Button, Modal } from './ui'

/** Black or white, whichever reads better on the color (as the caller tag does). */
function textOn(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? '#0f172a' : '#ffffff'
}

const HEX = /^#[0-9a-f]{6}$/i

/**
 * Picks the Teamwork color of a caller (or of Unassigned interviews): a preview
 * of an interview in it, Teamwork's palette and any custom color. Saved on
 * Teamwork, so everyone sees it on the website and in the app.
 */
export function TeamworkColorDialog({
  calendarId,
  name,
  color,
  onClose
}: {
  calendarId: string
  /** "Ann" or "Unassigned". */
  name: string
  color: string
  onClose: () => void
}) {
  const [picked, setPicked] = useState(color.toLowerCase())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unassigned = name === 'Unassigned'
  const custom = !TEAMWORK_COLORS.includes(picked)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await window.api.caller.setColor(calendarId, picked)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Color for ${name}`}
      onClose={onClose}
      width="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || picked === color.toLowerCase()}>
            {saving ? 'Saving…' : 'Save color'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* How interviews look in it. */}
        <div
          className="rounded-md border-l-4 px-3 py-2 text-sm"
          style={{ borderColor: picked, background: `${picked}2e` }}
          aria-hidden
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-slate-100">Acme – Frontend</span>
            <span
              className={`shrink-0 rounded-full px-2 py-px text-[11px] leading-4 font-semibold ${unassigned ? 'border border-dashed' : ''}`}
              style={unassigned ? { borderColor: picked, color: picked } : { background: picked, color: textOn(picked) }}
            >
              {unassigned ? 'Unassigned' : name.split(/\s+/)[0]}
            </span>
          </div>
          <span className="text-xs text-slate-400">10:00 – 11:00</span>
        </div>

        <div className="grid grid-cols-7 gap-2" role="radiogroup" aria-label={`Color for ${name}`}>
          {TEAMWORK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={picked === c}
              aria-label={c}
              disabled={saving}
              onClick={() => setPicked(c)}
              className={`flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-slate-900 transition ${
                picked === c ? 'ring-2 ring-slate-200' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
            >
              {picked === c && (
                <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke={textOn(c)} strokeWidth={3.5} aria-hidden>
                  <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
          <label
            title="Any color"
            className={`relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border border-slate-700 ring-offset-2 ring-offset-slate-900 ${
              custom ? 'ring-2 ring-slate-200' : ''
            }`}
            style={{ background: custom ? picked : 'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)' }}
          >
            <input
              type="color"
              value={picked}
              disabled={saving}
              onChange={(e) => HEX.test(e.target.value) && setPicked(e.target.value.toLowerCase())}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Any color"
            />
          </label>
        </div>

        <p className="text-xs text-slate-500">Saved on Teamwork: everyone in the workspace sees this color, on the website and in the app.</p>
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
    </Modal>
  )
}
