/**
 * Backfill drop_off_location_name from slack_channel for records that are missing it.
 * #urban-canopy-log → "Urban Canopy", #keystone-log → "Keystone"
 * Run with: node scripts/backfill_dropoff.js [--dry-run]
 */
import '../server/loadEnv.js'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dryRun = process.argv.includes('--dry-run')

const CHANNEL_DROP_OFF = {
  'C026VATTHDE': 'Urban Canopy',   // #urban-canopy-log
  'C031JSTNV6H': 'Keystone',       // #keystone-log
}

// Find records with null drop_off and a known slack_channel
const { data, error } = await supabase.from('food_logs')
  .select('id, slack_channel, rescue_location_name, drop_off_location_name, record_type')
  .is('drop_off_location_name', null)
  .not('slack_channel', 'is', null)
  .neq('record_type', 'inventory')

if (error) { console.error('Fetch error:', error.message); process.exit(1) }

console.log(`Found ${data.length} records with null drop-off`)
if (dryRun) console.log('(DRY RUN)\n')

const byChannel = {}
let updated = 0

for (const r of data) {
  const dropOff = CHANNEL_DROP_OFF[r.slack_channel]
  if (!dropOff) continue

  // Skip if rescue location IS the warehouse (inventory-like, distribution, etc.)
  // These don't have a meaningful "drop off"
  byChannel[r.slack_channel] = (byChannel[r.slack_channel] || 0) + 1

  if (!dryRun) {
    const { error: upErr } = await supabase.from('food_logs')
      .update({ drop_off_location_name: dropOff })
      .eq('id', r.id)
    if (upErr) console.error('Update error for', r.id, ':', upErr.message)
  }
  updated++
}

console.log('\nBy channel:')
for (const [ch, count] of Object.entries(byChannel)) {
  console.log(`  ${ch} (${CHANNEL_DROP_OFF[ch]}): ${count}`)
}
console.log(`\nUpdated: ${updated}`)
