/**
 * Backfill script — two phases:
 *
 * Phase 1: Import historical records from slack_history_parsed.jsonl into food_logs
 * Phase 2: Fetch recent Slack messages via API (after last JSONL record) and process them
 *
 * Usage: node scripts/backfill.js
 */
import '../server/loadEnv.js'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { processMessageText } from '../server/services/slackParser.js'
import { loadLocations, resolveLocation } from '../server/services/locationResolver.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
)

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const CHANNEL_IDS = (process.env.SLACK_WAREHOUSE_LOG_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean)

// ============================================================
// Phase 1: Import historical JSONL
// ============================================================
async function importHistorical() {
  console.log('\n=== Phase 1: Importing historical JSONL ===')

  let lines
  try {
    const content = readFileSync('slack_history_parsed.jsonl', 'utf-8')
    lines = content.trim().split('\n').filter(Boolean)
  } catch (err) {
    console.log('No slack_history_parsed.jsonl found, skipping Phase 1')
    return null
  }

  console.log(`Found ${lines.length} records to import`)

  let imported = 0
  let skipped = 0
  let errors = 0
  let lastDate = null
  const BATCH_SIZE = 50

  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    const batch = lines.slice(i, i + BATCH_SIZE).map(line => {
      const record = JSON.parse(line)
      return {
        rescue_location_name: record.rescue_location_name || 'Unknown',
        drop_off_location_name: record.drop_off_location_name || null,
        rescued_at: record.rescued_at,
        rescued_by: record.rescued_by || null,
        items: record.items || [],
        total_estimated_lbs: record.total_estimated_lbs || 0,
        notes: record.notes || null,
        source: 'import',
        slack_ts: record.slack_ts || null,
        slack_channel: record.slack_channel || null,
        raw_text: record.raw_text || null,
      }
    })

    const { data, error } = await supabase
      .from('food_logs')
      .upsert(batch, {
        onConflict: 'slack_ts',
        ignoreDuplicates: true,
      })

    if (error) {
      // Try one by one for better error handling
      for (const record of batch) {
        const { error: singleError } = await supabase
          .from('food_logs')
          .insert(record)

        if (singleError) {
          if (singleError.code === '23505') {
            skipped++
          } else {
            errors++
            if (errors <= 5) console.error('  Insert error:', singleError.message)
          }
        } else {
          imported++
        }
      }
    } else {
      imported += batch.length
    }

    // Track last date
    const lastRecord = JSON.parse(lines[Math.min(i + BATCH_SIZE - 1, lines.length - 1)])
    lastDate = lastRecord.rescued_at

    if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= lines.length) {
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, lines.length)}/${lines.length} (${imported} imported, ${skipped} dupes, ${errors} errors)`)
    }
  }

  console.log(`Phase 1 complete: ${imported} imported, ${skipped} duplicates, ${errors} errors`)
  console.log(`Last record date: ${lastDate}`)
  return lastDate
}

// ============================================================
// Phase 2: Fetch recent Slack messages via API
// ============================================================
async function fetchRecentMessages(oldestDate) {
  console.log('\n=== Phase 2: Fetching recent Slack messages ===')

  if (!BOT_TOKEN) {
    console.log('No SLACK_BOT_TOKEN configured, skipping Phase 2')
    return
  }

  if (CHANNEL_IDS.length === 0) {
    console.log('No SLACK_WAREHOUSE_LOG_CHANNEL_IDS configured, skipping Phase 2')
    return
  }

  // Convert date to Slack timestamp (seconds since epoch)
  const oldestTs = oldestDate
    ? String(new Date(oldestDate).getTime() / 1000)
    : String(new Date('2025-12-01').getTime() / 1000) // default fallback

  console.log(`Fetching messages after: ${oldestDate || '2025-12-01'}`)

  const locations = await loadLocations(supabase)
  let totalMessages = 0
  let totalParsed = 0
  let totalSaved = 0

  for (const channelId of CHANNEL_IDS) {
    console.log(`\nChannel: ${channelId}`)
    let cursor = undefined
    let channelMessages = 0

    while (true) {
      const params = new URLSearchParams({
        channel: channelId,
        oldest: oldestTs,
        limit: '200',
        inclusive: 'false',
      })
      if (cursor) params.set('cursor', cursor)

      const resp = await fetch(`https://slack.com/api/conversations.history?${params}`, {
        headers: { 'Authorization': `Bearer ${BOT_TOKEN}` },
      })
      const data = await resp.json()

      if (!data.ok) {
        console.error(`  Slack API error: ${data.error}`)
        break
      }

      const messages = data.messages || []
      console.log(`  Fetched ${messages.length} messages`)

      for (const msg of messages) {
        // Skip bot messages and subtypes
        if (msg.bot_id || msg.subtype) continue
        if (!msg.text) continue

        totalMessages++
        channelMessages++

        // Save raw message to slack_messages
        const { error: rawError } = await supabase
          .from('slack_messages')
          .upsert({
            slack_ts: msg.ts,
            slack_channel: channelId,
            slack_user: msg.user || null,
            subtype: msg.subtype || null,
            thread_ts: msg.thread_ts || null,
            raw_text: msg.text,
            raw_json: msg,
          }, {
            onConflict: 'slack_ts,slack_channel',
            ignoreDuplicates: true,
          })

        if (rawError) {
          console.error('  Raw save error:', rawError.message)
        }

        // Parse food rescue data
        const records = processMessageText(msg.text)
        if (records.length === 0) continue

        totalParsed++

        // Check for existing food_log
        const { data: existing } = await supabase
          .from('food_logs')
          .select('id')
          .eq('slack_ts', msg.ts)
          .maybeSingle()

        if (existing) continue

        for (const record of records) {
          const dbLocation = resolveLocation(record.rescue_location_name, locations)

          const { data: log, error: logError } = await supabase
            .from('food_logs')
            .insert({
              rescue_location_id: dbLocation?.id || null,
              rescue_location_name: dbLocation?.name || record.rescue_location_name,
              drop_off_location_name: record.drop_off_location_name,
              rescued_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
              rescued_by: msg.user || null,
              items: record.items,
              total_estimated_lbs: record.total_estimated_lbs,
              record_type: record.record_type || 'rescue',
              classification: record.classification || null,
              source: 'slack',
              slack_ts: msg.ts,
              slack_channel: channelId,
              raw_text: msg.text,
            })
            .select()
            .single()

          if (logError) {
            if (logError.code !== '23505') { // not a dupe
              console.error('  Food log error:', logError.message)
            }
            continue
          }

          totalSaved++

          // Link slack_message to food_log
          await supabase
            .from('slack_messages')
            .update({
              is_food_log: true,
              food_log_id: log.id,
              processed_at: new Date().toISOString(),
            })
            .eq('slack_ts', msg.ts)
            .eq('slack_channel', channelId)
        }
      }

      // Pagination
      if (data.has_more && data.response_metadata?.next_cursor) {
        cursor = data.response_metadata.next_cursor
        // Rate limit: Slack allows ~50 req/min for conversations.history
        await new Promise(r => setTimeout(r, 1200))
      } else {
        break
      }
    }

    console.log(`  Channel total: ${channelMessages} messages`)
  }

  console.log(`\nPhase 2 complete: ${totalMessages} messages fetched, ${totalParsed} had food data, ${totalSaved} new food logs saved`)
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('Starting backfill...')

  // Verify DB connection
  const { count, error } = await supabase.from('locations').select('*', { count: 'exact', head: true })
  if (error) {
    console.error('DB connection failed:', error.message)
    process.exit(1)
  }
  console.log(`DB connected. ${count} locations in database.`)

  const lastDate = await importHistorical()
  await fetchRecentMessages(lastDate)

  // Summary
  const { count: foodLogCount } = await supabase.from('food_logs').select('*', { count: 'exact', head: true })
  const { count: slackMsgCount } = await supabase.from('slack_messages').select('*', { count: 'exact', head: true })

  console.log(`\n=== Done ===`)
  console.log(`food_logs: ${foodLogCount} total records`)
  console.log(`slack_messages: ${slackMsgCount} total records`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
