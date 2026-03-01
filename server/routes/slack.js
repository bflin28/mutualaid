import { Router } from 'express'
import { loadCategories, addCategoryAndWeight } from '../services/categoryDetector.js'
import { loadLocations, inferLocationFromText } from '../services/locationResolver.js'

export default function slackRoutes(supabase) {
  const router = Router()

  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
  const WAREHOUSE_CHANNEL_IDS = getChannelIds()

  // POST /api/slack/events — Slack event webhook
  router.post('/events', async (req, res) => {
    const body = req.body

    // URL verification challenge
    if (body.type === 'url_verification') {
      return res.json({ challenge: body.challenge })
    }

    // Acknowledge immediately
    res.status(200).json({ ok: true })

    // Process event asynchronously
    const event = body.event
    if (!event || event.bot_id || event.subtype === 'bot_message') return
    if (!event.text) return

    const channel = event.channel
    if (!WAREHOUSE_CHANNEL_IDS.includes(channel)) return

    try {
      await processSlackMessage(supabase, event)
    } catch (err) {
      console.error('Slack event processing error:', err.message)
    }
  })

  // GET /api/food-categories — exposed for frontend
  router.get('/food-categories', async (_req, res) => {
    try {
      const categories = await loadCategories(supabase)
      res.json(categories)
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch categories' })
    }
  })

  return router
}

async function processSlackMessage(supabase, event) {
  const text = event.text || ''
  const slackTs = event.ts
  const channel = event.channel

  // Check for duplicate
  const { data: existing } = await supabase
    .from('food_logs')
    .select('id')
    .eq('slack_ts', slackTs)
    .maybeSingle()

  if (existing) return

  const [categories, locations] = await Promise.all([
    loadCategories(supabase),
    loadLocations(supabase),
  ])

  // Infer location from message
  const location = inferLocationFromText(text, locations)

  // Parse items from text
  const items = parseItemsFromText(text)
  const enrichedItems = addCategoryAndWeight(items, categories)
  const totalLbs = enrichedItems.reduce((sum, item) => sum + (item.estimated_lbs || 0), 0)

  // Save to food_logs
  const { data: log, error } = await supabase
    .from('food_logs')
    .insert({
      rescue_location_id: location?.id || null,
      rescue_location_name: location?.name || 'Unknown',
      rescued_at: new Date(parseFloat(slackTs) * 1000).toISOString(),
      items: enrichedItems,
      total_estimated_lbs: Math.round(totalLbs * 10) / 10,
      source: 'slack',
      slack_ts: slackTs,
      slack_channel: channel,
      raw_text: text,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to save Slack food log:', error.message)
    return
  }

  // Post summary back to Slack thread
  if (process.env.SLACK_POSTING_DISABLED !== 'true' && process.env.SLACK_BOT_TOKEN) {
    const summary = formatSlackSummary(enrichedItems, totalLbs, location?.name)
    await postSlackMessage(channel, summary, slackTs)
  }
}

function parseItemsFromText(text) {
  const lines = text.split('\n').filter(l => l.trim())
  const items = []

  for (const line of lines) {
    const trimmed = line.replace(/^[-•*✓☐\s]+/, '').trim()
    if (!trimmed) continue

    const match = trimmed.match(/^~?(\d+\.?\d*)\s*(cases?|boxes?|bags?|bins?|lbs?|pounds?|pallets?|crates?|flats?|items?|dozen|each|gallons?|packages?|cans?)\s+(?:of\s+)?(.+)/i)

    if (match) {
      items.push({
        name: match[3].trim(),
        quantity: parseFloat(match[1]),
        unit: match[2].toLowerCase(),
      })
    }
  }

  return items
}

function formatSlackSummary(items, totalLbs, locationName) {
  const lines = []
  if (locationName) {
    lines.push(`Logged food rescue from *${locationName}*:`)
  } else {
    lines.push('Logged food rescue:')
  }

  // Group by category
  const byCat = {}
  for (const item of items) {
    const cat = item.gcfd_category || 'Other'
    if (!byCat[cat]) byCat[cat] = { lbs: 0, items: [] }
    byCat[cat].lbs += item.estimated_lbs || 0
    byCat[cat].items.push(item)
  }

  for (const [cat, data] of Object.entries(byCat)) {
    lines.push(`  - ${cat}: ~${Math.round(data.lbs)} lbs (${data.items.length} items)`)
  }

  lines.push(`*Total: ~${Math.round(totalLbs)} lbs*`)
  return lines.join('\n')
}

async function postSlackMessage(channel, text, threadTs) {
  try {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text,
        thread_ts: threadTs,
      }),
    })
    const data = await resp.json()
    if (!data.ok) console.error('Slack post error:', data.error)
  } catch (err) {
    console.error('Failed to post Slack message:', err.message)
  }
}

function getChannelIds() {
  const ids = []
  const csv = process.env.SLACK_WAREHOUSE_LOG_CHANNEL_IDS
    || process.env.SLACK_WAREHOUSE_LOG_CHANNEL_ID
    || process.env.WAREHOUSE_LOG_CHANNEL_ID
    || process.env.SLACK_PICKUP_ALERT_CHANNEL_ID
    || ''
  for (const id of csv.split(',')) {
    const trimmed = id.trim()
    if (trimmed) ids.push(trimmed)
  }
  return ids
}
