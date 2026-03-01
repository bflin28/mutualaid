import { readFileSync } from 'fs'

const lines = readFileSync('slack_history_parsed.jsonl', 'utf8').split('\n').filter(Boolean)
const records = lines.map(l => JSON.parse(l))

// Messages classified as UC or Love Fridge rescue locations
const ucRecords = records.filter(r => r.rescue_location_name === 'Urban Canopy')
const lfRecords = records.filter(r => r.rescue_location_name === 'Love Fridge')

console.log('=== URBAN CANOPY as rescue location (' + ucRecords.length + ' records) ===')
console.log('Sample raw text:')
ucRecords.slice(0, 8).forEach((r, i) => {
  console.log(`\n--- UC #${i + 1} [${(r.rescued_at || '').slice(0, 10)}] ---`)
  console.log(r.raw_text.slice(0, 300))
})

console.log('\n\n=== LOVE FRIDGE as rescue location (' + lfRecords.length + ' records) ===')
console.log('Sample raw text:')
lfRecords.slice(0, 8).forEach((r, i) => {
  console.log(`\n--- LF #${i + 1} [${(r.rescued_at || '').slice(0, 10)}] ---`)
  console.log(r.raw_text.slice(0, 300))
})

// Unknown locations
const unknowns = records.filter(r => r.rescue_location_name === 'Unknown')
console.log('\n\n=== UNKNOWN locations (' + unknowns.length + ' records) ===')
console.log('Sample raw text:')
unknowns.slice(0, 20).forEach((r, i) => {
  console.log(`\n--- Unknown #${i + 1} [${(r.rescued_at || '').slice(0, 10)}] ---`)
  console.log(r.raw_text.slice(0, 300))
})

// Also show "Aldi (unknown)"
const aldiUnk = records.filter(r => r.rescue_location_name === 'Aldi (unknown)')
console.log('\n\n=== ALDI (unknown) (' + aldiUnk.length + ' records) ===')
console.log('Sample raw text:')
aldiUnk.slice(0, 10).forEach((r, i) => {
  console.log(`\n--- Aldi? #${i + 1} [${(r.rescued_at || '').slice(0, 10)}] ---`)
  console.log(r.raw_text.slice(0, 300))
})
