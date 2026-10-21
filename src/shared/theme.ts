import type { ThemeMode } from './types'

export const THEMES: readonly ThemeMode[] = ['dark', 'light']

export const DEFAULT_THEME: ThemeMode = 'dark'

/**
 * Window colors the renderer's CSS can't reach: the background shown before the page
 * paints and the Windows title bar buttons. Match body / TitleBar in index.css.
 */
export const WINDOW_COLORS: Record<ThemeMode, { background: string; titleBar: string; symbols: string }> = {
  dark: { background: '#020617', titleBar: '#0f172a', symbols: '#cbd5e1' },
  light: { background: '#f1f5f9', titleBar: '#ffffff', symbols: '#334155' }
}
