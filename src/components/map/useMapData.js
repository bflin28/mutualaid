import { useMemo } from 'react'
import LOCATIONS from '../../data/locationCoordinates'

/**
 * Aggregates parsed rescue data into map-ready flows and location totals.
 * @param {Array} records - Raw parsed rescue records from parsed_data.json
 * @param {string|null} yearFilter - Year to filter by (e.g. '2024'), or null for all
 * @returns {{ flows, locationTotals, summary, years }}
 */
export function useMapData(records, yearFilter) {
  return useMemo(() => {
    if (!records || records.length === 0) {
      return { flows: [], locationTotals: {}, summary: {}, years: [] }
    }

    // Collect unique years
    const yearSet = new Set()
    records.forEach(r => {
      if (r.rescued_at) {
        yearSet.add(new Date(r.rescued_at).getFullYear().toString())
      }
    })
    const years = [...yearSet].sort()

    // Filter by year
    const filtered = yearFilter
      ? records.filter(r => r.rescued_at && new Date(r.rescued_at).getFullYear().toString() === yearFilter)
      : records

    // Aggregate flows: { "from→to": { from, to, totalLbs, tripCount } }
    const flowMap = {}
    // Per-location totals: { name: { totalLbs, tripCount, type, categories: {} } }
    const locationTotals = {}

    let totalLbs = 0
    let totalTrips = 0

    for (const record of filtered) {
      const from = record.rescue_location_name
      const to = record.drop_off_location_name
      if (!from || from === 'Unknown') continue

      const lbs = record.total_estimated_lbs || 0
      totalLbs += lbs
      totalTrips++

      const dateStr = record.rescued_at || null

      // Update rescue source totals
      if (!locationTotals[from]) {
        locationTotals[from] = {
          totalLbs: 0, tripCount: 0,
          type: LOCATIONS[from]?.type || 'rescue',
          categories: {},
          lastDate: null,
        }
      }
      locationTotals[from].totalLbs += lbs
      locationTotals[from].tripCount++
      if (dateStr && (!locationTotals[from].lastDate || dateStr > locationTotals[from].lastDate)) {
        locationTotals[from].lastDate = dateStr
      }

      // Update drop-off totals
      if (to) {
        if (!locationTotals[to]) {
          locationTotals[to] = {
            totalLbs: 0, tripCount: 0,
            type: LOCATIONS[to]?.type || 'distribution',
            categories: {},
            lastDate: null,
          }
        }
        locationTotals[to].totalLbs += lbs
        locationTotals[to].tripCount++
        if (dateStr && (!locationTotals[to].lastDate || dateStr > locationTotals[to].lastDate)) {
          locationTotals[to].lastDate = dateStr
        }

        // Build flow
        const flowKey = `${from}→${to}`
        if (!flowMap[flowKey]) {
          flowMap[flowKey] = { from, to, totalLbs: 0, tripCount: 0 }
        }
        flowMap[flowKey].totalLbs += lbs
        flowMap[flowKey].tripCount++
      }

      // Aggregate categories per location
      if (record.items) {
        for (const item of record.items) {
          const cat = item.gcfd_category || 'Unknown'
          const itemLbs = item.estimated_lbs || 0
          if (!locationTotals[from].categories[cat]) locationTotals[from].categories[cat] = 0
          locationTotals[from].categories[cat] += itemLbs
        }
      }
    }

    const flows = Object.values(flowMap)
      .filter(f => LOCATIONS[f.from] && LOCATIONS[f.to])
      .sort((a, b) => b.totalLbs - a.totalLbs)

    // Find top location
    const topLocation = Object.entries(locationTotals)
      .filter(([, v]) => v.type === 'rescue')
      .sort(([, a], [, b]) => b.totalLbs - a.totalLbs)[0]

    const summary = {
      totalLbs: Math.round(totalLbs),
      totalTrips,
      locationCount: Object.keys(locationTotals).length,
      topLocation: topLocation ? topLocation[0] : null,
      topLocationLbs: topLocation ? Math.round(topLocation[1].totalLbs) : 0,
    }

    return { flows, locationTotals, summary, years }
  }, [records, yearFilter])
}
