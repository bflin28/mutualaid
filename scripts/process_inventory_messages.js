/**
 * Process unprocessed inventory messages from slack_messages into food_logs.
 *
 * The original backfill didn't have inventory detection, so messages like
 * "going into the weekend at Urban Canopy: * romaine * broccoli..."
 * were saved as raw slack_messages but never parsed into food_logs.
 *
 * This script finds those messages, runs them through the updated parser,
 * and creates food_log records for any that produce items.
 *
 * Safe to run multiple times (checks for existing food_logs by slack_ts).
 *
 * Usage: node scripts/process_inventory_messages.js
 */
import '../server/loadEnv.js'
import { createClient } from '@supabase/supabase-js'
import { processMessageText } from '../server/services/slackParser.js'
import { loadLocations, resolveLocation } from '../server/services/locationResolver.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const MONITORED_CHANNELS = (
  process.env.SLACK_WAREHOUSE_LOG_CHANNEL_IDS
  || process.env.SLACK_WAREHOUSE_LOG_CHANNEL_ID
  || process.env.WAREHOUSE_LOG_CHANNEL_ID
  || ''
).split(',').map(s => s.trim()).filter(Boolean)

async function run() {
  console.log('Monitored channels:', MONITORED_CHANNELS)

  // Load locations for resolving
  const locations = await loadLocations(supabase)
  console.log(`Loaded ${locations.length} locations from DB`)

  // Find unprocessed slack_messages from monitored channels
  const PAGE_SIZE = 500
  let offset = 0
  let totalProcessed = 0
  let totalCreated = 0
  let totalSkipped = 0
  let totalAlreadyExists = 0
  let totalErrors = 0

  while (true) {
    const { data: messages, error } = await supabase
      .from('slack_messages')
      .select('id, slack_ts, slack_channel, slack_user, raw_text')
      .in('slack_channel', MONITORED_CHANNELS)
      .eq('is_food_log', false)
      .not('raw_text', 'is', null)
      .order('slack_ts', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('Query error:', error.message)
      break
    }
    if (!messages || messages.length === 0) break

    for (const msg of messages) {
      totalProcessed++
      const text = msg.raw_text?.trim()
      if (!text) {
        totalSkipped++
        continue
      }

      // Parse the message
      const records = processMessageText(text)
      if (records.length === 0) {
        totalSkipped++
        continue
      }

      // Check if a food_log already exists for this slack_ts
      const { data: existing } = await supabase
        .from('food_logs')
        .select('id')
        .eq('slack_ts', msg.slack_ts)
        .maybeSingle()

      if (existing) {
        totalAlreadyExists++
        continue
      }

      // Create food_log records
      for (const record of records) {
        const dbLocation = resolveLocation(record.rescue_location_name, locations)

        const { data: log, error: logError } = await supabase
          .from('food_logs')
          .insert({
            rescue_location_id: dbLocation?.id || null,
            rescue_location_name: dbLocation?.name || record.rescue_location_name,
            drop_off_location_name: record.drop_off_location_name,
            rescued_at: new Date(parseFloat(msg.slack_ts) * 1000).toISOString(),
            rescued_by: msg.slack_user,
            items: record.items,
            total_estimated_lbs: record.total_estimated_lbs,
            record_type: record.record_type || 'rescue',
            classification: record.classification || null,
            source: 'slack',
            slack_ts: msg.slack_ts,
            slack_channel: msg.slack_channel,
            raw_text: text,
          })
          .select()
          .single()

        if (logError) {
          console.error(`  Error creating food_log for ts ${msg.slack_ts}:`, logError.message)
          totalErrors++
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
          .eq('slack_ts', msg.slack_ts)
          .eq('slack_channel', msg.slack_channel)

        totalCreated++
        const typeTag = record.record_type === 'inventory' ? '[INV]' : '[RES]'
        console.log(`  ${typeTag} ${record.rescue_location_name} | ${record.items.length} items | ${Math.round(record.total_estimated_lbs)} lbs | ${new Date(parseFloat(msg.slack_ts) * 1000).toISOString().substring(0, 10)}`)
      }
    }

    offset += messages.length
    if (messages.length < PAGE_SIZE) break
    console.log(`  Progress: ${totalProcessed} messages processed...`)
  }

  console.log('')
  console.log('=== Done ===')
  console.log(`Total messages checked: ${totalProcessed}`)
  console.log(`New food_logs created: ${totalCreated}`)
  console.log(`Skipped (no items): ${totalSkipped}`)
  console.log(`Already had food_log: ${totalAlreadyExists}`)
  console.log(`Errors: ${totalErrors}`)
}

run()
