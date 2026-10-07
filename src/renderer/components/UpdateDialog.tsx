import { useEffect, useState } from 'react'
import { APP_NAME } from '@shared/brand'
import { useUpdateStatus } from '../hooks/useUpdateStatus'
import { Button, Modal } from './ui'

/**
 * Popup when a new version is found: "Download and install" or "Skip". Nothing is
 * downloaded before the user agrees. After agreeing it shows the download progress,
 * and the app restarts into the new version by itself.
 */
export function UpdateDialog() {
  const status = useUpdateStatus()
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  /** The user started a download from this popup (so a failure is shown here). */
  const [started, setStarted] = useState(false)
  /** Closed with ✕ / Esc for this version; Settings and the tray still offer it. */
  const [hiddenVersion, setHiddenVersion] = useState<string | null>(null)

  useEffect(() => {
    window.api.app.info().then((info) => setCurrentVersion(info.version), () => undefined)
  }, [])

  if (!status?.version || status.version === hiddenVersion) return null
  const { state, version, percent } = status
  const failed = state === 'error' && started
  const visible = (state === 'available' && !status.skipped) || state === 'downloading' || state === 'ready' || failed
  if (!visible) return null

  const hide = (): void => {
    setHiddenVersion(version)
    setStarted(false)
  }
  const download = (): void => {
    setStarted(true)
    void window.api.updates.download()
  }

  let body
  let footer
  if (state === 'available') {
    body = (
      <>
        <p>
          {APP_NAME} <span className="font-medium text-white">{version}</span> is available
          {currentVersion ? ` (you have ${currentVersion})` : ''}.
        </p>
        <p className="mt-2 text-slate-400">
          It downloads now, then the app restarts by itself to install it. Your calendars, events and notes stay as they are.
        </p>
      </>
    )
    footer = (
      <>
        <Button onClick={() => void window.api.updates.skip()} title="Don't ask again for this version">
          Skip
        </Button>
        <Button autoFocus variant="primary" onClick={download}>
          Download and install
        </Button>
      </>
    )
  } else if (state === 'downloading' || state === 'ready') {
    const value = state === 'ready' ? 100 : (percent ?? 0)
    body = (
      <>
        <p>{state === 'ready' ? 'Installing… the app restarts in a moment.' : `Downloading version ${version}… ${value}%`}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${value}%` }} />
        </div>
        {state === 'downloading' && (
          <p className="mt-2 text-xs text-slate-500">You can close this window; the download continues and the app restarts when it’s done.</p>
        )}
      </>
    )
    footer = state === 'downloading' ? <Button onClick={hide}>Hide</Button> : undefined
  } else {
    body = <p className="text-amber-300">The download failed: {status.error}</p>
    footer = (
      <>
        <Button onClick={hide}>Close</Button>
        <Button variant="primary" onClick={download}>
          Try again
        </Button>
      </>
    )
  }

  return (
    <Modal title="Update available" width="max-w-md" onClose={hide} footer={footer}>
      <div className="text-sm text-slate-300">{body}</div>
    </Modal>
  )
}
