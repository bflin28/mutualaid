import { Router } from 'express'
import { loadCategories, addCategoryAndWeight } from '../services/categoryDetector.js'
import { loadLocations, resolveLocation } from '../services/locationResolver.js'

export default function foodLogRoutes(supabase) {
  const router = Router()

  // POST /api/food-logs — create a food log entry
  router.post('/', async (req, res) => {
    try {
      const {
        rescue_location,
        drop_off_location,
        rescued_at,
        rescued_by,
        items = [],
        notes,
        source = 'manual',
        slack_ts,
        slack_channel,
        raw_text,
      } = req.body

      if (!rescue_location || !rescued_at) {
        return res.status(400).json({ error: 'rescue_location and rescued_at are required' })
      }

      const [categories, locations] = await Promise.all([
        loadCategories(supabase),
        loadLocations(supabase),
      ])

      // Resolve location
      const rescueLoc = resolveLocation(rescue_location, locations)

      // Add categories and weights to items
      const enrichedItems = addCategoryAndWeight(items, categories)
      const totalLbs = enrichedItems.reduce((sum, item) => sum + (item.estimated_lbs || 0), 0)

      const row = {
        rescue_location_id: rescueLoc?.id || null,
        rescue_location_name: rescueLoc?.name || rescue_location,
        drop_off_location_name: drop_off_location || null,
        rescued_at,
        rescued_by: rescued_by || null,
        items: enrichedItems,
        total_estimated_lbs: Math.round(totalLbs * 10) / 10,
        notes: notes || null,
        source,
        slack_ts: slack_ts || null,
        slack_channel: slack_channel || null,
        raw_text: raw_text || null,
      }

      const { data, error } = await supabase
        .from('food_logs')
        .insert(row)
        .select()
        .single()

      if (error) throw error
      res.status(201).json(data)
    } catch (err) {
      console.error('POST /api/food-logs error:', err.message)
      res.status(500).json({ error: 'Failed to create food log' })
    }
  })

  // GET /api/food-logs — list with pagination and filters
  router.get('/', async (req, res) => {
    try {
      const {
        limit = 50,
        offset = 0,
        location,
        source,
        start_date,
        end_date,
      } = req.query

      let query = supabase
        .from('food_logs')
        .select('*', { count: 'exact' })
        .order('rescued_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1)

      if (location) query = query.eq('rescue_location_name', location)
      if (source) query = query.eq('source', source)
      if (start_date) query = query.gte('rescued_at', start_date)
      if (end_date) query = query.lte('rescued_at', end_date + 'T23:59:59')

      const { data, count, error } = await query
      if (error) throw error
      res.json({ data, total: count })
    } catch (err) {
      console.error('GET /api/food-logs error:', err.message)
      res.status(500).json({ error: 'Failed to fetch food logs' })
    }
  })

  // GET /api/food-logs/stats — aggregated statistics
  router.get('/stats', async (req, res) => {
    try {
      const { start_date, end_date, location } = req.query

      let query = supabase.from('food_logs').select('*')
      if (location) query = query.eq('rescue_location_name', location)
      if (start_date) query = query.gte('rescued_at', start_date)
      if (end_date) query = query.lte('rescued_at', end_date + 'T23:59:59')

      const { data: logs, error } = await query
      if (error) throw error

      // Calculate stats
      const now = new Date()
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

      const totalLbs = logs.reduce((sum, l) => sum + (Number(l.total_estimated_lbs) || 0), 0)
      const totalRescues = logs.length

      const thisWeekLogs = logs.filter(l => new Date(l.rescued_at) >= oneWeekAgo)
      const lastWeekLogs = logs.filter(l => {
        const d = new Date(l.rescued_at)
        return d >= twoWeeksAgo && d < oneWeekAgo
      })

      const thisWeekLbs = thisWeekLogs.reduce((s, l) => s + (Number(l.total_estimated_lbs) || 0), 0)
      const lastWeekLbs = lastWeekLogs.reduce((s, l) => s + (Number(l.total_estimated_lbs) || 0), 0)
      const trend = lastWeekLbs > 0
        ? Math.round(((thisWeekLbs - lastWeekLbs) / lastWeekLbs) * 1000) / 10
        : 0

      // By location
      const byLocationMap = {}
      for (const log of logs) {
        const name = log.rescue_location_name
        if (!byLocationMap[name]) byLocationMap[name] = { name, lbs: 0, count: 0 }
        byLocationMap[name].lbs += Number(log.total_estimated_lbs) || 0
        byLocationMap[name].count++
      }
      const byLocation = Object.values(byLocationMap).sort((a, b) => b.lbs - a.lbs)

      // By category
      const byCategoryMap = {}
      for (const log of logs) {
        for (const item of log.items || []) {
          const cat = item.gcfd_category || 'Uncategorized'
          if (!byCategoryMap[cat]) byCategoryMap[cat] = { category: cat, lbs: 0 }
          byCategoryMap[cat].lbs += Number(item.estimated_lbs) || 0
        }
      }
      const byCategory = Object.values(byCategoryMap).sort((a, b) => b.lbs - a.lbs)

      // Weekly trend (last 12 weeks)
      const weeklyTrend = []
      for (let i = 11; i >= 0; i--) {
        const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000)
        const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
        const weekLbs = logs
          .filter(l => {
            const d = new Date(l.rescued_at)
            return d >= weekStart && d < weekEnd
          })
          .reduce((s, l) => s + (Number(l.total_estimated_lbs) || 0), 0)
        weeklyTrend.push({
          week: weekStart.toISOString().slice(0, 10),
          lbs: Math.round(weekLbs),
        })
      }

      res.json({
        totalLbs: Math.round(totalLbs),
        totalRescues,
        thisWeekLbs: Math.round(thisWeekLbs),
        thisWeekCount: thisWeekLogs.length,
        lastWeekLbs: Math.round(lastWeekLbs),
        trend,
        byLocation,
        byCategory,
        weeklyTrend,
      })
    } catch (err) {
      console.error('GET /api/food-logs/stats error:', err.message)
      res.status(500).json({ error: 'Failed to compute stats' })
    }
  })

  // POST /api/food-logs/parse — parse pasted text into structured items
  router.post('/parse', async (req, res) => {
    try {
      const { text } = req.body
      if (!text) return res.status(400).json({ error: 'text is required' })

      const categories = await loadCategories(supabase)
      const locations = await loadLocations(supabase)

      // Simple line-by-line parser
      const lines = text.split('\n').filter(l => l.trim())
      const items = []
      let inferredLocation = null

      for (const line of lines) {
        const trimmed = line.replace(/^[-•*✓☐\s]+/, '').trim()
        if (!trimmed) continue

        // Try to extract qty + unit + item name
        const match = trimmed.match(/^~?(\d+\.?\d*)\s*(cases?|boxes?|bags?|bins?|lbs?|pounds?|pallets?|crates?|flats?|items?|dozen|each|gallons?|packages?|cans?|pkgs?)\s+(?:of\s+)?(.+)/i)

        if (match) {
          const item = {
            name: match[3].trim(),
            quantity: parseFloat(match[1]),
            unit: match[2].toLowerCase(),
          }
          items.push(item)
        } else {
          // Check if the line mentions a location
          const loc = resolveLocation(trimmed, locations)
          if (loc) {
            inferredLocation = loc.name
          } else if (trimmed.length > 2 && !/^(picked|rescued|grabbed|from|to|at|the|and|for)\b/i.test(trimmed)) {
            items.push({ name: trimmed, quantity: 1, unit: 'cases' })
          }
        }
      }

      // Also try to infer location from the full text
      if (!inferredLocation) {
        const { inferLocationFromText } = await import('../services/locationResolver.js')
        const loc = inferLocationFromText(text, locations)
        if (loc) inferredLocation = loc.name
      }

      const enrichedItems = addCategoryAndWeight(items, categories)
      const totalLbs = enrichedItems.reduce((sum, item) => sum + (item.estimated_lbs || 0), 0)

      res.json({
        items: enrichedItems,
        total_estimated_lbs: Math.round(totalLbs * 10) / 10,
        inferred_location: inferredLocation,
      })
    } catch (err) {
      console.error('POST /api/food-logs/parse error:', err.message)
      res.status(500).json({ error: 'Failed to parse text' })
    }
  })

  return router
}
