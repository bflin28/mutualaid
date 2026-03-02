/**
 * Re-parse existing inventory food_log records using updated parser.
 * Updates items and total_estimated_lbs for records where item count changed.
 * Run with: node scripts/reparse_inventory.js [--dry-run]
 */
import '../server/loadEnv.js'
import { createClient } from '@supabase/supabase-js'
import { processMessageText } from '../server/services/slackParser.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dryRun = process.argv.includes('--dry-run')

const { data: invRecords, error } = await supabase.from('food_logs')
  .select('id, items, total_estimated_lbs, raw_text, rescued_at')
  .eq('record_type', 'inventory')

if (error) { console.error('Fetch error:', error.message); process.exit(1) }

console.log(`Found ${invRecords.length} inventory records`)
if (dryRun) console.log('(DRY RUN — no changes will be made)\n')

let updated = 0
let deleted = 0

for (const rec of invRecords) {
  const oldItems = rec.items || []
  const reparsed = processMessageText(rec.raw_text)
  const newItems = reparsed[0]?.items || []
  const newLbs = reparsed[0]?.total_estimated_lbs || 0

  if (oldItems.length === newItems.length) continue

  console.log('---')
  console.log(`ID: ${rec.id} | date: ${(rec.rescued_at || '').substring(0, 10)}`)
  console.log(`  Old: ${oldItems.length} items, ${rec.total_estimated_lbs} lbs`)
  console.log(`  New: ${newItems.length} items, ${newLbs} lbs`)

  if (newItems.length === 0) {
    // No items with explicit quantities — delete the record
    console.log('  → Deleting record (no items with explicit quantities)')
    if (!dryRun) {
      // Unlink slack_messages first
      await supabase.from('slack_messages')
        .update({ food_log_id: null, is_food_log: false })
        .eq('food_log_id', rec.id)
      const { error: delErr } = await supabase.from('food_logs').delete().eq('id', rec.id)
      if (delErr) console.error('  Delete error:', delErr.message)
    }
    deleted++
  } else {
    // Update with re-parsed items
    console.log(`  → Updating: ${oldItems.length - newItems.length} items removed, ${Math.round(rec.total_estimated_lbs - newLbs)} lbs removed`)
    if (!dryRun) {
      const { error: upErr } = await supabase.from('food_logs')
        .update({ items: newItems, total_estimated_lbs: newLbs })
        .eq('id', rec.id)
      if (upErr) console.error('  Update error:', upErr.message)
    }
    updated++
  }
}

console.log(`\n=== Done ===`)
console.log(`Updated: ${updated}`)
console.log(`Deleted: ${deleted}`)
console.log(`Unchanged: ${invRecords.length - updated - deleted}`)
