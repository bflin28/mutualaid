/**
 * Slack Socket Mode listener.
 *
 * Connects to Slack via WebSocket (no public URL needed).
 * - Saves ALL messages raw to slack_messages table
 * - Parses food rescue messages from monitored channels into food_logs
 * - Posts summary replies back to Slack threads
 */
import pkg from '@slack/bolt'
const { App } = pkg

import { processMessageText } from './slackParser.js'
import { loadLocations, resolveLocation } from './locationResolver.js'

export async function startSlackSocket(supabase) {
  const appToken = process.env.SLACK_APP_TOKEN
  const botToken = process.env.SLACK_BOT_TOKEN

  if (!appToken || !botToken) {
    console.warn('SLACK_APP_TOKEN or SLACK_BOT_TOKEN missing — Socket Mode disabled.')
    return
  }

  const boltApp = new App({
    token: botToken,
    appToken: appToken,
    socketMode: true,
  })

  // Listen to all messages in channels the bot is a member of
  boltApp.message(async ({ message, say }) => {
    // Skip bot messages and subtypes like message_changed, message_deleted
    if (message.bot_id || message.subtype) return
    if (!message.text) return

    try {
      await handleMessage(supabase, message, say)
    } catch (err) {
      console.error('Socket Mode message handler error:', err.message)
    }
  })

  await boltApp.start()
  console.log('Slack Socket Mode connected.')
}

async function handleMessage(supabase, message, say) {
  const text = message.text || ''
  const slackTs = message.ts
  const channel = message.channel
  const user = message.user || null

  // Step 1: Save raw message (all channels)
  const { error: rawError } = await supabase
    .from('slack_messages')
    .upsert({
      slack_ts: slackTs,
      slack_channel: channel,
      slack_user: user,
      subtype: message.subtype || null,
      thread_ts: message.thread_ts || null,
      raw_text: text,
      raw_json: message,
    }, {
      onConflict: 'slack_ts,slack_channel',
      ignoreDuplicates: true,
    })

  if (rawError) {
    console.error('Failed to save raw Slack message:', rawError.message)
  }

  // Step 2: Only parse food logs from configured channels
  const monitoredChannels = getMonitoredChannels()
  if (!monitoredChannels.includes(channel)) return
  if (!text.trim()) return

  // Step 3: Parse the message into food log records
  const records = processMessageText(text)
  if (records.length === 0) return

  // Step 4: Check for existing food_log with this slack_ts
  const { data: existing } = await supabase
    .from('food_logs')
    .select('id')
    .eq('slack_ts', slackTs)
    .maybeSingle()

  if (existing) return

  // Step 5: Try to resolve locations against DB locations
  const locations = await loadLocations(supabase)

  // Map channel → default drop-off when none is explicit
  const CHANNEL_DROP_OFF = {
    'C026VATTHDE': 'Urban Canopy',   // #urban-canopy-log
    'C031JSTNV6H': 'Keystone',       // #keystone-log
  }

  for (const record of records) {
    const dbLocation = resolveLocation(record.rescue_location_name, locations)

    // Infer drop-off from channel when parser didn't find one
    const dropOff = record.drop_off_location_name || CHANNEL_DROP_OFF[channel] || null

    const { data: log, error: logError } = await supabase
      .from('food_logs')
      .insert({
        rescue_location_id: dbLocation?.id || null,
        rescue_location_name: dbLocation?.name || record.rescue_location_name,
        drop_off_location_name: dropOff,
        rescued_at: new Date(parseFloat(slackTs) * 1000).toISOString(),
        rescued_by: user,
        items: record.items,
        total_estimated_lbs: record.total_estimated_lbs,
        record_type: record.record_type || 'rescue',
        classification: record.classification || null,
        source: 'slack',
        slack_ts: slackTs,
        slack_channel: channel,
        raw_text: text,
      })
      .select()
      .single()

    if (logError) {
      console.error('Failed to save food log:', logError.message)
      continue
    }

    // Link back to slack_messages
    await supabase
      .from('slack_messages')
      .update({
        is_food_log: true,
        food_log_id: log.id,
        processed_at: new Date().toISOString(),
      })
      .eq('slack_ts', slackTs)
      .eq('slack_channel', channel)

    // Post summary reply
    if (process.env.SLACK_POSTING_DISABLED !== 'true') {
      const summary = formatSummary(record)
      try {
        await say({ text: summary, thread_ts: slackTs })
      } catch (err) {
        console.error('Failed to post Slack summary:', err.message)
      }
    }
  }
}

function formatSummary(record) {
  const lines = []
  const loc = record.rescue_location_name

  if (record.record_type === 'inventory') {
    lines.push(`Logged inventory snapshot at *${loc || 'warehouse'}*:`)
  } else if (loc && loc !== 'Unknown') {
    lines.push(`Logged food rescue from *${loc}*:`)
  } else {
    lines.push('Logged food rescue:')
  }

  if (record.drop_off_location_name) {
    lines.push(`  Drop-off: *${record.drop_off_location_name}*`)
  }

  // Group by category
  const byCat = {}
  for (const item of record.items) {
    const cat = item.gcfd_category || 'Other'
    if (!byCat[cat]) byCat[cat] = { lbs: 0, items: [] }
    byCat[cat].lbs += item.estimated_lbs || 0
    byCat[cat].items.push(item)
  }

  for (const [cat, data] of Object.entries(byCat)) {
    lines.push(`  - ${cat}: ~${Math.round(data.lbs)} lbs (${data.items.length} items)`)
  }

  if (record.record_type === 'inventory') {
    lines.push(`*Total on hand: ~${Math.round(record.total_estimated_lbs)} lbs (${record.items.length} items)*`)
  } else {
    lines.push(`*Total: ~${Math.round(record.total_estimated_lbs)} lbs*`)
  }
  return lines.join('\n')
}

function getMonitoredChannels() {
  const csv = process.env.SLACK_WAREHOUSE_LOG_CHANNEL_IDS
    || process.env.SLACK_WAREHOUSE_LOG_CHANNEL_ID
    || process.env.WAREHOUSE_LOG_CHANNEL_ID
    || ''
  return csv.split(',').map(s => s.trim()).filter(Boolean)
}
