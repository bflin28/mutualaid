import { processMessageText } from '../server/services/slackParser.js'

const msg1 = `Keystone Dry Goods Inventory on north wall:
* Lots of pumpkin puree still
* Half pallet of Peanut Butter Cookies
* 1 pallet of assorted beans/tomatoes in ~24 can packs
* Creamed Corn: 11 trays (24 cans per tray)
* Creamy Peanut Butter: 2 trays (12 jars per)
* Pinto Beans (Dry): 1 large bag with ~24 1lb baggies
* Grean Beans: 5 trays (24 cans per)
* Cream of Chicken: 4 trays (48 cans per)`

const msg2 = `going into the weekend at Urban Canopy:
* romaine
* broccoli
* belle peppers
* kale
* tomatoes (need sorting)
* cantaloupe
* blueberry
* apples
* banana
* cauliflower
* iceberg lettuce
* onion
* bread (tons!)
* snacks (tons!)
* kefir (regular and blood orange)
in dry:
* gummies
* chips
* green beans
* mac and cheese
* pretzels
* marshmallows
* stuffing
* veggie loops`

// Should NOT be classified as inventory
const msg3 = `SWC picked up from SL Mariano's on Tuesday:
3 cases produce
2 cases dairy
1 case bread`

console.log('=== Keystone Inventory ===')
const r1 = processMessageText(msg1)
console.log('record_type:', r1[0]?.record_type, '| location:', r1[0]?.rescue_location_name)
console.log('items:', r1[0]?.items?.length)
r1[0]?.items?.forEach(i => console.log('  -', i.quantity, i.unit, i.name, '(' + i.gcfd_category + ')'))

console.log('')
console.log('=== Urban Canopy Inventory ===')
const r2 = processMessageText(msg2)
console.log('record_type:', r2[0]?.record_type, '| location:', r2[0]?.rescue_location_name)
console.log('items:', r2[0]?.items?.length)
r2[0]?.items?.forEach(i => console.log('  -', i.quantity, i.unit, i.name, '(' + i.gcfd_category + ')'))

console.log('')
console.log('=== Rescue (should NOT be inventory) ===')
const r3 = processMessageText(msg3)
console.log('record_type:', r3[0]?.record_type, '| location:', r3[0]?.rescue_location_name)
console.log('classification:', r3[0]?.classification)
