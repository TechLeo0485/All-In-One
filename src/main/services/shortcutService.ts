import { globalShortcut } from 'electron'

/**
 * The system-wide show/hide shortcut. Registration fails when another app already
 * owns the combination; apply() reports that so Settings can say so instead of
 * saving a shortcut that does nothing.
 */
class ShortcutService {
  private current = ''
  private suspended = false
  private onPress: (() => void) | null = null

  init(onPress: () => void, accelerator: string): void {
    this.onPress = onPress
    if (accelerator && !this.apply(accelerator)) {
      console.warn(`[shortcut] "${accelerator}" is used by another app; the show/hide shortcut is inactive`)
    }
  }

  /** Switches to `accelerator` ('' = off). Returns false (keeping the old one) if it can't be registered. */
  apply(accelerator: string): boolean {
    if (accelerator === this.current) return true
    const previous = this.current
    this.unregister()
    this.current = accelerator
    if (!accelerator) return true
    // Registering is also the availability check, so do it even while suspended.
    if (!this.register()) {
      this.current = previous // taken by another app: keep the previous shortcut
      if (!this.suspended) this.register()
      return false
    }
    if (this.suspended) this.unregister()
    return true
  }

  /** While Settings records a new shortcut, pressing the current one must reach the page. */
  setSuspended(suspended: boolean): void {
    if (suspended === this.suspended) return
    this.suspended = suspended
    if (suspended) this.unregister()
    else this.register()
  }

  dispose(): void {
    this.unregister()
  }

  private register(): boolean {
    if (!this.current) return true
    try {
      return globalShortcut.register(this.current, () => this.onPress?.())
    } catch (err) {
      console.error('[shortcut] invalid accelerator:', err)
      return false
    }
  }

  private unregister(): void {
    if (this.current && globalShortcut.isRegistered(this.current)) globalShortcut.unregister(this.current)
  }
}

export const shortcutService = new ShortcutService()
