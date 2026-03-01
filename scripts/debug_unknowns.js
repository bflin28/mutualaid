import { readFileSync } from 'fs'

const lines = readFileSync('slack_history_parsed.jsonl', 'utf8').split('\n').filter(Boolean)
const records = lines.map(l => JSON.parse(l))
const unknowns = records.filter(r => r.rescue_location_name === 'Unknown')

// Show first 2 lines of each 'took' unknown
const took = unknowns.filter(r => /\btook[:\s]/i.test(r.raw_text))
console.log('Unknown messages with took (' + took.length + '):')
took.forEach((r, i) => {
  const first = r.raw_text.split('\n').slice(0, 2).join(' | ').slice(0, 120)
  console.log('  #' + (i + 1) + ' [' + (r.rescued_at || '').slice(0, 10) + '] ' + first)
})

// Also look at 'dropped' unknowns without 'from'
console.log()
const droppedRe = /^(?:just\s+)?dropped/im
const fromRe = /dropped from/i
const dropped = unknowns.filter(r => droppedRe.test(r.raw_text) && !fromRe.test(r.raw_text))
console.log('Unknown messages starting with dropped (' + dropped.length + '):')
dropped.forEach((r, i) => {
  const first = r.raw_text.split('\n').slice(0, 2).join(' | ').slice(0, 120)
  console.log('  #' + (i + 1) + ' [' + (r.rescued_at || '').slice(0, 10) + '] ' + first)
})

// Remaining unknowns (neither took nor dropped)
console.log()
const remaining = unknowns.filter(r => !/\btook[:\s]/i.test(r.raw_text) && !droppedRe.test(r.raw_text))
console.log('Remaining unknowns (' + remaining.length + '):')
remaining.forEach((r, i) => {
  const first = r.raw_text.split('\n').slice(0, 2).join(' | ').slice(0, 120)
  console.log('  #' + (i + 1) + ' [' + (r.rescued_at || '').slice(0, 10) + '] ' + first)
})
