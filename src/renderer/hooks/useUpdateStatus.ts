import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'

/** Current auto-update state, kept live through pushes from the main process. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let active = true
    window.api.updates.status().then(
      (s) => active && setStatus(s),
      () => undefined
    )
    const unsubscribe = window.api.updates.onStatusChange(setStatus)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return status
}
