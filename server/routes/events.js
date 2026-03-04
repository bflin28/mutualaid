import { Router } from 'express'

export default function eventRoutes(supabase) {
  const router = Router()

  // GET /api/events — list active events with signup counts
  router.get('/', async (req, res) => {
    try {
      const { data: events, error } = await supabase
        .from('pickup_events')
        .select(`
          *,
          locations (name, address, neighborhood),
          signups (id, occurrence_date, volunteer_name)
        `)
        .eq('status', 'active')
        .order('day_of_week')
        .order('start_time')

      if (error) throw error

      // Calculate next occurrence date and spots filled for each event
      const now = new Date()
      const enriched = events.map(event => {
        const nextDate = event.occurrence_date
          ? event.occurrence_date
          : getNextOccurrence(event.day_of_week)

        const signupsForNext = (event.signups || []).filter(
          s => s.occurrence_date === nextDate
        )

        return {
          ...event,
          next_occurrence: nextDate,
          spots_filled: signupsForNext.length,
          spots_remaining: Math.max(0, (event.capacity || 1) - signupsForNext.length),
          signups: undefined, // don't expose raw signups
        }
      })

      res.json(enriched)
    } catch (err) {
      console.error('GET /api/events error:', err.message)
      res.status(500).json({ error: 'Failed to fetch events' })
    }
  })

  // POST /api/events — create a pickup event
  router.post('/', async (req, res) => {
    try {
      const {
        name,
        address,
        location_id,
        day_of_week,
        start_time,
        end_time,
        occurrence_date,
        capacity = 1,
        notes,
      } = req.body

      if (!name || !address || !start_time) {
        return res.status(400).json({ error: 'name, address, and start_time are required' })
      }
      if (typeof name !== 'string' || name.length > 200) {
        return res.status(400).json({ error: 'name must be a string (max 200 chars)' })
      }
      if (typeof address !== 'string' || address.length > 500) {
        return res.status(400).json({ error: 'address must be a string (max 500 chars)' })
      }

      const { data, error } = await supabase
        .from('pickup_events')
        .insert({
          name,
          address,
          location_id: location_id || null,
          day_of_week: day_of_week ?? null,
          start_time,
          end_time: end_time || null,
          occurrence_date: occurrence_date || null,
          capacity,
          notes: notes || null,
        })
        .select()
        .single()

      if (error) throw error
      res.status(201).json(data)
    } catch (err) {
      console.error('POST /api/events error:', err.message)
      res.status(500).json({ error: 'Failed to create event' })
    }
  })

  return router
}

function getNextOccurrence(dayOfWeek) {
  const now = new Date()
  const today = now.getDay()
  let daysUntil = dayOfWeek - today
  if (daysUntil < 0) daysUntil += 7
  if (daysUntil === 0) daysUntil = 7 // next week if today
  const next = new Date(now)
  next.setDate(now.getDate() + daysUntil)
  return next.toISOString().slice(0, 10)
}
