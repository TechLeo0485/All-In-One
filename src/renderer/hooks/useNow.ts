import { useEffect, useState } from 'react'

/**
 * Re-renders the calling component every `intervalMs` so relative labels such as
 * "5 min ago" stay current. Returns the current timestamp.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
