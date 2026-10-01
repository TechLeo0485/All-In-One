import type { CalendarApi } from '../shared/types'

declare global {
  interface Window {
    api: CalendarApi
  }
}

export {}
