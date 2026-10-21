import type { ThemeMode } from '@shared/types'
import { DEFAULT_THEME, THEMES } from '@shared/theme'

/** Last applied theme, read before the first paint (settings arrive later over IPC). */
const STORAGE_KEY = 'theme'

/** Switches the colors in index.css (`:root[data-theme='light']`). */
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(STORAGE_KEY, theme)
}

export function applyCachedTheme(): void {
  const cached = localStorage.getItem(STORAGE_KEY)
  applyTheme(THEMES.includes(cached as ThemeMode) ? (cached as ThemeMode) : DEFAULT_THEME)
}
