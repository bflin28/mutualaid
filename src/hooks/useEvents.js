import { useState, useEffect, useCallback } from 'react'
import { fetchEvents } from '../lib/api'

export function useEvents() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetchEvents()
      .then(setEvents)
      .catch(() => {
        // Fallback: load static events JSON (for preview without backend)
        return fetch('/events_data.json')
          .then(r => r.json())
          .then(setEvents)
          .catch(err => console.error('Failed to load events:', err))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return { events, loading, reload: load }
}
