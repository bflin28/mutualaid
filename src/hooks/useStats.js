import { useState, useEffect, useCallback } from 'react'
import { fetchFoodLogStats } from '../lib/api'

export function useStats(filters = {}) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetchFoodLogStats(filters)
      .then(setStats)
      .catch(err => console.error('Failed to load stats:', err))
      .finally(() => setLoading(false))
  }, [JSON.stringify(filters)])

  useEffect(() => { load() }, [load])

  return { stats, loading, refresh: load }
}
