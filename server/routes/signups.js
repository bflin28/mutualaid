import { Router } from 'express'

export default function signupRoutes(supabase) {
  const router = Router()

  // POST /api/signups — volunteer signup
  router.post('/', async (req, res) => {
    try {
      const {
        event_id,
        occurrence_date,
        volunteer_name,
        volunteer_email,
        volunteer_phone,
        notes,
      } = req.body

      // Input validation
      if (!event_id || !occurrence_date || !volunteer_name || !volunteer_email) {
        return res.status(400).json({
          error: 'event_id, occurrence_date, volunteer_name, and volunteer_email are required',
        })
      }
      if (typeof event_id !== 'number' && isNaN(Number(event_id))) {
        return res.status(400).json({ error: 'event_id must be a number' })
      }
      if (typeof volunteer_name !== 'string' || volunteer_name.length > 200) {
        return res.status(400).json({ error: 'volunteer_name must be a string (max 200 chars)' })
      }
      if (volunteer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(volunteer_email)) {
        return res.status(400).json({ error: 'Invalid email format' })
      }
      if (volunteer_phone && !/^[\d\s().+-]{7,20}$/.test(volunteer_phone)) {
        return res.status(400).json({ error: 'Invalid phone format' })
      }

      // Check capacity
      const { data: event, error: eventErr } = await supabase
        .from('pickup_events')
        .select('capacity')
        .eq('id', event_id)
        .single()

      if (eventErr) throw eventErr

      const { count, error: countErr } = await supabase
        .from('signups')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event_id)
        .eq('occurrence_date', occurrence_date)

      if (countErr) throw countErr

      if (count >= (event.capacity || 1)) {
        return res.status(409).json({ error: 'This event is full for the selected date' })
      }

      const { data, error } = await supabase
        .from('signups')
        .insert({
          event_id,
          occurrence_date,
          volunteer_name,
          volunteer_email,
          volunteer_phone: volunteer_phone || null,
          notes: notes || null,
        })
        .select()
        .single()

      if (error) throw error
      res.status(201).json(data)
    } catch (err) {
      console.error('POST /api/signups error:', err.message)
      res.status(500).json({ error: 'Failed to create signup' })
    }
  })

  // GET /api/signups — list signups (public, no PII)
  router.get('/', async (req, res) => {
    try {
      const { event_id, status } = req.query

      let query = supabase
        .from('signups')
        .select('id, event_id, occurrence_date, role, status, created_at')
        .order('created_at', { ascending: false })

      if (event_id) query = query.eq('event_id', event_id)
      if (status) query = query.eq('status', status)

      const { data, error } = await query
      if (error) throw error
      res.json(data)
    } catch (err) {
      console.error('GET /api/signups error:', err.message)
      res.status(500).json({ error: 'Failed to fetch signups' })
    }
  })

  // GET /api/signups/admin — list signups with full details (requires API key)
  router.get('/admin', async (req, res) => {
    try {
      const { event_id, status } = req.query

      let query = supabase
        .from('signups')
        .select('*, pickup_events(name, address, day_of_week, start_time)')
        .order('created_at', { ascending: false })

      if (event_id) query = query.eq('event_id', event_id)
      if (status) query = query.eq('status', status)

      const { data, error } = await query
      if (error) throw error
      res.json(data)
    } catch (err) {
      console.error('GET /api/signups/admin error:', err.message)
      res.status(500).json({ error: 'Failed to fetch signups' })
    }
  })

  return router
}
