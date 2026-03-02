/* eslint-env node */
import './loadEnv.js'

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createClient } from '@supabase/supabase-js'

import locationRoutes from './routes/locations.js'
import foodLogRoutes from './routes/foodLogs.js'
import eventRoutes from './routes/events.js'
import signupRoutes from './routes/signups.js'
import { startSlackSocket } from './services/slackSocket.js'

const app = express()
const PORT = process.env.PORT || 4000

// Security middleware
app.use(helmet())
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
}))
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
}))
app.use(express.json({ limit: '1mb' }))

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

// Route modules
if (supabase) {
  // Public read routes (no API key needed)
  app.use('/api/locations', locationRoutes(supabase))
  app.use('/api/food-logs', foodLogRoutes(supabase))
  app.use('/api/events', eventRoutes(supabase))
  app.use('/api/signups', signupRoutes(supabase))

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
