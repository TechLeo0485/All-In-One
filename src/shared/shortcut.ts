/**
 * The show/hide shortcut is stored as an Electron accelerator ("Alt+Shift+C").
 * The renderer records it from a key press; the main process validates and
 * registers it with globalShortcut.
 */

export const DEFAULT_SHORTCUT = 'Alt+Shift+C'

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'] as const

/** KeyboardEvent.code -> accelerator key name, for keys that aren't letters/digits/F-keys. */
const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Numpad0: 'num0',
  Numpad1: 'num1',
  Numpad2: 'num2',
  Numpad3: 'num3',
  Numpad4: 'num4',
  Numpad5: 'num5',
  Numpad6: 'num6',
  Numpad7: 'num7',
  Numpad8: 'num8',
  Numpad9: 'num9'
}

const KEY_NAMES = new Set(Object.values(NAMED_KEYS))
const F_KEY_RE = /^F([1-9]|1\d|2[0-4])$/

/** Accelerator key for a KeyboardEvent.code (layout independent), or null for modifiers/unsupported keys. */
function keyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit(\d)$/.exec(code)
  if (m) return m[1]
  if (F_KEY_RE.test(code)) return code
  return NAMED_KEYS[code] ?? null
}

export type RecordResult = { accelerator: string } | { pending: true } | { error: string }

/**
 * Turns a keydown into an accelerator. Returns `pending` while only modifiers are
 * held, and an error for combinations that would get in the way of typing.
 */
export function shortcutFromKeyEvent(e: {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}): RecordResult {
  const key = keyFromCode(e.code)
  if (!key) return { pending: true }
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[]
  const isFKey = F_KEY_RE.test(key)
  if (!isFKey && (mods.length === 0 || (mods.length === 1 && mods[0] === 'Shift'))) {
    return { error: 'Use at least Ctrl, Alt or Win with a key (F-keys work alone)' }
  }
  return { accelerator: [...mods, key].join('+') }
}

/** True for accelerators this app produces (used to validate settings from the renderer). */
export function isValidShortcut(accelerator: string): boolean {
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  if (parts.some((p) => !(MODIFIERS as readonly string[]).includes(p)) || new Set(parts).size !== parts.length) return false
  const validKey = /^[A-Z0-9]$/.test(key) || F_KEY_RE.test(key) || KEY_NAMES.has(key)
  return validKey && (parts.length > 0 || F_KEY_RE.test(key))
}

/** "Alt+Shift+C" -> ["Alt", "Shift", "C"] for display (Super is shown as Win). */
export function shortcutKeys(accelerator: string): string[] {
  return accelerator.split('+').map((k) => (k === 'Super' ? 'Win' : k.startsWith('num') ? `Num ${k.slice(3)}` : k))
}
