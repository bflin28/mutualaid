import { Router } from 'express'

export default function locationRoutes(supabase) {
  const router = Router()

  // GET /api/locations?type=rescue|drop_off|both
  router.get('/', async (req, res) => {
    try {
      let query = supabase
        .from('locations')
        .select('*')
        .eq('active', true)
        .order('name')

      if (req.query.type) {
        query = query.or(`type.eq.${req.query.type},type.eq.both`)
      }

      const { data, error } = await query
      if (error) throw error
      res.json(data)
    } catch (err) {
      console.error('GET /api/locations error:', err.message)
      res.status(500).json({ error: 'Failed to fetch locations' })
    }
  })

  return router
}
