import { Router } from 'express'

export default function slackMessageRoutes(supabase) {
  const router = Router()

  // GET /api/slack-messages — list raw messages with pagination
  router.get('/', async (req, res) => {
    try {
      const { limit = 50, offset = 0, channel, is_food_log } = req.query

      let query = supabase
        .from('slack_messages')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1)

      if (channel) query = query.eq('slack_channel', channel)
      if (is_food_log !== undefined) query = query.eq('is_food_log', is_food_log === 'true')

      const { data, count, error } = await query
      if (error) throw error
      res.json({ data, total: count })
    } catch (err) {
      console.error('GET /api/slack-messages error:', err.message)
      res.status(500).json({ error: 'Failed to fetch slack messages' })
    }
  })

  // GET /api/slack-messages/stats — message volume summary
  router.get('/stats', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('slack_messages')
        .select('slack_channel, is_food_log')

      if (error) throw error

      const total = data.length
      const parsed = data.filter(m => m.is_food_log).length
      const unparsed = total - parsed

      const byChannel = {}
      for (const m of data) {
        const ch = m.slack_channel
        if (!byChannel[ch]) byChannel[ch] = { channel: ch, total: 0, parsed: 0 }
        byChannel[ch].total++
        if (m.is_food_log) byChannel[ch].parsed++
      }

      res.json({ total, parsed, unparsed, byChannel: Object.values(byChannel) })
    } catch (err) {
      console.error('GET /api/slack-messages/stats error:', err.message)
      res.status(500).json({ error: 'Failed to fetch message stats' })
    }
  })

  return router
}
