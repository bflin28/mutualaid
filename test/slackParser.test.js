import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectCategory,
  estimateWeight,
  parseItemsFromText,
  classifyMessage,
  processMessageText,
  matchRescueLocation,
  matchDropOffLocation,
  matchTakerOrg,
} from '../server/services/slackParser.js'

// ============================================================
// Helper — get category by name for weight tests
// ============================================================
function catFor(itemName) {
  return detectCategory(itemName)
}

// ============================================================
// 1. detectCategory()
// ============================================================
describe('detectCategory', () => {
  it('classifies apples as Produce', () => {
    assert.equal(detectCategory('apples').name, 'Produce')
  })

  it('classifies banana as Produce', () => {
    assert.equal(detectCategory('banana').name, 'Produce')
  })

  it('classifies sourdough bread as Bread/Bakery', () => {
    assert.equal(detectCategory('sourdough bread').name, 'Bread/Bakery')
  })

  it('classifies bagels as Bread/Bakery', () => {
    assert.equal(detectCategory('bagels').name, 'Bread/Bakery')
  })

  it('classifies milk as Dairy', () => {
    assert.equal(detectCategory('milk').name, 'Dairy')
  })

  it('classifies yogurt as Deli/Prepared', () => {
    // yogurt keyword is in Deli/Prepared, not Dairy
    assert.equal(detectCategory('yogurt').name, 'Deli/Prepared')
  })

  it('classifies chicken breast as Meat', () => {
    assert.equal(detectCategory('chicken breast').name, 'Meat')
  })

  it('classifies frozen meat via special detection', () => {
    assert.equal(detectCategory('frozen chicken').name, 'Meat')
  })

  it('classifies frozen salmon via special detection', () => {
    assert.equal(detectCategory('frozen salmon').name, 'Meat')
  })

  it('classifies ice cream as Assorted Freezer', () => {
    assert.equal(detectCategory('ice cream').name, 'Assorted Freezer')
  })

  it('classifies paper towels as Non-Food', () => {
    assert.equal(detectCategory('paper towels').name, 'Non-Food')
  })

  it('classifies orange juice as Produce (orange keyword matches first)', () => {
    // "orange" matches Produce before "juice" matches Beverages
    assert.equal(detectCategory('orange juice').name, 'Produce')
  })

  it('classifies "juice" alone as Beverages', () => {
    assert.equal(detectCategory('juice').name, 'Beverages')
  })

  it('classifies chips as Grocery', () => {
    assert.equal(detectCategory('chips').name, 'Grocery')
  })

  it('classifies hummus as Deli/Prepared', () => {
    assert.equal(detectCategory('hummus').name, 'Deli/Prepared')
  })

  it('returns null for unknown items', () => {
    assert.equal(detectCategory('xyzzy123'), null)
  })

  it('is case-insensitive', () => {
    assert.equal(detectCategory('APPLES').name, 'Produce')
  })
})

// ============================================================
// 2. estimateWeight()
// ============================================================
describe('estimateWeight', () => {
  const produce = catFor('apples')   // avg_lbs: 25
  const bakery = catFor('bread')     // avg_lbs: 15
  const dairy = catFor('milk')       // avg_lbs: 40
  const deli = catFor('hummus')      // avg_lbs: 30

  it('calculates cases by category avg_lbs', () => {
    assert.equal(estimateWeight(3, 'cases', produce), 75)
  })

  it('calculates crates same as cases', () => {
    assert.equal(estimateWeight(2, 'crates', produce), 50)
  })

  it('calculates bins same as cases', () => {
    assert.equal(estimateWeight(2, 'bins', produce), 50)
  })

  it('returns lbs directly for unit=lbs', () => {
    assert.equal(estimateWeight(10, 'lbs', produce), 10)
  })

  it('calculates pallets as 20x cases', () => {
    assert.equal(estimateWeight(1, 'pallets', produce), 500)
  })

  it('calculates gallons at 8 lbs each', () => {
    assert.equal(estimateWeight(5, 'gallons', dairy), 40)
  })

  it('calculates bags at 0.5x cases', () => {
    assert.equal(estimateWeight(4, 'bags', produce), 50)
  })

  it('calculates trays at 0.7x cases', () => {
    assert.equal(estimateWeight(2, 'trays', produce), 35)
  })

  it('calculates dozen for bakery at 12 lbs', () => {
    assert.equal(estimateWeight(1, 'dozen', bakery), 12)
  })

  it('calculates dozen for produce at 5 lbs', () => {
    assert.equal(estimateWeight(1, 'dozen', produce), 5)
  })

  it('calculates dozen for deli at 2 lbs', () => {
    assert.equal(estimateWeight(1, 'dozen', deli), 2)
  })

  it('returns 1 lb per item for unit=items', () => {
    assert.equal(estimateWeight(6, 'items', produce), 6)
  })

  it('calculates retail boxes at 1.5 lbs each', () => {
    assert.equal(estimateWeight(3, 'boxes', produce, 'cereal'), 4.5)
  })

  it('calculates bulk boxes as full cases', () => {
    assert.equal(estimateWeight(3, 'boxes', produce, 'assorted produce'), 75)
  })

  it('returns null when category is null', () => {
    assert.equal(estimateWeight(3, 'cases', null), null)
  })

  it('calculates packages at 3 lbs each', () => {
    assert.equal(estimateWeight(4, 'packages', produce), 12)
  })

  it('calculates loaves at 1.5 lbs each', () => {
    assert.equal(estimateWeight(4, 'loaves', bakery), 6)
  })

  it('calculates cartons at 0.4x cases', () => {
    assert.equal(estimateWeight(5, 'cartons', dairy), 80)
  })
})

// ============================================================
// 3. parseItemsFromText()
// ============================================================
describe('parseItemsFromText', () => {
  describe('standard pattern: QTY UNIT NAME', () => {
    it('parses "3 cases produce"', () => {
      const items = parseItemsFromText('3 cases produce')
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 3)
      assert.equal(items[0].unit, 'cases')
      assert.equal(items[0].name, 'produce')
    })

    it('parses singular unit "1 box bread"', () => {
      const items = parseItemsFromText('1 box bread')
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 1)
      assert.equal(items[0].unit, 'boxes')
    })

    it('parses tilde approximate "~5 bags potatoes"', () => {
      const items = parseItemsFromText('~5 bags potatoes')
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 5)
      assert.equal(items[0].unit, 'bags')
    })

    it('parses decimal quantity "3.5 cases dairy"', () => {
      const items = parseItemsFromText('3.5 cases dairy')
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 3.5)
    })

    it('parses with "of" keyword: "3 cases of produce"', () => {
      const items = parseItemsFromText('3 cases of produce')
      assert.equal(items.length, 1)
      assert.equal(items[0].name, 'produce')
    })

    it('parses various units: lbs', () => {
      const items = parseItemsFromText('50 lbs chicken')
      assert.equal(items[0].unit, 'lbs')
      assert.equal(items[0].quantity, 50)
    })

    it('parses various units: pallets', () => {
      const items = parseItemsFromText('1 pallet produce')
      assert.equal(items[0].unit, 'pallets')
    })

    it('parses various units: trays', () => {
      const items = parseItemsFromText('11 trays corn')
      assert.equal(items[0].unit, 'trays')
      assert.equal(items[0].quantity, 11)
    })

    it('parses with bullet prefix "• 3 cases bread"', () => {
      const items = parseItemsFromText('• 3 cases bread')
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 3)
    })

    it('parses with dash prefix "- 3 cases bread"', () => {
      const items = parseItemsFromText('- 3 cases bread')
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 3)
    })
  })

  describe('modifier words', () => {
    it('handles "3 large cases produce"', () => {
      const items = parseItemsFromText('3 large cases produce')
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 3)
      assert.equal(items[0].unit, 'cases')
    })

    it('handles "2 mixed boxes dairy"', () => {
      const items = parseItemsFromText('2 mixed boxes dairy')
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 2)
    })
  })

  describe('reverse pattern: NAME: QTY UNIT', () => {
    it('parses "Creamed Corn: 11 trays" in inventory mode', () => {
      // Reverse pattern works in inventory mode (accepts without category match)
      // In rescue mode, inline splitter can break "Name: qty unit" apart
      const items = parseItemsFromText('Creamed Corn: 11 trays', { inventoryMode: true })
      assert.equal(items.length, 1)
      assert.equal(items[0].quantity, 11)
      assert.equal(items[0].unit, 'trays')
      assert.ok(items[0].name.toLowerCase().includes('creamed corn'))
    })
  })

  describe('inline splitting (rescue mode)', () => {
    it('splits "3 cases apples 2 cases bread" into 2 items', () => {
      const items = parseItemsFromText('3 cases apples 2 cases bread')
      assert.equal(items.length, 2)
      assert.equal(items[0].quantity, 3)
      assert.equal(items[1].quantity, 2)
    })
  })

  describe('multi-line parsing', () => {
    it('parses multiple lines', () => {
      const text = '3 cases produce\n2 boxes bread\n1 bag dairy'
      const items = parseItemsFromText(text)
      assert.equal(items.length, 3)
    })
  })

  describe('inventory mode', () => {
    it('parses bare item names with null quantity', () => {
      const items = parseItemsFromText('• romaine\n• blueberries\n• eggs', { inventoryMode: true })
      assert.ok(items.length >= 3)
      for (const item of items) {
        assert.equal(item.quantity, null)
        assert.equal(item.unit, null)
        assert.equal(item.estimated_lbs, null)
      }
    })

    it('strips parenthetical notes from items', () => {
      const items = parseItemsFromText('• romaine (lots!)\n• tomatoes (need sorting)', { inventoryMode: true })
      assert.ok(items.length >= 2)
      // Names should not contain parenthetical notes
      for (const item of items) {
        assert.ok(!item.name.includes('('), `name should not contain parens: ${item.name}`)
      }
    })

    it('filters header/meta lines', () => {
      const text = 'going into the weekend\n• romaine\n• bread'
      const items = parseItemsFromText(text, { inventoryMode: true })
      // "going into the weekend" should be filtered, leaving 2 items
      assert.equal(items.length, 2)
    })

    it('still parses items WITH quantities in inventory mode', () => {
      const items = parseItemsFromText('3 cases produce\n• romaine', { inventoryMode: true })
      assert.ok(items.length >= 2)
      // The first item should have explicit quantity
      const explicit = items.find(i => i.quantity === 3)
      assert.ok(explicit, 'should parse explicit quantity items in inventory mode')
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      assert.deepEqual(parseItemsFromText(''), [])
    })

    it('returns empty array for only whitespace', () => {
      assert.deepEqual(parseItemsFromText('   \n  \n  '), [])
    })

    it('handles Slack mention stripping', () => {
      const items = parseItemsFromText('<@U0A4KS372HZ> 3 cases produce')
      assert.ok(items.length >= 1)
    })

    it('assigns category to items', () => {
      const items = parseItemsFromText('3 cases apples')
      assert.equal(items[0].gcfd_category, 'Produce')
    })

    it('assigns estimated_lbs to items', () => {
      const items = parseItemsFromText('3 cases apples')
      assert.ok(items[0].estimated_lbs > 0)
    })
  })
})

// ============================================================
// 4. classifyMessage()
// ============================================================
describe('classifyMessage', () => {
  describe('NON_FOOD_LOG filtering', () => {
    it('filters "proposed purchase for this week"', () => {
      const result = classifyMessage('proposed purchase for this week:\nitem1\nitem2')
      assert.equal(result.classification, 'non_food_log')
    })

    it('filters "what I ordered" with dollar amounts', () => {
      const result = classifyMessage('what I ordered:\nbananas $50\noranges $30')
      assert.equal(result.classification, 'non_food_log')
    })

    it('filters "Total= $1,328"', () => {
      const result = classifyMessage('order:\nitem1 $500\nitem2 $828\nTotal= $1,328')
      assert.equal(result.classification, 'non_food_log')
    })

    it('filters "ordered" + dollar amounts', () => {
      const result = classifyMessage('I ordered 3 items $150 total')
      assert.equal(result.classification, 'non_food_log')
    })

    it('filters "purchase order"', () => {
      const result = classifyMessage('purchase order for next week')
      assert.equal(result.classification, 'non_food_log')
    })

    it('does NOT filter normal rescue messages', () => {
      const result = classifyMessage('Picked up from Aldi Belmont:\n3 cases produce')
      assert.notEqual(result.classification, 'non_food_log')
    })
  })

  describe('inventory detection', () => {
    it('classifies "going into the weekend at UC" as inventory', () => {
      const result = classifyMessage('going into the weekend at UC:\n• romaine\n• bread\n• eggs')
      assert.equal(result.classification, 'inventory')
      assert.equal(result.rescueLocation, 'Urban Canopy')
    })

    it('classifies "Keystone inventory" as inventory', () => {
      const result = classifyMessage('Keystone inventory:\n3 cases dairy\n2 cases bread')
      assert.equal(result.classification, 'inventory')
      assert.equal(result.rescueLocation, 'Keystone')
    })

    it('classifies "what\'s left at UC" as inventory', () => {
      const result = classifyMessage("what's left at UC:\n• apples\n• bread\n• milk\n• eggs")
      assert.equal(result.classification, 'inventory')
    })

    it('classifies "on hand at UC" as inventory', () => {
      const result = classifyMessage('on hand at UC:\n• produce\n• dairy\n• bread\n• meat')
      assert.equal(result.classification, 'inventory')
    })

    it('does NOT classify rescue with "going into the weekend" as inventory', () => {
      // Has rescue language "picked up from" which should suppress inventory
      const result = classifyMessage('picked up from Aldi going into the weekend at UC')
      assert.notEqual(result.classification, 'inventory')
    })
  })

  describe('explicit rescue', () => {
    it('classifies "Picked up from Aldi Wicker Park"', () => {
      const result = classifyMessage('Picked up from Aldi Wicker Park:\n3 cases produce')
      assert.equal(result.classification, 'explicit_rescue')
      assert.equal(result.rescueLocation, 'Aldi Wicker Park')
    })

    it('classifies "rescued from Mariano\'s"', () => {
      const result = classifyMessage("rescued from Mariano's:\n2 cases bread")
      assert.equal(result.classification, 'explicit_rescue')
      assert.equal(result.rescueLocation, "Mariano's")
    })

    it('classifies "grabbed from Whole Foods"', () => {
      const result = classifyMessage('grabbed from Whole Foods:\n3 cases produce')
      assert.equal(result.classification, 'explicit_rescue')
      assert.equal(result.rescueLocation, 'Whole Foods')
    })

    it('classifies "scooped at Aldi Belmont"', () => {
      const result = classifyMessage('scooped at Aldi Belmont:\n5 cases produce')
      assert.equal(result.classification, 'explicit_rescue')
      assert.equal(result.rescueLocation, 'Aldi Belmont')
    })
  })

  describe('warehouse distribution', () => {
    it('classifies "Love Fridge took:" as warehouse_distribution', () => {
      const result = classifyMessage('Love Fridge took:\n3 cases bread\n2 cases produce')
      assert.equal(result.classification, 'warehouse_distribution')
      assert.ok(result.dropOffLocation)
    })

    it('classifies "BKMA took:" as warehouse_distribution', () => {
      const result = classifyMessage('BKMA took:\n5 cases dairy')
      assert.equal(result.classification, 'warehouse_distribution')
    })
  })

  describe('drop-off detection', () => {
    it('detects "dropped off at Keystone"', () => {
      const result = classifyMessage('Picked up from Aldi Belmont:\n3 cases produce\ndropped off at Keystone')
      assert.ok(result.dropOffLocation || result.classification !== 'unknown')
    })
  })

  describe('fallback classifications', () => {
    it('classifies mention of generic "aldi"', () => {
      const result = classifyMessage('some stuff from aldi\n3 cases produce')
      // Should classify as generic_aldi or implicit_rescue
      assert.ok(['generic_aldi', 'implicit_rescue', 'explicit_rescue'].includes(result.classification),
        `Expected aldi-related classification, got: ${result.classification}`)
    })

    it('classifies unknown text as "unknown"', () => {
      const result = classifyMessage('hello everyone, meeting tomorrow at 3pm')
      assert.equal(result.classification, 'unknown')
    })
  })
})

// ============================================================
// 5. processMessageText() — integration tests
// ============================================================
describe('processMessageText', () => {
  it('processes a standard rescue message', () => {
    const records = processMessageText('Picked up from Aldi Belmont:\n3 cases produce\n2 cases bread')
    assert.equal(records.length, 1)
    assert.equal(records[0].record_type, 'rescue')
    assert.equal(records[0].rescue_location_name, 'Aldi Belmont')
    assert.ok(records[0].items.length >= 2)
    assert.ok(records[0].total_estimated_lbs > 0)
  })

  it('processes an inventory snapshot with bare items', () => {
    const records = processMessageText('going into the weekend at UC:\n• romaine\n• bread\n• eggs')
    assert.equal(records.length, 1)
    assert.equal(records[0].record_type, 'inventory')
    assert.equal(records[0].rescue_location_name, 'Urban Canopy')
    assert.ok(records[0].items.length >= 3)
    // Bare items should have null quantities
    const bareItem = records[0].items.find(i => i.quantity === null)
    assert.ok(bareItem, 'Should have items with null quantity')
  })

  it('processes inventory with explicit quantities', () => {
    const records = processMessageText('Keystone inventory:\n3 cases dairy\n2 cases bread')
    assert.equal(records.length, 1)
    assert.equal(records[0].record_type, 'inventory')
    assert.ok(records[0].total_estimated_lbs > 0)
  })

  it('filters out purchase orders entirely', () => {
    const records = processMessageText('what I ordered:\nbananas $50\noranges $30\nTotal= $80')
    assert.equal(records.length, 0)
  })

  it('processes warehouse distribution', () => {
    const records = processMessageText('Love Fridge took:\n3 cases produce\n2 cases bread')
    assert.equal(records.length, 1)
    assert.equal(records[0].record_type, 'rescue')
    assert.ok(records[0].drop_off_location_name)
  })

  it('handles messages with no parseable items', () => {
    const records = processMessageText('hello everyone, meeting tomorrow')
    assert.equal(records.length, 0)
  })

  it('processes multi-line rescue with many items', () => {
    const text = [
      'Picked up from Whole Foods:',
      '3 cases apples',
      '2 boxes bread',
      '5 bags potatoes',
      '1 pallet dairy',
      '10 lbs chicken',
    ].join('\n')
    const records = processMessageText(text)
    assert.equal(records.length, 1)
    assert.ok(records[0].items.length >= 5)
  })

  it('handles Slack user mentions in text', () => {
    const records = processMessageText('Picked up from Aldi WP with <@U0A4KS372HZ>:\n3 cases produce')
    assert.equal(records.length, 1)
    assert.equal(records[0].rescue_location_name, 'Aldi Wicker Park')
  })

  it('handles smart quotes and em-dashes', () => {
    const records = processMessageText('Picked up from Mariano\u2019s:\n3 cases produce')
    assert.equal(records.length, 1)
    assert.equal(records[0].rescue_location_name, "Mariano's")
  })
})

// ============================================================
// 6. matchRescueLocation()
// ============================================================
describe('matchRescueLocation', () => {
  it('matches exact name "Aldi Wicker Park"', () => {
    assert.equal(matchRescueLocation('Aldi Wicker Park'), 'Aldi Wicker Park')
  })

  it('matches alias "aldi wicker"', () => {
    assert.equal(matchRescueLocation('aldi wicker'), 'Aldi Wicker Park')
  })

  it('matches "Mariano\'s" with apostrophe', () => {
    assert.equal(matchRescueLocation("Mariano's"), "Mariano's")
  })

  it('matches "marianos" without apostrophe', () => {
    assert.equal(matchRescueLocation('marianos'), "Mariano's")
  })

  it('matches abbreviation "WF" for Whole Foods', () => {
    assert.equal(matchRescueLocation('WF'), 'Whole Foods')
  })

  it('matches "lsfm" for Logan Square Farmers Market', () => {
    assert.equal(matchRescueLocation('lsfm'), 'Logan Square Farmers Market')
  })

  it('returns null for unknown locations', () => {
    assert.equal(matchRescueLocation('totally unknown store'), null)
  })

  it('is case-insensitive', () => {
    assert.equal(matchRescueLocation('ALDI WICKER PARK'), 'Aldi Wicker Park')
  })
})

// ============================================================
// 7. matchTakerOrg()
// ============================================================
describe('matchTakerOrg', () => {
  it('matches "Love Fridge"', () => {
    assert.equal(matchTakerOrg('Love Fridge'), 'Love Fridge')
  })

  it('matches alias "BKMA"', () => {
    assert.equal(matchTakerOrg('BKMA'), 'BKMA')
  })

  it('matches "back of the yards" for BKMA', () => {
    assert.equal(matchTakerOrg('back of the yards'), 'BKMA')
  })

  it('matches "SWC"', () => {
    assert.equal(matchTakerOrg('SWC'), 'SWC')
  })

  it('matches "WSMA" for West Side Mutual Aid', () => {
    assert.equal(matchTakerOrg('WSMA'), 'WSMA')
  })

  it('matches "pilsen food pantry"', () => {
    assert.equal(matchTakerOrg('pilsen food pantry'), 'Pilsen Food Pantry')
  })

  it('matches misspelling "merillac" for Marillac', () => {
    assert.equal(matchTakerOrg('merillac'), 'Marillac')
  })

  it('returns null for unknown orgs', () => {
    assert.equal(matchTakerOrg('unknown org name'), null)
  })
})

// ============================================================
// 8. matchDropOffLocation()
// ============================================================
describe('matchDropOffLocation', () => {
  it('matches "Urban Canopy"', () => {
    assert.equal(matchDropOffLocation('Urban Canopy'), 'Urban Canopy')
  })

  it('matches "UC" abbreviation', () => {
    assert.equal(matchDropOffLocation('uc'), 'Urban Canopy')
  })

  it('matches "keystone"', () => {
    assert.equal(matchDropOffLocation('keystone'), 'Keystone')
  })

  it('matches taker orgs as drop-off locations', () => {
    assert.equal(matchDropOffLocation('Love Fridge'), 'Love Fridge')
  })

  it('returns null for unknown locations', () => {
    assert.equal(matchDropOffLocation('nowhere'), null)
  })
})
