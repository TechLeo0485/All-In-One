import { useState } from 'react'
import { APP_NAME } from '@shared/brand'
import { useUpdateStatus } from '../hooks/useUpdateStatus'
import { Button } from './ui'

/** Thin bar above the app once an update has been downloaded. */
export function UpdateBanner() {
  const status = useUpdateStatus()
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  if (status?.state !== 'ready' || status.version === dismissedVersion) return null

  return (
    <div className="flex items-center gap-3 border-b border-blue-900 bg-blue-950/60 px-4 py-2 text-sm">
      <span className="flex-1">
        {APP_NAME} <span className="font-medium">{status.version}</span> is ready to install. It takes a few seconds and
        your data stays as it is.
      </span>
      <Button onClick={() => setDismissedVersion(status.version)} title="It installs automatically the next time you quit">
        Later
      </Button>
      <Button variant="primary" onClick={() => void window.api.updates.install()}>
        Restart now
      </Button>
    </div>
  )
}
