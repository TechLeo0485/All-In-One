import { app, Notification, type NotificationConstructorOptions } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ID, APP_NAME } from '@shared/brand'

/**
 * App icon as a real file on disk. Windows (notifications, registry) can't read
 * files inside app.asar, so the installer also copies it next to app.asar
 * (build.extraResources); in development it's read from /resources.
 */
export function appIconFile(): string {
  return resourceFile('icon.png')
}

function resourceFile(name: string): string {
  const packaged = join(process.resourcesPath, name)
  return app.isPackaged && existsSync(packaged) ? packaged : join(app.getAppPath(), 'resources', name)
}

/**
 * Small icon for the Windows registration (notification header), copied to a
 * file named by a hash of its content.
 *  - It must be small and simple: Windows renders the 256px artwork there as a
 *    dark square, so a dedicated 64px version is used (resources/identity.png).
 *  - Windows caches identity icons by path, so a new name per logo version
 *    makes logo changes show up immediately.
 */
function identityIconFile(): string {
  const source = resourceFile('identity.png')
  const data = readFileSync(source)
  const hash = createHash('sha1').update(data).digest('hex').slice(0, 10)
  const dir = join(app.getPath('userData'), 'identity')
  const file = join(dir, `icon-${hash}.png`)
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, data)
    for (const old of readdirSync(dir)) {
      if (old.startsWith('icon-') && join(dir, old) !== file) rmSync(join(dir, old), { force: true })
    }
  }
  return file
}

/** All app notifications go through here so they carry the All-In-One icon. */
export function createNotification(options: NotificationConstructorOptions): Notification {
  return new Notification({ icon: appIconFile(), ...options })
}

/**
 * Gives notifications the product's name and icon instead of "Electron".
 *
 * Windows attributes a toast to the process's AppUserModelID and shows the name /
 * icon registered for it. Registering the ID under
 * HKCU\Software\Classes\AppUserModelId\<id> (DisplayName + IconUri) is Microsoft's
 * documented way for desktop apps to do this without a packaged (MSIX) install,
 * and works in development too. The installer's uninstaller removes the key
 * (build/installer.nsh).
 */
export function registerWindowsIdentity(): void {
  if (process.platform !== 'win32') return
  app.setAppUserModelId(APP_ID)

  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`
  const values: [string, string][] = [
    ['DisplayName', APP_NAME],
    ['IconUri', identityIconFile()],
    ['IconBackgroundColor', 'FFF8FAFC'] // the calendar page color
  ]
  for (const [name, data] of values) {
    execFile('reg.exe', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', data, '/f'], { windowsHide: true }, (err) => {
      if (err) console.error(`[identity] could not register ${name}: ${err.message}`)
    })
  }
}
