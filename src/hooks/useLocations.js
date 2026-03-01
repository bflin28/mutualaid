import { useState, useEffect } from 'react'
import { fetchLocations } from '../lib/api'

export function useLocations(type) {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLocations(type)
      .then(setLocations)
      .catch(err => console.error('Failed to load locations:', err))
      .finally(() => setLoading(false))
  }, [type])

  return { locations, loading }
}
