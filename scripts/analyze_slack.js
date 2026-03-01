import XLSX from 'xlsx'

const wb = XLSX.readFile('slack_messages.xlsx')
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])

// Filter out system messages
const systemSubtypes = ['channel_join', 'channel_leave', 'channel_purpose', 'channel_topic']
const system = data.filter(r => systemSubtypes.includes(r.Subtype))
const real = data.filter(r => !r.Subtype || r.Subtype === '')

// How many have item-like patterns (number + unit)?
const itemPattern = /\d+\.?\d*\s*(cases?|boxes?|bags?|bins?|lbs?|pounds?|pallets?|crates?|flats?|items?|dozen|each|gallons?|packages?|cans?|loafs?|loaves|cs|bx|pks?|pkgs?)\b/i
const withItems = real.filter(r => itemPattern.test(r.Message || ''))

// Location patterns
const locPattern = /(?:from|at|picked up|rescued|scooped|grabbed|took|dropped|delivered)\s/i
const withLocation = real.filter(r => locPattern.test(r.Message || ''))

const both = real.filter(r => itemPattern.test(r.Message || '') && locPattern.test(r.Message || ''))

console.log('Total rows:', data.length)
console.log('System messages (joins/leaves):', system.length)
console.log('Real messages:', real.length)
console.log('Messages with item patterns (qty + unit):', withItems.length)
console.log('Messages with location patterns:', withLocation.length)
console.log('Messages with BOTH:', both.length)

// Date range
const dates = real.map(r => r.Timestamp).sort()
console.log('\nDate range:', dates[0]?.slice(0, 10), 'to', dates[dates.length - 1]?.slice(0, 10))

// Year breakdown
const byYear = {}
real.forEach(r => {
  const y = (r.Timestamp || '').slice(0, 4)
  byYear[y] = (byYear[y] || 0) + 1
})
console.log('\nBy year:', JSON.stringify(byYear))

// Show some examples with items
console.log('\nSample messages with item patterns:')
withItems.slice(0, 8).forEach(r => {
  console.log(`  [${(r.Timestamp || '').slice(0, 10)}] ${(r.Message || '').replace(/\n/g, ' ').slice(0, 150)}`)
})
