/**
 * Reclassify existing food_logs records.
 *
 * Re-parses all food_logs with raw_text through the updated parser
 * to fix record_type, classification, rescue_location_name, and drop_off_location_name.
 *
 * Uses channel-based drop-off fallback (same logic as slackSocket.js).
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage: node scripts/reclassify.js
 */
import '../server/loadEnv.js'
import { createClient } from '@supabase/supabase-js'
import { classifyMessage } from '../server/services/slackParser.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Same channel → drop-off mapping as slackSocket.js
const CHANNEL_DROP_OFF = {
  'C026VATTHDE': 'Urban Canopy',   // #urban-canopy-log
  'C031JSTNV6H': 'Keystone',       // #keystone-log
}

async function fetchAllWithRawText() {
  const PAGE_SIZE = 1000
  const all = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('food_logs')
      .select('id, raw_text, record_type, classification, rescue_location_name, drop_off_location_name, slack_channel')
      .not('raw_text', 'is', null)
      .order('rescued_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    offset += data.length
    if (data.length < PAGE_SIZE) break
  }

  return all
}

async function run() {
  console.log('Fetching food_logs with raw_text...')

  const logs = await fetchAllWithRawText()
  console.log(`Found ${logs.length} records with raw_text`)

  let updated = 0
  let unchanged = 0
  let errors = 0
  const changes = []

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i]
    if (!log.raw_text?.trim()) {
      unchanged++
      continue
    }

    const { rescueLocation, dropOffLocation, classification } = classifyMessage(log.raw_text)
    const newRecordType = classification === 'inventory' ? 'inventory' : 'rescue'

    // Apply channel-based drop-off fallback (same as slackSocket.js)
    const newDropOff = dropOffLocation || CHANNEL_DROP_OFF[log.slack_channel] || null

    const currentRecordType = log.record_type || 'rescue'

    // Check if anything changed
    const rescueChanged = rescueLocation && rescueLocation !== log.rescue_location_name
    const dropChanged = newDropOff && newDropOff !== log.drop_off_location_name
    const classChanged = classification !== log.classification
    const typeChanged = currentRecordType !== newRecordType

    if (!rescueChanged && !dropChanged && !classChanged && !typeChanged) {
      unchanged++
      continue
    }

    const updates = {}
    if (typeChanged) updates.record_type = newRecordType
    if (classChanged) updates.classification = classification
    if (rescueChanged) updates.rescue_location_name = rescueLocation
    if (dropChanged) updates.drop_off_location_name = newDropOff

    // Log significant location changes
    if (rescueChanged || dropChanged) {
      const firstLine = log.raw_text.split('\n')[0].slice(0, 80)
      changes.push({
        firstLine,
        oldRescue: log.rescue_location_name,
        newRescue: rescueLocation,
        oldDrop: log.drop_off_location_name,
        newDrop: newDropOff,
      })
    }

    const { error: updateError } = await supabase
      .from('food_logs')
      .update(updates)
      .eq('id', log.id)

    if (updateError) {
      console.error(`  Error updating ${log.id}:`, updateError.message)
      errors++
    } else {
      updated++
    }

    if ((i + 1) % 500 === 0) {
      console.log(`  Progress: ${i + 1}/${logs.length}`)
    }
  }

  console.log('')
  console.log('=== Done ===')
  console.log(`Total records processed: ${logs.length}`)
  console.log(`Updated: ${updated}`)
  console.log(`Unchanged: ${unchanged}`)
  console.log(`Errors: ${errors}`)

  if (changes.length > 0) {
    console.log(`\nLocation changes (${changes.length}):`)
    changes.slice(0, 20).forEach(c => {
      console.log(`  ${c.oldRescue} → ${c.oldDrop}  ⟹  ${c.newRescue} → ${c.newDrop}`)
      console.log(`    ${c.firstLine}`)
    })
    if (changes.length > 20) {
      console.log(`  ... and ${changes.length - 20} more`)
    }
  }
}

run()
