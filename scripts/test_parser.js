/**
 * Regression test suite for process_slack_history.js parsing logic.
 *
 * Run: node scripts/test_parser.js
 *
 * Tests all the parsing pathways we've built incrementally:
 *   - UNIT_PATTERN (primary item regex)
 *   - COMPOUND_PATTERN (e.g. "4 12 packs")
 *   - Unitless fallback
 *   - convertWordQuantities pre-processing
 *   - normalizeUnit
 *   - detectCategory (keyword matching, word boundaries, special cases)
 *   - estimateWeight (unit-specific weights, retail vs bulk boxes)
 *   - isRetailBoxItem (mixed/assorted override)
 *   - cleanItemName (HTML entities, trailing junk)
 *   - matchRescueLocation (apostrophes, longest-match)
 *   - matchDropOffLocation
 *   - splitSections (compound messages)
 */

// ── Dynamic import so we can test individual functions ──────────
// We re-declare the functions here by importing the file's source,
// since the script wasn't written as a module with exports.
// Instead, we'll copy-paste the core functions into a testable form.
// Actually, let's just run the full pipeline on known inputs and check outputs.

import fs from 'fs'
import { execSync } from 'child_process'

let passed = 0
let failed = 0
const failures = []

function assert(testName, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++
  } else {
    failed++
    failures.push({ testName, actual, expected })
    console.log(`  FAIL: ${testName}`)
    console.log(`    expected: ${JSON.stringify(expected)}`)
    console.log(`    actual:   ${JSON.stringify(actual)}`)
  }
}

function assertIncludes(testName, actual, substring) {
  if (actual && actual.includes(substring)) {
    passed++
  } else {
    failed++
    failures.push({ testName, actual, expected: `contains "${substring}"` })
    console.log(`  FAIL: ${testName}`)
    console.log(`    expected to contain: "${substring}"`)
    console.log(`    actual: ${JSON.stringify(actual)}`)
  }
}

// ── We'll test by feeding known Slack messages through the full pipeline ──
// Write temp messages, run the parser on them, check the output.

const TEST_MESSAGES = [
  // === UNIT_PATTERN tests ===
  {
    name: 'Basic cases',
    text: 'Picked up from Aldi Wicker Park\n3 cases bread\n2 cases apples',
    checks: (rec) => {
      assert('basic - location', rec.rescue_location_name, 'Aldi Wicker Park')
      assert('basic - item count', rec.items.length, 2)
      assert('basic - bread qty', rec.items[0].quantity, 3)
      assert('basic - bread unit', rec.items[0].unit, 'cases')
      assert('basic - bread category', rec.items[0].gcfd_category, 'Bread/Bakery')
      assert('basic - bread lbs', rec.items[0].estimated_lbs, 45)
      assert('basic - apples lbs', rec.items[1].estimated_lbs, 50)
    }
  },
  {
    name: 'Fraction quantity (1/2 case)',
    text: 'Picked up from Aldi WP\n1/2 case frozen meats',
    checks: (rec) => {
      assert('fraction - qty', rec.items[0].quantity, 0.5)
      assert('fraction - unit', rec.items[0].unit, 'cases')
      assert('fraction - category', rec.items[0].gcfd_category, 'Meat')
    }
  },
  {
    name: 'Box regex (singular "box" not "boxe")',
    text: 'Rescued from Aldi Hodgkins\n1 box apples\n2 boxes oranges',
    checks: (rec) => {
      assert('box singular - count', rec.items.length, 2)
      assert('box singular - unit', rec.items[0].unit, 'boxes')
      assert('box plural - unit', rec.items[1].unit, 'boxes')
    }
  },
  {
    name: 'Bunch/bunches regex',
    text: 'Picked up from Aldi WP\n1 bunch bananas\n3 bunches cilantro',
    checks: (rec) => {
      assert('bunch singular', rec.items[0].unit, 'bunches')
      assert('bunch plural', rec.items[1].unit, 'bunches')
    }
  },
  {
    name: 'Misc/mixed prefix',
    text: 'Picked up from Aldi WP\n6 misc cans vegetables\n3 mixed bags produce',
    checks: (rec) => {
      assert('misc prefix - count', rec.items.length, 2)
      assert('misc prefix - unit1', rec.items[0].unit, 'cans')
      assert('misc prefix - unit2', rec.items[1].unit, 'bags')
    }
  },
  {
    name: 'Size word prefix (big sacks)',
    text: 'Picked up from Aldi WP\n5 big sacks potatoes\n2 large bags onions',
    checks: (rec) => {
      assert('big sacks - count', rec.items.length, 2)
      assert('big sacks - unit', rec.items[0].unit, 'sacks')
      assert('big sacks - qty', rec.items[0].quantity, 5)
      assert('big sacks - lbs', rec.items[0].estimated_lbs, 125)  // 5 * 25 produce avg
      assert('large bags - unit', rec.items[1].unit, 'bags')
    }
  },
  {
    name: 'Sacks unit',
    text: 'Picked up from Aldi WP\n8 sacks cabbages',
    checks: (rec) => {
      assert('sacks - unit', rec.items[0].unit, 'sacks')
      assert('sacks - lbs', rec.items[0].estimated_lbs, 200)  // 8 * 25
      assert('sacks - category', rec.items[0].gcfd_category, 'Produce')
    }
  },

  // === COMPOUND_PATTERN tests ===
  {
    name: 'Compound pattern (4 12 packs)',
    text: 'Picked up from Aldi WP\n4 12 packs ice tea',
    checks: (rec) => {
      assert('compound - qty', rec.items[0].quantity, 4)
      assert('compound - unit', rec.items[0].unit, 'packs')
      assertIncludes('compound - name', rec.items[0].name, 'ice tea')
    }
  },

  // === convertWordQuantities tests ===
  {
    name: 'Word quantity "Four"',
    text: 'Picked up from Aldi WP\nFour packages crackers',
    checks: (rec) => {
      assert('word qty - qty', rec.items[0].quantity, 4)
    }
  },
  {
    name: 'Word quantity "A dozen"',
    text: 'Picked up from Aldi WP\nA dozen eggs',
    checks: (rec) => {
      assert('a dozen - qty', rec.items[0].quantity, 12)
    }
  },
  {
    name: 'Size word as quantity "Small box"',
    text: 'Picked up from Aldi WP\nSmall box crackers',
    checks: (rec) => {
      assert('size word - qty', rec.items[0].quantity, 1)
      assert('size word - unit', rec.items[0].unit, 'boxes')
    }
  },
  {
    name: 'No space "1case"',
    text: 'Picked up from Aldi WP\n1case bread',
    checks: (rec) => {
      assert('nospace - qty', rec.items[0].quantity, 1)
      assert('nospace - unit', rec.items[0].unit, 'cases')
    }
  },

  // === Unitless fallback tests ===
  {
    name: 'Unitless item with food keyword',
    text: 'Picked up from Aldi WP\n6 fruit cups\n20 bananas',
    checks: (rec) => {
      assert('unitless - count', rec.items.length, 2)
      assert('unitless - unit', rec.items[0].unit, 'items')
      assert('unitless - qty', rec.items[0].quantity, 6)
    }
  },

  // === Weight estimation tests ===
  {
    name: 'Dozen eggs weight (~2 lbs/doz for Deli/Prepared)',
    text: 'Picked up from Aldi WP\n6 dozen eggs',
    checks: (rec) => {
      assert('dozen eggs - lbs', rec.items[0].estimated_lbs, 12)  // 6 * 2
    }
  },
  {
    name: 'Retail boxes (cereal, crackers) = 1.5 lbs each',
    text: 'Picked up from Aldi WP\n8 boxes crackers\n6 boxes cereal',
    checks: (rec) => {
      assert('retail box crackers', rec.items[0].estimated_lbs, 12)   // 8 * 1.5
      assert('retail box cereal', rec.items[1].estimated_lbs, 9)     // 6 * 1.5
    }
  },
  {
    name: 'Bulk boxes (apples, meat) = category avg',
    text: 'Picked up from Aldi WP\n2 boxes apples\n3 boxes meat',
    checks: (rec) => {
      assert('bulk box apples', rec.items[0].estimated_lbs, 50)   // 2 * 25 produce
      assert('bulk box meat', rec.items[1].estimated_lbs, 135)    // 3 * 45 meat
    }
  },
  {
    name: 'Mixed box = bulk weight (not retail)',
    text: 'Picked up from Aldi WP\n1 box mixed crackers, protein bars, Xmas sweets',
    checks: (rec) => {
      assert('mixed box - not retail', rec.items[0].estimated_lbs > 5, true)
    }
  },
  {
    name: 'Assorted box = bulk weight',
    text: 'Picked up from Aldi WP\n1 box assorted chips',
    checks: (rec) => {
      assert('assorted box - bulk', rec.items[0].estimated_lbs, 25)  // 1 * 25 grocery
    }
  },
  {
    name: 'Pounds = direct weight',
    text: 'Picked up from Aldi WP\n100 lbs potatoes',
    checks: (rec) => {
      assert('lbs direct', rec.items[0].estimated_lbs, 100)
    }
  },

  // === detectCategory tests ===
  {
    name: 'Word boundary: "steak" should NOT match "tea"',
    text: 'Picked up from Aldi WP\n2 cases frozen steak',
    checks: (rec) => {
      assert('steak not tea', rec.items[0].gcfd_category, 'Meat')
    }
  },
  {
    name: 'Ice cream → Assorted Freezer (not Dairy)',
    text: 'Picked up from Aldi WP\n3 cases ice cream',
    checks: (rec) => {
      assert('ice cream category', rec.items[0].gcfd_category, 'Assorted Freezer')
    }
  },
  {
    name: 'Frozen meat → Meat (not Assorted Freezer)',
    text: 'Picked up from Aldi WP\n2 cases frozen chicken',
    checks: (rec) => {
      assert('frozen meat category', rec.items[0].gcfd_category, 'Meat')
    }
  },
  {
    name: 'Beverages vs Dairy',
    text: 'Picked up from Aldi WP\n1 case water\n1 case milk',
    checks: (rec) => {
      assert('water = beverages', rec.items[0].gcfd_category, 'Beverages')
      assert('milk = dairy', rec.items[1].gcfd_category, 'Dairy')
    }
  },

  // === cleanItemName tests ===
  {
    name: 'HTML entity cleanup',
    text: 'Picked up from Aldi WP\n1 case snacks &amp; bread',
    checks: (rec) => {
      assertIncludes('html entity', rec.items[0].name, '&')
      assert('no &amp;', rec.items[0].name.includes('&amp;'), false)
    }
  },

  // === Location matching tests ===
  {
    name: 'Apostrophe matching (Aldis\')',
    text: "Picked up from Aldis' Wicker Park\n2 cases produce",
    checks: (rec) => {
      assert('apostrophe location', rec.rescue_location_name, 'Aldi Wicker Park')
    }
  },
  {
    name: 'Longest match (Mariano\'s SL > Mariano\'s)',
    text: "Picked up from Mariano's SL\n1 case bread",
    checks: (rec) => {
      assert('longest match', rec.rescue_location_name, "Mariano's South Loop")
    }
  },
  {
    name: 'Irving Park alias',
    text: 'Picked up from Irving park\n5 boxes sweet potato',
    checks: (rec) => {
      assert('irving park', rec.rescue_location_name, 'Irving Park Food Pantry')
    }
  },
  {
    name: 'Englewood Aldi (reversed order)',
    text: 'Picked up from Englewood Aldi\n3 cases bread',
    checks: (rec) => {
      assert('englewood reversed', rec.rescue_location_name, 'Aldi Englewood')
    }
  },

  // === Drop-off defaults to Urban Canopy ===
  {
    name: 'No drop-off → Urban Canopy',
    text: 'Picked up from Aldi WP\n2 cases bread',
    checks: (rec) => {
      assert('default dropoff', rec.drop_off_location_name, 'Urban Canopy')
    }
  },
  {
    name: 'Explicit drop-off',
    text: 'Picked up from Aldi WP\n2 cases bread\nDropped off at Love Fridge',
    checks: (rec) => {
      assert('explicit dropoff', rec.drop_off_location_name, 'Love Fridge')
    }
  },

  // === Drop-off pattern: "dropped at" (no "off") ===
  {
    name: 'Dropped at (no "off")',
    text: 'Picked up from Aldi WP\n2 cases bread\nDropped at Love Fridge',
    checks: (rec) => {
      assert('dropped at', rec.drop_off_location_name, 'Love Fridge')
    }
  },

  // === New keyword coverage ===
  {
    name: 'Cabbages categorized as Produce',
    text: 'Picked up from Aldi WP\n8 sacks cabbages',
    checks: (rec) => {
      assert('cabbages category', rec.items[0].gcfd_category, 'Produce')
    }
  },
  {
    name: 'Raisins categorized as Produce',
    text: 'Picked up from Aldi WP\n5 boxes raisins',
    checks: (rec) => {
      assert('raisins category', rec.items[0].gcfd_category, 'Produce')
    }
  },
  {
    name: 'Walnuts categorized as Grocery',
    text: 'Picked up from Aldi WP\n3 bags walnuts',
    checks: (rec) => {
      assert('walnuts category', rec.items[0].gcfd_category, 'Grocery')
    }
  },
  {
    name: 'Bimbo categorized as Bread/Bakery',
    text: 'Picked up from Aldi WP\n4 boxes bimbo',
    checks: (rec) => {
      assert('bimbo category', rec.items[0].gcfd_category, 'Bread/Bakery')
    }
  },
]

// ── Run tests ──────────────────────────────────────────────────

console.log('Running parser regression tests...\n')

// Create a temp slack export with test messages
const tempDir = 'scripts/_test_temp'
fs.mkdirSync(tempDir, { recursive: true })

// Build a fake Slack export structure
const testChannel = []
for (let i = 0; i < TEST_MESSAGES.length; i++) {
  const t = TEST_MESSAGES[i]
  testChannel.push({
    ts: `${1700000000 + i}.000000`,
    user: 'UTESTUSER',
    text: t.text,
    type: 'message',
  })
}

// Write as a single day file in the channel folder
const channelDir = `${tempDir}/urban-canopy-log`
fs.mkdirSync(channelDir, { recursive: true })
fs.writeFileSync(`${channelDir}/2024-01-01.json`, JSON.stringify(testChannel, null, 2))

// Run the parser on our test data
try {
  execSync(
    `node scripts/process_slack_history.js --input "${tempDir}" --output "${tempDir}/test_output.jsonl"`,
    { cwd: process.cwd(), stdio: 'pipe' }
  )
} catch (e) {
  // The parser might not support --input/--output flags.
  // Let's check how it reads input...
}

// Check if the parser has CLI args support
const parserSource = fs.readFileSync('scripts/process_slack_history.js', 'utf-8')

// If the parser doesn't support CLI args, we need a different approach.
// Let's extract and test the functions directly by creating a test harness.

// Clean up temp
fs.rmSync(tempDir, { recursive: true, force: true })

// ── Alternative approach: extract functions via eval ──────────
// We'll create a wrapper that imports the functions we need to test.

const testHarness = `
import fs from 'fs'

// Source the parser file — we need to extract its internal functions.
// We'll read the file and wrap it so we can access the functions.
const src = fs.readFileSync('scripts/process_slack_history.js', 'utf-8')

// Extract everything up to the main execution block
const mainStart = src.indexOf('// ============================================================\\n// Main')
  || src.indexOf('async function main')
  || src.indexOf('// --- Main')
const moduleSrc = mainStart > 0 ? src.slice(0, mainStart) : src

// Create a module that exports the functions we need
const wrappedSrc = moduleSrc + \`
export {
  convertWordQuantities, normalizeUnit, detectCategory, estimateWeight,
  isRetailBoxItem, cleanItemName, parseItemsFromMessage,
  matchRescueLocation, matchDropOffLocation, stripApostrophes,
  CFSC_CATEGORIES, UNIT_PATTERN, COMPOUND_PATTERN,
}
\`

fs.writeFileSync('scripts/_test_module.js', wrappedSrc)
`

// Actually, let's just do a simpler approach: write a standalone test file
// that re-imports the needed functions by sourcing a generated module.

// Simplest approach: test via the full pipeline by writing test messages
// to a temp file and checking the JSONL output.

console.log('(Using function extraction approach...)\n')

// Let's find where main() starts so we can split the module
const mainIdx = parserSource.indexOf('\nasync function main(')
  || parserSource.indexOf('\n// ============================================================\n// Main')
if (mainIdx < 0) {
  console.log('Could not find main() boundary in parser. Searching...')
}

// Find the main processing block (top-level code, not a function)
const mainMarker = '// Main processing'
let splitIdx = parserSource.indexOf(mainMarker)
if (splitIdx > 0) {
  // Back up to the separator line before it
  const preceding = parserSource.lastIndexOf('\n// ====', splitIdx - 1)
  if (preceding > 0) splitIdx = preceding
}

if (splitIdx < 0) {
  console.log('ERROR: Could not locate main processing block in parser source.')
  process.exit(1)
}

// Write just the library portion + exports
const libSource = parserSource.slice(0, splitIdx)

// Figure out which functions/consts to export
const exportNames = [
  'convertWordQuantities', 'normalizeUnit', 'detectCategory', 'estimateWeight',
  'isRetailBoxItem', 'cleanItemName', 'parseItemsFromMessage',
  'matchRescueLocation', 'matchDropOffLocation', 'stripApostrophes', 'normalize',
  'CFSC_CATEGORIES', 'UNIT_PATTERN', 'COMPOUND_PATTERN',
  'UNIT_WORDS', 'splitSections', 'splitByDropOff', 'deduplicateItems', 'matchDropOffLocationWithSpan', 'splitInlineItems',
]

// Filter to only names that actually exist in the source
const availableExports = exportNames.filter(n => {
  const patterns = [
    new RegExp(`\\bfunction\\s+${n}\\b`),
    new RegExp(`\\bconst\\s+${n}\\b`),
    new RegExp(`\\blet\\s+${n}\\b`),
  ]
  return patterns.some(p => p.test(libSource))
})

const moduleSource = libSource + '\nexport { ' + availableExports.join(', ') + ' }\n'
fs.writeFileSync('scripts/_test_module.js', moduleSource)

// Now dynamically import and test
const mod = await import('./_test_module.js')

// ── Unit tests ──────────────────────────────────────────────────

console.log('── convertWordQuantities ──')
assert('a dozen → 12', mod.convertWordQuantities('A dozen eggs').trim(), '12 eggs')
assert('a few → 3', mod.convertWordQuantities('A few boxes bread').trim(), '3 boxes bread')
assert('Four → 4', mod.convertWordQuantities('Four packages crackers').includes('4'), true)
assert('Small box → 1 box', mod.convertWordQuantities('Small box crackers').trim(), '1 box crackers')
assert('1case → 1 case', mod.convertWordQuantities('1case bread').trim(), '1 case bread')
assert('bullet a dozen', mod.convertWordQuantities('• A dozen eggs').includes('12'), true)

console.log('\n── normalizeUnit ──')
assert('cs → cases', mod.normalizeUnit('cs'), 'cases')
assert('case → cases', mod.normalizeUnit('case'), 'cases')
assert('bx → boxes', mod.normalizeUnit('bx'), 'boxes')
assert('box → boxes', mod.normalizeUnit('box'), 'boxes')
assert('lb → lbs', mod.normalizeUnit('lb'), 'lbs')
assert('dz → dozen', mod.normalizeUnit('dz'), 'dozen')
assert('sack → sacks', mod.normalizeUnit('sack'), 'sacks')
assert('pk → packages', mod.normalizeUnit('pk'), 'packages')
assert('bunch → bunches', mod.normalizeUnit('bunch'), 'bunches')
assert('loaf → loaves', mod.normalizeUnit('loaf'), 'loaves')

console.log('\n── detectCategory ──')
assert('apples → Produce', mod.detectCategory('apples')?.name, 'Produce')
assert('bread → Bread/Bakery', mod.detectCategory('bread')?.name, 'Bread/Bakery')
assert('chicken → Meat', mod.detectCategory('chicken')?.name, 'Meat')
assert('eggs → Deli/Prepared', mod.detectCategory('eggs')?.name, 'Deli/Prepared')
assert('water → Beverages', mod.detectCategory('water')?.name, 'Beverages')
assert('milk → Dairy', mod.detectCategory('milk')?.name, 'Dairy')
assert('cereal → Grocery', mod.detectCategory('cereal')?.name, 'Grocery')
assert('frozen pizza → Assorted Freezer', mod.detectCategory('frozen pizza')?.name, 'Assorted Freezer')
assert('ice cream → Assorted Freezer', mod.detectCategory('ice cream')?.name, 'Assorted Freezer')
assert('frozen steak → Meat (not Freezer)', mod.detectCategory('frozen steak')?.name, 'Meat')
assert('frozen chicken → Meat', mod.detectCategory('frozen chicken')?.name, 'Meat')
assert('steak ≠ tea', mod.detectCategory('steak')?.name, 'Meat')
assert('cabbages → Produce', mod.detectCategory('cabbages')?.name, 'Produce')
assert('raisins → Produce', mod.detectCategory('raisins')?.name, 'Produce')
assert('walnuts → Grocery', mod.detectCategory('walnuts')?.name, 'Grocery')
assert('bimbo → Bread/Bakery', mod.detectCategory('bimbo')?.name, 'Bread/Bakery')
assert('collards → Produce', mod.detectCategory('collards')?.name, 'Produce')
assert('brussel sprouts → Produce', mod.detectCategory('brussel sprouts')?.name, 'Produce')
assert('dairy → Dairy', mod.detectCategory('dairy')?.name, 'Dairy')
assert('takis → Grocery', mod.detectCategory('takis')?.name, 'Grocery')
assert('soap → Non-Food', mod.detectCategory('soap')?.name, 'Non-Food')
assert('diapers → Non-Food', mod.detectCategory('diapers')?.name, 'Non-Food')

console.log('\n── isRetailBoxItem ──')
assert('crackers = retail', mod.isRetailBoxItem('crackers'), true)
assert('cereal = retail', mod.isRetailBoxItem('cereal'), true)
assert('pasta = retail', mod.isRetailBoxItem('pasta'), true)
assert('mac and cheese = retail', mod.isRetailBoxItem('mac and cheese'), true)
assert('apples ≠ retail', mod.isRetailBoxItem('apples'), false)
assert('meat ≠ retail', mod.isRetailBoxItem('meat'), false)
assert('mixed crackers = NOT retail', mod.isRetailBoxItem('mixed crackers, bars'), false)
assert('assorted chips = NOT retail', mod.isRetailBoxItem('assorted chips'), false)
assert('crackers and bars = NOT retail', mod.isRetailBoxItem('crackers and protein bars'), false)

console.log('\n── estimateWeight ──')
assert('cases bread=15', mod.estimateWeight(1, 'cases', { avg_lbs: 15, name: 'Bread/Bakery' }, 'bread'), 15)
assert('cases produce=25', mod.estimateWeight(1, 'cases', { avg_lbs: 25, name: 'Produce' }, 'apples'), 25)
assert('boxes apples=25', mod.estimateWeight(1, 'boxes', { avg_lbs: 25, name: 'Produce' }, 'apples'), 25)
assert('boxes crackers=1.5', mod.estimateWeight(1, 'boxes', { avg_lbs: 25, name: 'Grocery' }, 'crackers'), 1.5)
assert('8 boxes crackers=12', mod.estimateWeight(8, 'boxes', { avg_lbs: 25, name: 'Grocery' }, 'crackers'), 12)
assert('mixed box=bulk', mod.estimateWeight(1, 'boxes', { avg_lbs: 25, name: 'Grocery' }, 'mixed crackers, bars'), 25)
assert('sacks=caseAvg', mod.estimateWeight(5, 'sacks', { avg_lbs: 25, name: 'Produce' }, 'potatoes'), 125)
assert('bags=half case', mod.estimateWeight(2, 'bags', { avg_lbs: 25, name: 'Produce' }, 'apples'), 25)
assert('lbs=direct', mod.estimateWeight(100, 'lbs', { avg_lbs: 25, name: 'Produce' }, 'potatoes'), 100)
assert('dozen eggs=2/doz', mod.estimateWeight(6, 'dozen', { avg_lbs: 30, name: 'Deli/Prepared' }, 'eggs'), 12)
assert('dozen bread=12/doz', mod.estimateWeight(1, 'dozen', { avg_lbs: 15, name: 'Bread/Bakery' }, 'rolls'), 12)
assert('items=1 each', mod.estimateWeight(20, 'items', { avg_lbs: 25, name: 'Produce' }, 'bananas'), 20)
assert('loaves=1.5 each', mod.estimateWeight(4, 'loaves', { avg_lbs: 15, name: 'Bread/Bakery' }, 'bread'), 6)
assert('null category=null', mod.estimateWeight(5, 'cases', null, 'unknown'), null)

console.log('\n── cleanItemName ──')
assert('html entity', mod.cleanItemName('snacks &amp; bread'), 'snacks & bread')
assert('trailing dash', mod.cleanItemName('apples - '), 'apples')
assert('trailing parens', mod.cleanItemName('bread (old)'), 'bread')
assert('slack formatting', mod.cleanItemName('<b>bread</b>'), 'bread')
assert('multi spaces', mod.cleanItemName('   big   apples   '), 'big apples')

console.log('\n── parseItemsFromMessage ──')
const items1 = mod.parseItemsFromMessage('3 cases bread\n2 boxes apples\n6 dozen eggs')
assert('parse 3 items', items1.length, 3)
assert('parse bread', items1[0].unit, 'cases')
assert('parse apples', items1[1].unit, 'boxes')
assert('parse eggs', items1[2].unit, 'dozen')

const items2 = mod.parseItemsFromMessage('6 fruit cups\n20 bananas')
assert('unitless items', items2.length, 2)
assert('unitless unit falls back to category default', items2[0].unit, 'cases')
assert('unitless lbs uses category avg', items2[0].estimated_lbs, 150) // 6 cases × 25 lbs (Produce — "fruit cups")

const items3 = mod.parseItemsFromMessage('4 12 packs ice tea')
assert('compound parse', items3.length, 1)
assert('compound qty', items3[0].quantity, 4)

const items4 = mod.parseItemsFromMessage('5 big sacks potatoes')
assert('big sacks parse', items4.length, 1)
assert('big sacks unit', items4[0].unit, 'sacks')

// Abbreviations cs/bx must work in regex (not just normalize)
const items5 = mod.parseItemsFromMessage('3 cs bread\n2 bx apples')
assert('cs abbreviation', items5.length, 2)
assert('cs → cases', items5[0].unit, 'cases')
assert('bx → boxes', items5[1].unit, 'boxes')

// pk/pkg abbreviations
const items6 = mod.parseItemsFromMessage('4 pkgs crackers\n2 pk rice')
assert('pkgs abbreviation', items6.length, 2)
assert('pkgs → packages', items6[0].unit, 'packages')
assert('pk → packages', items6[1].unit, 'packages')

console.log('\n── matchRescueLocation ──')
assert('aldi wp', mod.matchRescueLocation('Aldi WP'), 'Aldi Wicker Park')
assert('aldis apostrophe', mod.matchRescueLocation("Aldis' Wicker Park"), 'Aldi Wicker Park')
assert('marianos sl longest', mod.matchRescueLocation("Mariano's SL"), "Mariano's South Loop")
assert('englewood aldi reversed', mod.matchRescueLocation('Englewood Aldi'), 'Aldi Englewood')
assert('irving park', mod.matchRescueLocation('Irving park'), 'Irving Park Food Pantry')

if (mod.splitSections) {
  console.log('\n── splitSections ──')
  const compound = 'Picked up from Aldi WP\n3 cases bread\nPick up from Marianos SL\n2 cases meat'
  const sections = mod.splitSections(compound)
  assert('split compound', sections.length, 2)

  // ── Multi-destination split ──
  console.log('\n── splitByDropOff ──')

  // Test: single-line message with mid-message drop-off
  const multiMsg = "Picked up Mariano's  4 cases meat 1case bread 2 boxes snacks 4 cases deli  Dropped at love fridge 21st and Cali 4 cases mixed deli"
  const multiResult = mod.splitByDropOff(multiMsg, "Mariano's South Loop", 'Urban Canopy')
  assert('multi-dest splits into 2', multiResult?.length, 2)
  if (multiResult) {
    assert('multi-dest: first goes to UC', multiResult[0].dropOff, 'Urban Canopy')
    assert('multi-dest: second goes to Love Fridge', multiResult[1].dropOff, 'Love Fridge')
    assert('multi-dest: UC gets 3 items (deduped)', multiResult[0].items.length, 3)
    assert('multi-dest: Love Fridge gets 1 item', multiResult[1].items.length, 1)
    assert('multi-dest: UC has meat', multiResult[0].items.some(i => i.gcfd_category === 'Meat'), true)
    assert('multi-dest: UC has bread', multiResult[0].items.some(i => i.gcfd_category === 'Bread/Bakery'), true)
    assert('multi-dest: Love Fridge has deli', multiResult[1].items.some(i => i.gcfd_category === 'Deli/Prepared'), true)
  }

  // Test: multi-line message with drop-off on separate line
  const multiLine = "Picked up Mariano's\n4 cases meat\n2 cases bread\nDropped at love fridge\n3 cases deli"
  const multiLineResult = mod.splitByDropOff(multiLine, "Mariano's South Loop", 'Urban Canopy')
  assert('multi-line splits into 2', multiLineResult?.length, 2)
  if (multiLineResult) {
    assert('multi-line: UC gets 2 items', multiLineResult[0].items.length, 2)
    assert('multi-line: Love Fridge gets 1 item', multiLineResult[1].items.length, 1)
  }

  // Test: no drop-off marker → returns null
  const noDropOff = "Picked up Mariano's\n4 cases meat\n2 cases bread"
  assert('no drop-off returns null', mod.splitByDropOff(noDropOff, "Mariano's", 'Urban Canopy'), null)
}

// ── classifyMessage (from canonical slackParser.js) ──────────
console.log('\n── classifyMessage ──')

const { classifyMessage } = await import('../server/services/slackParser.js')

// Test: items first, then "SWC scooped this from X and took to Y" at bottom
{
  const text = '10 crates dairy\n12 banana boxes of frozen meats & bread loaves\n\nSWC scooped this from SL Mariano\u2019s and took to port & Pulaski fridges'
  const result = classifyMessage(text)
  assert('items-first: rescue = Mariano\'s South Loop', result.rescueLocation, "Mariano's South Loop")
  assert('items-first: drop-off is set', result.dropOffLocation != null, true)
  assert('items-first: class = explicit_rescue', result.classification, 'explicit_rescue')
}

// Test: standard "SWC scooped from X" at top of message
{
  const result = classifyMessage('SWC scooped from SL Mariano\u2019s today (Tuesday):\n\n\u2022 5 deli\n\u2022 6 Frozen\n\u2022 8 Dairy')
  assert('swc-scooped: rescue = Mariano\'s South Loop', result.rescueLocation, "Mariano's South Loop")
  assert('swc-scooped: class = explicit_rescue', result.classification, 'explicit_rescue')
}

// Test: "SWC picked up from X" still works
{
  const result = classifyMessage('SWC picked up from Aldi Wicker Park:\n5 cases produce')
  assert('swc-pickup: rescue = Aldi Wicker Park', result.rescueLocation, 'Aldi Wicker Park')
  assert('swc-pickup: class = explicit_rescue', result.classification, 'explicit_rescue')
}

// Test: "SWC took:" is still warehouse_distribution
{
  const result = classifyMessage('SWC took:\n5 cases produce\n3 dairy')
  assert('swc-took: rescue = Urban Canopy', result.rescueLocation, 'Urban Canopy')
  assert('swc-took: drop = SWC', result.dropOffLocation, 'SWC')
  assert('swc-took: class = warehouse_distribution', result.classification, 'warehouse_distribution')
}

// Test: "scooped this from" with filler word "this"
{
  const result = classifyMessage('SWC scooped this from Aldi Hodgkins:\n4 cases produce')
  assert('scooped-this: rescue = Aldi Hodgkins', result.rescueLocation, 'Aldi Hodgkins')
  assert('scooped-this: class = explicit_rescue', result.classification, 'explicit_rescue')
}

// Test: "picked up from X, dropped off at Y"
{
  const result = classifyMessage('SWC picked up from Aldi Wicker Park dropped off @ UC:\n5 cases produce')
  assert('pickup-dropoff: rescue = Aldi Wicker Park', result.rescueLocation, 'Aldi Wicker Park')
  assert('pickup-dropoff: drop = Urban Canopy', result.dropOffLocation, 'Urban Canopy')
}

// ── Summary ──────────────────────────────────────────────────
console.log('\n════════════════════════════════════════')
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailed tests:')
  for (const f of failures) {
    console.log(`  ✗ ${f.testName}`)
  }
  process.exit(1)
} else {
  console.log('All tests passed! ✓')
}

// Clean up
fs.unlinkSync('scripts/_test_module.js')
