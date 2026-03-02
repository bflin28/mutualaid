/* eslint-env node */
import './loadEnv.js'

import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'

import locationRoutes from './routes/locations.js'
import foodLogRoutes from './routes/foodLogs.js'
import eventRoutes from './routes/events.js'
import signupRoutes from './routes/signups.js'
import slackRoutes from './routes/slack.js'
import slackMessageRoutes from './routes/slackMessages.js'
import { startSlackSocket } from './services/slackSocket.js'

const app = express()
const PORT = process.env.PORT || 4000

// Middleware
app.use(cors())
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '15mb' }))

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
let supabase = null

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey)
  console.log('Supabase connected.')
} else {
  console.warn('Supabase env vars missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
}

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Food categories (simple read endpoint)
app.get('/api/food-categories', async (_req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Database not configured' })
    const { data, error } = await supabase
      .from('food_categories')
      .select('*')
      .order('sort_order')
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' })
  }
})

// Route modules
if (supabase) {
  app.use('/api/locations', locationRoutes(supabase))
  app.use('/api/food-logs', foodLogRoutes(supabase))
  app.use('/api/events', eventRoutes(supabase))
  app.use('/api/signups', signupRoutes(supabase))
  app.use('/api/slack', slackRoutes(supabase))
  app.use('/api/slack-messages', slackMessageRoutes(supabase))

  // Start Slack Socket Mode listener (runs alongside Express)
  startSlackSocket(supabase).catch(err => {
    console.error('Slack Socket Mode failed to start:', err.message)
  })
} else {
  // Fallback: return 503 for all API routes when no DB
  app.use('/api', (_req, res) => {
    res.status(503).json({ error: 'Database not configured' })
  })
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
