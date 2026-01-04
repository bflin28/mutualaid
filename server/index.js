/* eslint-env node */
import './loadEnv.js'

import express from 'express'
import { randomUUID } from 'node:crypto'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import { normalizeFoodLogText } from './foodLogParser.js'
import { emptyTotals, formatNormalizedSummary, mergeTotals, postSlackMessage } from './slackUtils.js'
import { defaultWarehouseLogChannelId, isWarehouseLogChannel } from './slackChannelRegistry.js'
import {
  buildItemNotes,
  coerceDateInputToIso,
  previewWarehouseLogFromText,
  processWarehouseLogMessage,
  saveWarehouseLogDraft,
} from './warehouseLogPipeline.js'
import { addEstimatedWeights, calculateTotalWeight } from './itemWeightEstimator.js'

const app = express()
const PORT = process.env.PORT || 4000
const WAREHOUSE_LOG_TABLE = process.env.WAREHOUSE_LOG_TABLE || 'warehouse_logs'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const slackBotToken = process.env.SLACK_BOT_TOKEN
const slackChannelId = process.env.SLACK_PICKUP_ALERT_CHANNEL_ID || defaultWarehouseLogChannelId
const slackPostingDisabled = ['1', 'true', 'yes'].includes(String(process.env.SLACK_POSTING_DISABLED || '').toLowerCase())
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '15mb'

const dayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const parseCsvList = (value = '') => String(value || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)

const KNOWN_RESCUE_LOCATIONS = parseCsvList(
  process.env.WAREHOUSE_RESCUE_LOCATIONS
  || process.env.WAREHOUSE_RESCUE_LOCATIONS_CSV
  || '',
)

const normalizeItemKeyField = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ')
}

const normalizeLocationKey = (value) => normalizeItemKeyField(value)
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const knownLocationMap = new Map(
  KNOWN_RESCUE_LOCATIONS
    .map((loc) => [normalizeLocationKey(loc), loc])
    .filter(([key]) => key),
)

const looksTitleCased = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return false
  return words.every((word) => {
    const clean = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
    if (!clean) return true
    if (/^\d/.test(clean)) return true
    if (/^[A-Z0-9]{2,}$/.test(clean)) return true
    return /^[A-Z]/.test(clean)
  })
}

const titleCaseWords = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  return words.map((word) => {
    const clean = word.replace(/[^a-z0-9'-]/gi, '')
    if (!clean) return word
    if (clean.length <= 2) return clean.toUpperCase()
    return `${clean[0].toUpperCase()}${clean.slice(1).toLowerCase()}`
  }).join(' ')
}

const canonicalizeLocation = (value) => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  const key = normalizeLocationKey(trimmed)
  if (!key) return ''
  const known = knownLocationMap.get(key)
  if (known) return known
  return looksTitleCased(trimmed) ? trimmed : titleCaseWords(trimmed)
}

const inferRescueLocationFromText = (text = '') => {
  const input = String(text || '')
  if (!input.trim()) return ''

  const match = input.match(
    /(?:picked\s+up\s+from|rescued\s+from|rescue\s+from|pickup(?:ed)?\s+from|earlier\s+today\s+from|today\s+from)\s+(.+)/i,
  )
  if (!match) return ''

  let remainder = String(match[1] || '').trim()
  remainder = remainder.split(/\r?\n/)[0] || ''

  const colonIdx = remainder.indexOf(':')
  if (colonIdx >= 0) remainder = remainder.slice(0, colonIdx)

  const dashMatch = remainder.match(/\s[-–—]\s/)
  if (dashMatch?.index !== undefined) remainder = remainder.slice(0, dashMatch.index)

  remainder = remainder.replace(/[;,.]+$/, '').trim()
  return canonicalizeLocation(remainder)
}

const isNonFoodWarehouseItemName = (name = '') => {
  const normalized = normalizeItemKeyField(name)
  if (!normalized) return true
  return /^(picked\s+up\s+from|rescued\s+from|rescue\s+from|pickup(?:ed)?\s+from|dropped\s+off|drop\s+off|delivered\s+to)\b/i
    .test(normalized)
}

const dedupeWarehouseItems = (items = []) => {
  const seen = new Set()
  const deduped = []
  for (const item of Array.isArray(items) ? items : []) {
    const name = item.item_name || item.name || ''
    if (isNonFoodWarehouseItemName(name)) continue
    const key = [
      normalizeItemKeyField(name),
      item.quantity ?? '',
      normalizeItemKeyField(item.unit || item.container || ''),
      normalizeItemKeyField(item.notes || ''),
    ].join('|')
    if (!key || key === '|||') continue
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return deduped
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Supabase env vars missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the backend.')
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

app.use(cors())
app.use(express.json({ limit: jsonBodyLimit }))
app.use(express.urlencoded({ limit: jsonBodyLimit, extended: true }))

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    const formatBytes = (bytes) => {
      if (!Number.isFinite(bytes)) return 'unknown'
      const mb = bytes / (1024 * 1024)
      return `${bytes} bytes (~${mb.toFixed(2)} MB)`
    }
    const received = Number.isFinite(err.length) ? err.length : Number(req.headers['content-length'])
    const limit = Number.isFinite(err.limit) ? err.limit : null
    res.status(413).json({
      error: `Payload too large: received ${formatBytes(received)}, limit ${formatBytes(limit)}`,
    })
    return
  }
  next(err)
})

const parseTimeTo24h = (value) => {
  if (!value) return ''
  const main = value.split('-')[0].trim()
  const match = main.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i)
  if (!match) return ''
  let hours = parseInt(match[1], 10)
  const minutes = match[2] ? parseInt(match[2], 10) : 0
  const meridiem = (match[3] || '').toUpperCase()
  if (meridiem === 'PM' && hours !== 12) hours += 12
  if (meridiem === 'AM' && hours === 12) hours = 0
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return ''
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

const formatTime = (value) => {
  if (!value) return ''
  const [h, m] = value.split(':').map((v) => parseInt(v, 10))
  if (Number.isNaN(h) || Number.isNaN(m)) return value
  const hours12 = ((h + 11) % 12) + 1
  const ampm = h >= 12 ? 'PM' : 'AM'
  const paddedMinutes = m.toString().padStart(2, '0')
  return `${hours12}:${paddedMinutes} ${ampm}`
}

const fetchSlackHistory = async ({ channel, slackBotToken, limit = 20, oldest }) => {
  if (!slackBotToken || !channel) {
    return { messages: [], error: 'Slack bot token or channel id missing' }
  }

  const url = new URL('https://slack.com/api/conversations.history')
  url.searchParams.set('channel', channel)
  url.searchParams.set('limit', Math.min(Math.max(limit, 1), 200))
  if (oldest) url.searchParams.set('oldest', oldest)

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${slackBotToken}` },
    })
    const json = await resp.json()
    if (!json.ok) {
      return { messages: [], error: json.error || 'Slack history error' }
    }
    return { messages: json.messages || [], error: null }
  } catch (err) {
    return { messages: [], error: err.message || 'Failed to fetch Slack history' }
  }
}

const backfillWarehouseLogsFromSlack = async ({
  channelId,
  historyLimit = 20,
} = {}) => {
  const result = { inserted: 0, skipped: 0, errors: [] }
  if (!supabase) {
    result.errors.push('Supabase not configured')
    return result
  }
  if (!slackBotToken) {
    result.errors.push('Slack bot token missing')
    return result
  }
  if (!channelId) {
    result.errors.push('Slack channel id missing')
    return result
  }

  const { data: existingRows, error: existingErr } = await supabase
    .from(WAREHOUSE_LOG_TABLE)
    .select('slack_ts')
    .eq('slack_channel', channelId)

  if (existingErr) {
    result.errors.push(existingErr.message)
    return result
  }

  const existingTs = new Set((existingRows || []).map((row) => row.slack_ts).filter(Boolean))
  const { messages, error: historyErr } = await fetchSlackHistory({
    channel: channelId,
    slackBotToken,
    limit: historyLimit,
  })

  if (historyErr) {
    result.errors.push(historyErr)
    return result
  }

  const allowedSubtypes = [undefined, null, 'file_share']

  for (const msg of messages) {
    if (!msg?.ts || existingTs.has(msg.ts)) {
      result.skipped += 1
      continue
    }
    if (msg.bot_id || (msg.subtype && !allowedSubtypes.includes(msg.subtype))) {
      result.skipped += 1
      continue
    }

    const text = (msg.text || '').trim()
    const files = msg.files || []
    if (!text && files.length === 0) {
      result.skipped += 1
      continue
    }

    try {
      await processWarehouseLogMessage({
        event: {
          text,
          files,
          ts: msg.ts,
          user: msg.user,
          channel: channelId,
        },
        supabase,
        slackBotToken,
        slackPostingDisabled: true, // avoid backfill spam
      })
      result.inserted += 1
    } catch (err) {
      result.errors.push(err.message || 'Unknown backfill error')
    }
  }

  return result
}

const nextDateForDayOfWeek = (targetDow) => {
  if (typeof targetDow !== 'number') return null
  const today = new Date()
  const currentDow = today.getDay()
  const diff = (targetDow - currentDow + 7) % 7
  const target = new Date(today)
  target.setDate(today.getDate() + diff)
  target.setHours(0, 0, 0, 0)
  return target
}

const startDateForEvent = (row) => {
  const dateStr = row.occurrence_date
  let startDate
  if (dateStr) {
    startDate = new Date(`${dateStr}T00:00:00`)
  } else {
    const dow = typeof row.day_of_week === 'number'
      ? row.day_of_week
      : (() => {
        const matchIdx = dayOrder.findIndex((d) => (row.day || '').toLowerCase() === d.toLowerCase())
        return matchIdx >= 0 ? matchIdx : null
      })()
    if (dow === null || dow === undefined) return null
    startDate = nextDateForDayOfWeek(dow)
  }

  const time = row.start_time || parseTimeTo24h(row.time) || '00:00'
  const [h, m] = time.split(':')
  startDate.setHours(Number(h) || 0, Number(m) || 0, 0, 0)
  return startDate
}

const resolveOccurrenceDate = (payload = {}) => {
  if (payload.occurrence_date) return payload.occurrence_date
  if (payload.occurrenceDate) return payload.occurrenceDate
  if (payload.day_date_key) return payload.day_date_key

  const dayStr = payload.day
  if (!dayStr) return null
  const dow = dayOrder.findIndex((d) => d.toLowerCase() === String(dayStr).toLowerCase())
  if (dow < 0) return null
  const nextDate = nextDateForDayOfWeek(dow)
  if (!nextDate) return null
  const iso = nextDate.toISOString().slice(0, 10)
  return iso
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

// Warehouse logs with item rows for frontend consumption
app.get('/api/warehouse/logs', async (req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const shouldBackfill = ['1', 'true', 'yes'].includes(String(req.query.backfill || '').toLowerCase())
  if (shouldBackfill) {
    const historyLimit = Math.min(Math.max(Number(req.query.history_limit) || 20, 1), 200)
    const channelId = req.query.channel || defaultWarehouseLogChannelId
    const backfillResult = await backfillWarehouseLogsFromSlack({ channelId, historyLimit })
    if (backfillResult.errors.length) {
      console.warn('Warehouse log backfill issues:', backfillResult.errors)
    } else if (backfillResult.inserted > 0) {
      console.log(`Warehouse log backfill inserted ${backfillResult.inserted} message(s), skipped ${backfillResult.skipped}`)
    }
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)

  const { data, error } = await supabase
    .from(WAREHOUSE_LOG_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const cleaned = (data || []).map((row) => ({
    ...row,
    location: (row.location && String(row.location).trim())
      ? row.location
      : inferRescueLocationFromText(row.raw_text || '') || row.location,
    items: dedupeWarehouseItems(row.items || []),
  }))

  res.json({ data: cleaned })
})

app.post('/api/warehouse/logs/preview', async (req, res) => {
  const text = (req.body?.text || '').trim()
  if (!text) {
    res.status(400).json({ error: 'text is required' })
    return
  }

  try {
    const draft = await previewWarehouseLogFromText({ text, slackBotToken })
    res.json({ data: draft })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to parse warehouse log' })
  }
})

app.post('/api/warehouse/logs', async (req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const body = req.body || {}
  const text = (body.text || body.raw_text || '').trim()
  if (!text) {
    res.status(400).json({ error: 'text is required' })
    return
  }
  const inlineImages = Array.isArray(body.images) ? body.images.slice(0, 3) : []

  const draft = {
    draftId: body.draftId || body.draft_id || null,
    raw_text: text,
    location: body.location || '',
    drop_off_location: body.drop_off_location || body.dropOffLocation || '',
    rescued_at: body.rescued_at || body.rescuedAt || body.rescued_date || '',
    items: Array.isArray(body.items) ? body.items : [],
  }

  try {
    const result = await saveWarehouseLogDraft({
      supabase,
      draft,
      channelName: 'Manual entry',
      inlineImages,
    })

    if (result.supabaseResult?.error) {
      res.status(500).json({ error: result.supabaseResult.error.message || 'Failed to save log' })
      return
    }

    res.json({
      data: {
        log: result.headerRow || result.payload,
        items: result.itemResult?.data || [],
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to save warehouse log' })
  }
})

app.put('/api/warehouse/logs/:id/items', async (req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const { id } = req.params
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const rescuedAtIso = coerceDateInputToIso(req.body?.rescued_at || req.body?.rescuedAt || req.body?.rescued_date)
  if (!id) {
    res.status(400).json({ error: 'log id is required' })
    return
  }

  try {
    // Format items for JSONB storage
    const itemsJson = items
      .filter((item) => (item.item_name || item.name || '').trim())
      .map((item) => ({
        name: item.item_name || item.name || '',
        quantity: item.quantity ?? null,
        unit: item.unit || '',
        estimated_lbs: item.pounds ?? item.estimated_lbs ?? null,
        subcategory: item.subcategory || null,
        notes: item.notes || null,
        sources: item.sources || null,
      }))

    // Build update payload
    const updatePayload = { items: itemsJson }
    if (rescuedAtIso) {
      updatePayload.rescued_at = rescuedAtIso
      updatePayload.created_at = rescuedAtIso
    }

    const updateResult = await supabase
      .from(WAREHOUSE_LOG_TABLE)
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (updateResult.error) {
      res.status(500).json({ error: updateResult.error.message || 'Failed to update log' })
      return
    }

    res.json({ data: { items: itemsJson, rescued_at: updateResult.data?.rescued_at || rescuedAtIso || null } })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update items' })
  }
})

app.post('/api/food-log/normalize', (req, res) => {
  const { text } = req.body || {}
  if (!text || !String(text).trim()) {
    res.status(400).json({ error: 'text is required' })
    return
  }

  const normalized = normalizeFoodLogText(text)
  res.json({ data: normalized })
})

app.post('/api/slack/events', async (req, res) => {
  if (!slackBotToken && !slackPostingDisabled) {
    res.status(400).json({ error: 'Slack bot token missing on server' })
    return
  }

  const payload = req.body || {}

  if (payload.type === 'url_verification' && payload.challenge) {
    res.send(payload.challenge)
    return
  }

  const event = payload.event || {}
  if (event.type !== 'message') {
    res.json({ ok: true, skipped: 'non-message event' })
    return
  }

  if (event.bot_id || event.bot_profile) {
    res.json({ ok: true, skipped: 'bot/system message' })
    return
  }

  const allowedSubtypes = [undefined, null, 'file_share']
  if (event.subtype && !allowedSubtypes.includes(event.subtype)) {
    res.json({ ok: true, skipped: `ignored subtype ${event.subtype}` })
    return
  }

  const isWarehouseChannel = isWarehouseLogChannel(event.channel)

  if (!isWarehouseChannel) {
    res.json({ ok: true, skipped: 'different channel' })
    return
  }

  const text = (event.text || event.message?.text || '').trim()
  const hasAttachments = (event.files || event.message?.files || []).length > 0

  if (isWarehouseChannel) {
    res.json({ ok: true, accepted: true, pipeline: 'warehouse-log' })
    processWarehouseLogMessage({
      event,
      supabase,
      slackBotToken,
      slackPostingDisabled,
    }).catch((err) => {
      console.error('Warehouse log pipeline failed:', err)
    })
    return
  }

  if (!text && !hasAttachments) {
    res.json({ ok: true, skipped: 'empty text' })
    return
  }

  const normalized = normalizeFoodLogText(text)
  const summary = formatNormalizedSummary(normalized)
  if (!summary) {
    res.json({ ok: true, parsed: 0, unparsed: normalized.unparsed.length })
    return
  }

  if (slackPostingDisabled) {
    res.json({
      ok: true,
      parsed: normalized.items.length,
      unparsed: normalized.unparsed.length,
      postingDisabled: true,
      summary,
    })
    return
  }

  const postResult = await postSlackMessage({
    slackBotToken,
    channel: event.channel,
    text: summary,
    threadTs: event.ts,
  })

  if (!postResult.ok) {
    res.status(500).json({ error: postResult.error?.message || 'Failed to post to Slack' })
    return
  }

  res.json({
    ok: true,
    parsed: normalized.items.length,
    unparsed: normalized.unparsed.length,
  })
})

app.get('/api/slack/normalize-history', async (req, res) => {
  if (!slackBotToken) {
    res.status(400).json({ error: 'Slack bot token missing on server' })
    return
  }

  const channel = req.query.channel || defaultWarehouseLogChannelId || slackChannelId
  if (!channel) {
    res.status(400).json({ error: 'Slack channel id missing. Provide ?channel= or set a default in slackChannelRegistry.' })
    return
  }

  if (!isFoodLogChannel(channel)) {
    res.status(403).json({ error: 'Channel not allowed for normalization.' })
    return
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200)
  const url = new URL('https://slack.com/api/conversations.history')
  url.searchParams.set('channel', channel)
  url.searchParams.set('limit', limit)
  if (req.query.oldest) url.searchParams.set('oldest', req.query.oldest)

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${slackBotToken}` },
    })
    const json = await resp.json()
    if (!json.ok) {
      res.status(500).json({ error: json.error || 'Slack history error' })
      return
    }

    const messages = (json.messages || []).filter((msg) => !msg.subtype && (msg.text || '').trim())
    const normalizedMessages = messages.map((msg) => {
      const parsed = normalizeFoodLogText(msg.text || '')
      return {
        ts: msg.ts,
        user: msg.user,
        text: msg.text,
        ...parsed,
      }
    })

    const totals = normalizedMessages.reduce(
      (acc, msg) => mergeTotals(acc, msg.totals || emptyTotals()),
      emptyTotals(),
    )

    res.json({
      data: {
        channel,
        messageCount: normalizedMessages.length,
        totals,
        messages: normalizedMessages,
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch Slack history' })
  }
})

app.get('/api/events', async (_req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const { data, error } = await supabase
    .from('pickup_events')
    .select()
    .eq('status', 'approved')
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const { data: approvedSignups } = await supabase
    .from('pickup_signups')
    .select('slot_key, occurrence_date, volunteer_name')
    .eq('status', 'approved')

  const filledMap = new Map()
  approvedSignups?.forEach((row) => {
    const key = `${row.slot_key}::${row.occurrence_date || 'undated'}`
    filledMap.set(key, (filledMap.get(key) || 0) + 1)
  })

  const hydrated = (data || []).map((row) => {
    const filledCountsByDate = {}
    filledMap.forEach((count, mapKey) => {
      const [slotKey, dateKey] = mapKey.split('::')
      if (slotKey === row.id) {
          filledCountsByDate[dateKey] = count
      }
    })
    return {
      ...row,
      filled_counts_by_date: filledCountsByDate,
      assigned: false,
      assignee: '',
    }
  })

  res.json({ data: hydrated })
})

app.post('/api/events', async (req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const payload = req.body || {}
  if (!payload.name || !payload.start_time || !payload.address || (!payload.day_of_week && payload.day_of_week !== 0) || !payload.notes) {
    res.status(400).json({ error: 'Missing required fields: name, start_time, address, day_of_week, notes' })
    return
  }

  const response = await supabase
    .from('pickup_events')
    .insert({
      ...payload,
      status: payload.status || 'approved',
    })
    .select()

  if (response.error) {
    res.status(500).json({ error: response.error.message })
    return
  }

  res.json({ data: response.data })
})

app.post('/api/signup', async (req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const payload = req.body || {}
  if (!payload.store || !payload.volunteer_email || !payload.day || !payload.time) {
    res.status(400).json({ error: 'Missing required fields: store, day, time, volunteer_email' })
    return
  }

  const occurrenceDate = resolveOccurrenceDate(payload)
  const insertPayload = {
    ...payload,
    occurrence_date: occurrenceDate,
  }

  const response = await supabase
    .from('pickup_signups')
    .insert({
      ...insertPayload,
      status: 'pending',
    })
    .select()

  if (response.error) {
    res.status(500).json({ error: response.error.message })
    return
  }

  res.json({ data: response.data })
})

app.get('/api/signups', async (req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const { status } = req.query
  let query = supabase.from('pickup_signups').select().order('created_at', { ascending: true })
  if (status) {
    query = query.eq('status', status)
  }
  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data })
})

app.post('/api/signups/:id/status', async (req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const { id } = req.params
  const { status } = req.body || {}
  if (!status) {
    res.status(400).json({ error: 'Status is required' })
    return
  }

  const response = await supabase
    .from('pickup_signups')
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select()

  if (response.error) {
    res.status(500).json({ error: response.error.message })
    return
  }

  // Best-effort: update event assignment state when a signup is approved/declined
  // Per-day filled counts are computed dynamically; no event mutation needed here

  res.json({ data: response.data })
})

app.post('/api/accounts/:id/role', async (req, res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const { id } = req.params
  const { role } = req.body || {}
  if (!role) {
    res.status(400).json({ error: 'Role is required' })
    return
  }

  const response = await supabase
    .from('pickup_accounts')
    .update({ role })
    .eq('id', id)
    .select()

  if (response.error) {
    res.status(500).json({ error: response.error.message })
    return
  }

  res.json({ data: response.data })
})

app.post('/api/slack/test', async (_req, res) => {
  if (!slackBotToken || !slackChannelId) {
    res.status(400).json({ error: 'Slack bot token or channel id missing on server' })
    return
  }
  if (!supabase) {
    res.status(500).json({ error: 'Supabase not configured' })
    return
  }

  const { data: events, error } = await supabase
    .from('pickup_events')
    .select()
    .eq('status', 'approved')

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const now = new Date()
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const upcomingUnfilled = (events || [])
    .filter((row) => !row.assigned)
    .map((row) => ({
      row,
      startDate: startDateForEvent(row),
    }))
    .filter(({ startDate }) => startDate && startDate >= now && startDate <= soon)

  if (upcomingUnfilled.length === 0) {
    res.json({ data: { sent: 0, message: 'No unfilled spots in the next 24 hours.' } })
    return
  }

  const lines = upcomingUnfilled.map(({ row, startDate }) => {
    const capacity = Number(row.capacity) || 1
    const filledCount = row.assigned ? 1 : 0
    const dateStr = startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    const timeStr = formatTime(row.start_time || parseTimeTo24h(row.time) || '')
    return `• ${row.name || row.store || 'Pickup'} — ${dateStr} at ${timeStr || 'time TBD'} (${filledCount} of ${capacity} filled)`
  })

  const payload = {
    channel: slackChannelId,
    text: `Unfilled pickups within 24 hours:\n${lines.join('\n')}`,
  }

  try {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${slackBotToken}`,
      },
      body: JSON.stringify(payload),
    })
    const json = await resp.json()
    if (!json.ok) {
      throw new Error(json.error || 'Slack API error')
    }
    res.json({ data: { sent: upcomingUnfilled.length } })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to send Slack alert' })
  }
})

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`)
})
