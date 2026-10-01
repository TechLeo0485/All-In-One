import { useEffect, useState } from 'react'
import type { CalendarEvent } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { errorMessage } from '../utils/errors'

interface EventDetails {
  event: CalendarEvent | null
  loading: boolean
  error: string | null
}

/**
 * Loads a single event by id, reloading when events change (e.g. after a sync or
 * an edit). Stale responses from a previous selection are ignored.
 */
export function useEventDetails(eventId: string | null): EventDetails {
  const eventsVersion = useAppStore((s) => s.eventsVersion)
  const [state, setState] = useState<EventDetails>({ event: null, loading: false, error: null })

  useEffect(() => {
    if (!eventId) {
      setState({ event: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    window.api.events
      .get(eventId)
      .then((event) => !cancelled && setState({ event, loading: false, error: null }))
      .catch((err) => !cancelled && setState({ event: null, loading: false, error: errorMessage(err) }))
    return () => {
      cancelled = true
    }
  }, [eventId, eventsVersion])

  return state
}
