/**
 * Regression test suite for the Slack message parser.
 *
 * Run: node scripts/test_parser.js
 *
 * Tests all the parsing pathways:
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
 *   - classifyMessage (org-picked-from, warehouse distribution, etc.)
 */

import {
  // Exported functions
  detectCategory, estimateWeight, matchRescueLocation, matchDropOffLocation,
  matchTakerOrg, classifyMessage, splitByDropOff, splitSections,
  processMessageText, parseItemsFromText,
  // Internal helpers exported for testing
  normalize, normalizeUnit, convertWordQuantities,
  isRetailBoxItem, cleanItemName, splitInlineItems,
  stripApostrophes, matchDropOffLocationWithSpan, deduplicateItems,
  CFSC_CATEGORIES, UNIT_PATTERN, COMPOUND_PATTERN, UNIT_WORDS,
} from '../server/services/slackParser.js'

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

console.log('Running parser regression tests...\n')

// ── Unit tests ──────────────────────────────────────────────────

console.log('── convertWordQuantities ──')
assert('a dozen → 12', convertWordQuantities('A dozen eggs').trim(), '12 eggs')
assert('a few → 3', convertWordQuantities('A few boxes bread').trim(), '3 boxes bread')
assert('Four → 4', convertWordQuantities('Four packages crackers').includes('4'), true)
assert('Small box → 1 box', convertWordQuantities('Small box crackers').trim(), '1 box crackers')
assert('1case → 1 case', convertWordQuantities('1case bread').trim(), '1 case bread')
assert('bullet a dozen', convertWordQuantities('• A dozen eggs').includes('12'), true)

console.log('\n── normalizeUnit ──')
assert('cs → cases', normalizeUnit('cs'), 'cases')
assert('case → cases', normalizeUnit('case'), 'cases')
assert('bx → boxes', normalizeUnit('bx'), 'boxes')
assert('box → boxes', normalizeUnit('box'), 'boxes')
assert('lb → lbs', normalizeUnit('lb'), 'lbs')
assert('dz → dozen', normalizeUnit('dz'), 'dozen')
assert('sack → sacks', normalizeUnit('sack'), 'sacks')
assert('pk → packages', normalizeUnit('pk'), 'packages')
assert('bunch → bunches', normalizeUnit('bunch'), 'bunches')
assert('loaf → loaves', normalizeUnit('loaf'), 'loaves')

console.log('\n── detectCategory ──')
assert('apples → Produce', detectCategory('apples')?.name, 'Produce')
assert('bread → Bread/Bakery', detectCategory('bread')?.name, 'Bread/Bakery')
assert('chicken → Meat', detectCategory('chicken')?.name, 'Meat')
assert('eggs → Deli/Prepared', detectCategory('eggs')?.name, 'Deli/Prepared')
assert('water → Beverages', detectCategory('water')?.name, 'Beverages')
assert('milk → Dairy', detectCategory('milk')?.name, 'Dairy')
assert('cereal → Grocery', detectCategory('cereal')?.name, 'Grocery')
assert('frozen pizza → Assorted Freezer', detectCategory('frozen pizza')?.name, 'Assorted Freezer')
assert('ice cream → Assorted Freezer', detectCategory('ice cream')?.name, 'Assorted Freezer')
assert('frozen steak → Meat (not Freezer)', detectCategory('frozen steak')?.name, 'Meat')
assert('frozen chicken → Meat', detectCategory('frozen chicken')?.name, 'Meat')
assert('steak ≠ tea', detectCategory('steak')?.name, 'Meat')
assert('cabbages → Produce', detectCategory('cabbages')?.name, 'Produce')
assert('raisins → Produce', detectCategory('raisins')?.name, 'Produce')
assert('walnuts → Grocery', detectCategory('walnuts')?.name, 'Grocery')
assert('bimbo → Bread/Bakery', detectCategory('bimbo')?.name, 'Bread/Bakery')
assert('collards → Produce', detectCategory('collards')?.name, 'Produce')
assert('brussel sprouts → Produce', detectCategory('brussel sprouts')?.name, 'Produce')
assert('dairy → Dairy', detectCategory('dairy')?.name, 'Dairy')
assert('takis → Grocery', detectCategory('takis')?.name, 'Grocery')
assert('soap → Non-Food', detectCategory('soap')?.name, 'Non-Food')
assert('diapers → Non-Food', detectCategory('diapers')?.name, 'Non-Food')

console.log('\n── isRetailBoxItem ──')
assert('crackers = retail', isRetailBoxItem('crackers'), true)
assert('cereal = retail', isRetailBoxItem('cereal'), true)
assert('pasta = retail', isRetailBoxItem('pasta'), true)
assert('mac and cheese = retail', isRetailBoxItem('mac and cheese'), true)
assert('apples ≠ retail', isRetailBoxItem('apples'), false)
assert('meat ≠ retail', isRetailBoxItem('meat'), false)
assert('mixed crackers = NOT retail', isRetailBoxItem('mixed crackers, bars'), false)
assert('assorted chips = NOT retail', isRetailBoxItem('assorted chips'), false)
assert('crackers and bars = NOT retail', isRetailBoxItem('crackers and protein bars'), false)

console.log('\n── estimateWeight ──')
assert('cases bread=15', estimateWeight(1, 'cases', { avg_lbs: 15, name: 'Bread/Bakery' }, 'bread'), 15)
assert('cases produce=25', estimateWeight(1, 'cases', { avg_lbs: 25, name: 'Produce' }, 'apples'), 25)
assert('boxes apples=25', estimateWeight(1, 'boxes', { avg_lbs: 25, name: 'Produce' }, 'apples'), 25)
assert('boxes crackers=1.5', estimateWeight(1, 'boxes', { avg_lbs: 25, name: 'Grocery' }, 'crackers'), 1.5)
assert('8 boxes crackers=12', estimateWeight(8, 'boxes', { avg_lbs: 25, name: 'Grocery' }, 'crackers'), 12)
assert('mixed box=bulk', estimateWeight(1, 'boxes', { avg_lbs: 25, name: 'Grocery' }, 'mixed crackers, bars'), 25)
assert('sacks=caseAvg', estimateWeight(5, 'sacks', { avg_lbs: 25, name: 'Produce' }, 'potatoes'), 125)
assert('bags=half case', estimateWeight(2, 'bags', { avg_lbs: 25, name: 'Produce' }, 'apples'), 25)
assert('lbs=direct', estimateWeight(100, 'lbs', { avg_lbs: 25, name: 'Produce' }, 'potatoes'), 100)
assert('dozen eggs=2/doz', estimateWeight(6, 'dozen', { avg_lbs: 30, name: 'Deli/Prepared' }, 'eggs'), 12)
assert('dozen bread=12/doz', estimateWeight(1, 'dozen', { avg_lbs: 15, name: 'Bread/Bakery' }, 'rolls'), 12)
assert('items=1 each', estimateWeight(20, 'items', { avg_lbs: 25, name: 'Produce' }, 'bananas'), 20)
assert('loaves=1.5 each', estimateWeight(4, 'loaves', { avg_lbs: 15, name: 'Bread/Bakery' }, 'bread'), 6)
assert('null category=null', estimateWeight(5, 'cases', null, 'unknown'), null)

console.log('\n── cleanItemName ──')
assert('html entity', cleanItemName('snacks &amp; bread'), 'snacks & bread')
assert('trailing dash', cleanItemName('apples - '), 'apples')
assert('trailing parens', cleanItemName('bread (old)'), 'bread')
assert('slack formatting', cleanItemName('<b>bread</b>'), 'bread')
assert('multi spaces', cleanItemName('   big   apples   '), 'big apples')

console.log('\n── parseItemsFromText ──')
const items1 = parseItemsFromText('3 cases bread\n2 boxes apples\n6 dozen eggs')
assert('parse 3 items', items1.length, 3)
assert('parse bread', items1[0].unit, 'cases')
assert('parse apples', items1[1].unit, 'boxes')
assert('parse eggs', items1[2].unit, 'dozen')

const items2 = parseItemsFromText('6 fruit cups\n20 bananas')
assert('unitless items', items2.length, 2)
assert('unitless unit falls back to category default', items2[0].unit, 'cases')
assert('unitless lbs uses category avg', items2[0].estimated_lbs, 150) // 6 cases × 25 lbs (Produce — "fruit cups")

// Note: splitInlineItems splits "4 12 packs ice tea" at the "12 packs" boundary,
// so the "4" is orphaned. Test compound pattern on its own line instead.
const items3 = parseItemsFromText('4 12 packs ice tea', { inventoryMode: true })
assert('compound parse', items3.length, 1)
assert('compound qty', items3[0].quantity, 4)

const items4 = parseItemsFromText('5 big sacks potatoes')
assert('big sacks parse', items4.length, 1)
assert('big sacks unit', items4[0].unit, 'sacks')

// Abbreviations cs/bx must work in regex (not just normalize)
const items5 = parseItemsFromText('3 cs bread\n2 bx apples')
assert('cs abbreviation', items5.length, 2)
assert('cs → cases', items5[0].unit, 'cases')
assert('bx → boxes', items5[1].unit, 'boxes')

// pk/pkg abbreviations
const items6 = parseItemsFromText('4 pkgs crackers\n2 pk rice')
assert('pkgs abbreviation', items6.length, 2)
assert('pkgs → packages', items6[0].unit, 'packages')
assert('pk → packages', items6[1].unit, 'packages')

console.log('\n── matchRescueLocation ──')
assert('aldi wp', matchRescueLocation('Aldi WP'), 'Aldi Wicker Park')
assert('aldis apostrophe', matchRescueLocation("Aldis' Wicker Park"), 'Aldi Wicker Park')
assert('marianos sl longest', matchRescueLocation("Mariano's SL"), "Mariano's South Loop")
assert('englewood aldi reversed', matchRescueLocation('Englewood Aldi'), 'Aldi Englewood')
assert('irving park', matchRescueLocation('Irving park'), 'Irving Park Food Pantry')

console.log('\n── splitSections ──')
const compound = 'Picked up from Aldi WP\n3 cases bread\nPick up from Marianos SL\n2 cases meat'
const sections = splitSections(compound)
assert('split compound', sections.length, 2)

// ── Multi-destination split ──
console.log('\n── splitByDropOff ──')

// Test: single-line message with mid-message drop-off
const multiMsg = "Picked up Mariano's  4 cases meat 1case bread 2 boxes snacks 4 cases deli  Dropped at love fridge 21st and Cali 4 cases mixed deli"
const multiResult = splitByDropOff(multiMsg, 'Urban Canopy')
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
const multiLineResult = splitByDropOff(multiLine, 'Urban Canopy')
assert('multi-line splits into 2', multiLineResult?.length, 2)
if (multiLineResult) {
  assert('multi-line: UC gets 2 items', multiLineResult[0].items.length, 2)
  assert('multi-line: Love Fridge gets 1 item', multiLineResult[1].items.length, 1)
}

// Test: no drop-off marker → returns null
const noDropOff = "Picked up Mariano's\n4 cases meat\n2 cases bread"
assert('no drop-off returns null', splitByDropOff(noDropOff, 'Urban Canopy'), null)

// ── classifyMessage ──────────────────────────────────────────
console.log('\n── classifyMessage ──')

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

// Test: day word "today" between verb and "from"
{
  const result = classifyMessage("SWC picked up today from SL Mariano's:\n5 boxes frozen meats")
  assert('day-today: rescue = Mariano\'s SL', result.rescueLocation, "Mariano's South Loop")
  assert('day-today: class = explicit_rescue', result.classification, 'explicit_rescue')
}

// Test: "on Wednesday" between verb and "from"
{
  const result = classifyMessage('SWC picked up on Wednesday from Aldi Hodgkins:\n5 boxes snacks')
  assert('day-wednesday: rescue = Aldi Hodgkins', result.rescueLocation, 'Aldi Hodgkins')
  assert('day-wednesday: class = explicit_rescue', result.classification, 'explicit_rescue')
}

// Test: "took from" (not "took:" warehouse)
{
  const result = classifyMessage('SWC took from Aldi Hodgkins:\n2 boxes frozen chicken')
  assert('took-from: rescue = Aldi Hodgkins', result.rescueLocation, 'Aldi Hodgkins')
  assert('took-from: class = explicit_rescue', result.classification, 'explicit_rescue')
}

// Test: "on Tuesday" between verb and "from"
{
  const result = classifyMessage("SWC picked up on Tuesday from SL Mariano's:\n8 banana boxes lunch meats")
  assert('day-tuesday: rescue = Mariano\'s SL', result.rescueLocation, "Mariano's South Loop")
}

// Test: "scooped today from"
{
  const result = classifyMessage("SWC scooped today from SL Mariano's:\n4 boxes breads")
  assert('scooped-today: rescue = Mariano\'s SL', result.rescueLocation, "Mariano's South Loop")
}

// Test: "on Wednesday 7/2 from" (with date)
{
  const result = classifyMessage('SWC picked up on Wednesday 7/2 from Aldi Hodgkins\n4 Boxes Frozen Meat')
  assert('day-date: rescue = Aldi Hodgkins', result.rescueLocation, 'Aldi Hodgkins')
}

// Test: "SWC took:" still warehouse distribution (not confused with "took from")
{
  const result = classifyMessage('SWC took:\n5 boxes produce')
  assert('took-colon: rescue = Urban Canopy', result.rescueLocation, 'Urban Canopy')
  assert('took-colon: drop = SWC', result.dropOffLocation, 'SWC')
  assert('took-colon: class = warehouse_distribution', result.classification, 'warehouse_distribution')
}

// ── Integration tests (full pipeline) ──────────────────────────
console.log('\n── processMessageText (integration) ──')

// Basic rescue message
{
  const records = processMessageText('Picked up from Aldi Wicker Park\n3 cases bread\n2 cases apples')
  assert('integration: produces 1 record', records.length, 1)
  assert('integration: rescue location', records[0].rescue_location_name, 'Aldi Wicker Park')
  assert('integration: 2 items', records[0].items.length, 2)
  assert('integration: bread qty', records[0].items[0].quantity, 3)
  assert('integration: bread unit', records[0].items[0].unit, 'cases')
  assert('integration: bread category', records[0].items[0].gcfd_category, 'Bread/Bakery')
}

// Drop-off detection
{
  const records = processMessageText('Picked up from Aldi WP\n2 cases bread\nDropped off at Love Fridge')
  assert('drop-off: location', records[0]?.drop_off_location_name, 'Love Fridge')
}

// Compound message with two rescues
{
  const records = processMessageText('Picked up from Aldi WP\n3 cases bread\nPick up from Marianos SL\n2 cases meat')
  assert('compound: 2 records', records.length, 2)
}

// ── Summary ──────────────────────────────────────────────────
console.log('\n════════════════════════════════════════')
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailed tests:')
  for (const f of failures) {
    console.log(`  \u2717 ${f.testName}`)
  }
  process.exit(1)
} else {
  console.log('All tests passed! \u2713')
}
