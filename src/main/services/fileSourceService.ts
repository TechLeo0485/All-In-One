import { fileURLToPath, pathToFileURL } from 'node:url'
import { BrowserWindow, dialog } from 'electron'

export function isFileSource(url: string): boolean {
  return url.trim().toLowerCase().startsWith('file:')
}

export function fileSourcePath(url: string): string {
  return fileURLToPath(url)
}

/**
 * Local .ics files as calendar sources (for Proton free accounts, which can export
 * an ICS file but cannot create share links). Files are re-read only when the user
 * clicks refresh or "Update from file"; they are not watched.
 *
 * Security: the renderer can never choose an arbitrary path. A file: source is only
 * accepted if it came from the native open dialog shown by the main process in this
 * session, or if it is the path already stored on that calendar.
 */
class FileSourceService {
  private approved = new Set<string>()

  async pickFile(win: BrowserWindow | null): Promise<string | null> {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose an exported calendar (.ics) file',
      properties: ['openFile'],
      filters: [
        { name: 'iCalendar files', extensions: ['ics', 'ical', 'ifb', 'icalendar'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const url = pathToFileURL(result.filePaths[0]).href
    this.approved.add(url)
    return url
  }

  /** Whether `url` may be saved as a calendar source. */
  isAllowed(url: string, currentUrl?: string): boolean {
    return this.approved.has(url) || url === currentUrl
  }
}

export const fileSourceService = new FileSourceService()
