import { Router } from 'express'
import { loadCategories, addCategoryAndWeight } from '../services/categoryDetector.js'
import { loadLocations, resolveLocation } from '../services/locationResolver.js'
import { requireApiKey } from '../middleware/apiKey.js'

export default function foodLogRoutes(supabase) {
  const router = Router()

  // POST /api/food-logs — create a food log entry
  router.post('/', requireApiKey, async (req, res) => {
    try {
      const {
        rescue_location,
        drop_off_location,
        rescued_at,
        rescued_by,
        items = [],
        notes,
        source = 'manual',
        record_type = 'rescue',
        classification,
        slack_ts,
        slack_channel,
        raw_text,
      } = req.body

      // Input validation
      if (!rescue_location || !rescued_at) {
        return res.status(400).json({ error: 'rescue_location and rescued_at are required' })
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items must be a non-empty array' })
      }
      if (record_type && !['rescue', 'inventory'].includes(record_type)) {
        return res.status(400).json({ error: 'record_type must be "rescue" or "inventory"' })
      }
      if (isNaN(Date.parse(rescued_at))) {
        return res.status(400).json({ error: 'rescued_at must be a valid date string' })
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
        record_type,
        classification: classification || null,
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
        record_type,
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
      if (record_type) query = query.eq('record_type', record_type)
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

  // GET /api/food-logs/inventory-latest — most recent inventory snapshot per warehouse
  router.get('/inventory-latest', async (req, res) => {
    try {
      const warehouses = ['Urban Canopy', 'Keystone']
      const results = {}
      for (const wh of warehouses) {
        const { data } = await supabase
          .from('food_logs')
          .select('*')
          .eq('record_type', 'inventory')
          .eq('rescue_location_name', wh)
          .order('rescued_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (data) results[wh] = data
      }
      res.json(results)
    } catch (err) {
      console.error('GET /api/food-logs/inventory-latest error:', err.message)
      res.status(500).json({ error: 'Failed to fetch latest inventory' })
    }
  })

  // POST /api/food-logs/parse — parse pasted text into structured items
  router.post('/parse', requireApiKey, async (req, res) => {
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
