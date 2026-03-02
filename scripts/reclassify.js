/**
 * Reclassify existing food_logs records.
 *
 * Re-parses all food_logs with raw_text through the updated parser
 * to set record_type and classification columns.
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

async function fetchAllWithRawText() {
  const PAGE_SIZE = 1000
  const all = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('food_logs')
      .select('id, raw_text, record_type, classification')
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

  let reclassified = 0
  let classificationUpdated = 0
  let unchanged = 0
  let errors = 0

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i]
    if (!log.raw_text?.trim()) {
      unchanged++
      continue
    }

    const { classification } = classifyMessage(log.raw_text)
    const newRecordType = classification === 'inventory' ? 'inventory' : 'rescue'
    const currentRecordType = log.record_type || 'rescue'

    // Check if anything changed
    if (currentRecordType === newRecordType && log.classification === classification) {
      unchanged++
      continue
    }

    const updates = {}
    if (currentRecordType !== newRecordType) {
      updates.record_type = newRecordType
      reclassified++
    }
    if (log.classification !== classification) {
      updates.classification = classification
      classificationUpdated++
    }

    const { error: updateError } = await supabase
      .from('food_logs')
      .update(updates)
      .eq('id', log.id)

    if (updateError) {
      console.error(`  Error updating ${log.id}:`, updateError.message)
      errors++
    }

    if ((i + 1) % 500 === 0) {
      console.log(`  Progress: ${i + 1}/${logs.length}`)
    }
  }

  console.log('')
  console.log('=== Done ===')
  console.log(`Total records processed: ${logs.length}`)
  console.log(`Record type changed: ${reclassified} (rescue → inventory or vice versa)`)
  console.log(`Classification updated: ${classificationUpdated}`)
  console.log(`Unchanged: ${unchanged}`)
  console.log(`Errors: ${errors}`)
}

run()
