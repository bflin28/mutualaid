/**
 * Slack message parser — extracted from scripts/process_slack_history.js
 * for use in real-time Socket Mode processing.
 *
 * Parses food rescue messages into structured items with quantities,
 * units, categories, and weight estimates.
 */

// ============================================================
// CFSC Categories with keywords for matching
// ============================================================
const CFSC_CATEGORIES = [
  {
    name: 'Bread/Bakery', avg_lbs: 15, default_unit: 'cases',
    keywords: ['bread', 'bakery', 'pastry', 'pastries', 'roll', 'rolls', 'bun', 'buns', 'bagel', 'bagels',
      'tortilla', 'tortillas', 'muffin', 'muffins', 'donut', 'donuts', 'cake', 'croissant', 'baked goods',
      'cookie', 'cookies', 'pie', 'pies', 'biscuit', 'loaf', 'loaves', 'conchas', 'tarts', 'cupcake',
      'breads', 'bimbo', 'bimbo sweets', 'bimbo treats'],
  },
  {
    name: 'Produce', avg_lbs: 25, default_unit: 'cases',
    keywords: ['apple', 'apples', 'banana', 'bananas', 'orange', 'oranges', 'potato', 'potatoes',
      'tomato', 'tomatoes', 'carrot', 'carrots', 'lettuce', 'broccoli', 'broccolini', 'spinach', 'grape', 'grapes',
      'berry', 'berries', 'blueberry', 'blueberries', 'strawberry', 'strawberries', 'raspberry', 'raspberries',
      'blackberry', 'blackberries', 'cherry', 'cherries',
      'melon', 'melons', 'watermelon', 'watermelons', 'cantaloupe', 'cantaloupes',
      'vegetable', 'vegetables', 'fruit', 'fruits', 'produce',
      'salad', 'salads', 'greens', 'celery', 'pepper', 'peppers', 'cucumber', 'cucumbers', 'cukes',
      'onion', 'onions', 'squash', 'zucchini', 'kale', 'avocado', 'avocados', 'mushroom', 'mushrooms', 'corn',
      'cabbage', 'cabbages', 'collards', 'collard greens', 'chard',
      'herbs', 'parsley', 'cilantro', 'lemon', 'lemons', 'lime', 'limes', 'citrus',
      'mango', 'mangos', 'mangoes', 'pear', 'pears', 'peach', 'peaches', 'plum', 'plums',
      'radish', 'radishes', 'beet', 'beets', 'turnip', 'turnips',
      'eggplant', 'eggplants', 'asparagus', 'artichoke', 'artichokes', 'tomatillo', 'tomatillos',
      'pineapple', 'pineapples', 'cauliflower', 'nectarine', 'nectarines',
      'bok choy', 'chayote', 'jicama', 'kiwi', 'clementine', 'clementines', 'tangerine', 'grapefruit',
      'romaine', 'arugula', 'spring mix', 'mixed greens', 'mixed produce', 'asst produce',
      'assorted produce', 'assorted veggies', 'mixed veggies', 'mixed fruit', 'assorted fruit',
      'veggie', 'veggies', 'veg', 'raisins', 'applesauce', 'brussel sprouts', 'brussels sprouts'],
  },
  {
    name: 'Non-Food', avg_lbs: 25, default_unit: 'cases',
    keywords: ['toilet paper', 'hygiene', 'clothing', 'toys', 'textiles', 'paper towel', 'paper towels',
      'soap', 'shampoo', 'diaper', 'diapers', 'wipes', 'sanitizer', 'gloves', 'masks', 'tissue',
      'non-food', 'baby wipes', 'hand soap', 'hand sanitizer', 'detergent', 'cleaning', 'laundry',
      'cascade', 'glade', 'toothbrush', 'toothpaste', 'deodorant'],
  },
  {
    name: 'Dairy', avg_lbs: 40, default_unit: 'cases',
    keywords: ['milk', 'oat milk', 'almond milk', 'soy milk', 'creamer',
      'half and half', 'half & half', 'coconut milk', 'protein shake',
      'dairy', 'mixed dairy'],
  },
  {
    name: 'Beverages', avg_lbs: 35, default_unit: 'cases',
    keywords: ['water', 'waters', 'juice', 'soda', 'soft drink', 'coffee', 'tea', 'beverage',
      'drink', 'drinks', 'kombucha', 'lemonade', 'gatorade', 'lacroix', 'sparkling water',
      'seltzer', 'pop', 'cola', 'pepsi', 'vitamin water', 'flavored water', 'propel', 'voss',
      'ice tea', 'iced tea', 'energy drink', 'coconut water'],
  },
  {
    name: 'Grocery', avg_lbs: 25, default_unit: 'cases',
    keywords: ['dry', 'cereal', 'cereals', 'pasta', 'rice', 'flour', 'sugar', 'bean', 'beans', 'lentil', 'lentils',
      'split peas', 'black eyed peas', 'sweet peas', 'yellow split peas', 'peas',
      'canned', 'soup', 'sauce', 'oil', 'spice', 'spices', 'condiment', 'grocery', 'oatmeal', 'oats',
      'grits', 'noodles', 'crackers', 'chips', 'snacks', 'peanut butter', 'jelly', 'ramen',
      'mac and cheese', 'mac cheese', 'pantry', 'shelf stable', 'granola', 'popcorn', 'pretzels',
      'cans', 'dried', 'stuffing', 'ketchup', 'salsa', 'seasoning', 'assorted dry', 'dry goods',
      'dried goods', 'shelf stable', 'canned goods', 'asst dry', 'random dry', 'misc dry',
      'mixed dry', 'mixed pantry', 'random pantry', 'asst grocery', 'mixed grocery',
      'walnuts', 'peanuts', 'almonds', 'pecans', 'nuts', 'pancake mix', 'takis'],
  },
  {
    name: 'Deli/Prepared', avg_lbs: 30, default_unit: 'cases',
    keywords: ['egg', 'eggs', 'yogurt', 'cheese', 'deli', 'prepared', 'refrigerated', 'hummus',
      'cream cheese', 'butter', 'cream', 'lunch meat', 'ham', 'hot dog', 'hot dogs',
      'sandwich', 'sandwiches', 'salad kit', 'salad kits', 'dip', 'guacamole',
      'prepared meals', 'gyros', 'breakfast', 'cooler', 'assorted cooler', 'asst cooler',
      'mixed deli', 'asst deli', 'refrigerated goods', 'queso fresco', 'queso'],
  },
  {
    name: 'Meat', avg_lbs: 45, default_unit: 'cases',
    keywords: ['chicken', 'beef', 'pork', 'turkey', 'meat', 'meats', 'fish', 'seafood', 'salmon',
      'bacon', 'ground beef', 'steak', 'tuna', 'shrimp', 'lamb', 'ribs', 'thigh', 'breast',
      'wing', 'sausage', 'sausages', 'frozen meat', 'frozen meats', 'frozen chicken',
      'asst meat', 'assorted meat', 'random meat', 'mixed meat'],
  },
  {
    name: 'Assorted Freezer', avg_lbs: 25, default_unit: 'cases',
    keywords: ['frozen', 'ice cream', 'pizza', 'pizzas', 'waffle', 'waffles', 'frozen bread',
      'frozen meals', 'frozen foods', 'frozen goods', 'popsicle', 'freezer',
      'frozen bakery', 'frozen rolls', 'frozen burritos'],
  },
]

// Pre-compile keyword regexes for word-boundary matching
for (const cat of CFSC_CATEGORIES) {
  cat._kwRegexes = cat.keywords.map(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`, 'i')
  })
}

// ============================================================
// Text normalization
// ============================================================
function normalize(text) {
  return text
    .replace(/<@[A-Z0-9]+>/g, '')            // Strip Slack user mentions
    .replace(/<#[A-Z0-9]+\|?[^>]*>/g, '')    // Strip Slack channel mentions
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[^\S\n]+/g, ' ')               // Collapse spaces but preserve newlines
}

// ============================================================
// Unit definitions and normalization
// ============================================================
const UNITS = [
  ['cases',    'cases?|cs',      'cs', 'case'],
  ['boxes',    'box(?:es)?|bx',  'bx', 'box'],
  ['bags',     'bags?',          'bag'],
  ['sacks',    'sacks?',         'sack'],
  ['bins',     'bins?',          'bin'],
  ['lbs',      'lbs?|pounds?',   'lb', 'pound', 'pounds'],
  ['pallets',  'pallets?',       'pallet'],
  ['crates',   'crates?',        'crate'],
  ['flats',    'flats?',         'flat'],
  ['items',    'items?',         'item'],
  ['dozen',    'dozen|dz',       'dz'],
  ['each',     'each'],
  ['gallons',  'gallons?',       'gallon'],
  ['packages', 'packages?|pkgs?|pks?', 'package', 'pk', 'pkg', 'pks', 'pkgs'],
  ['cans',     'cans?',          'can'],
  ['loaves',   'loaves|loafs?',  'loaf', 'loafs'],
  ['cartons',  'cartons?',       'carton'],
  ['tubs',     'tubs?',          'tub'],
  ['jars',     'jars?',          'jar'],
  ['bottles',  'bottles?',       'bottle'],
  ['bunches',  'bunch(?:es)?',   'bunch'],
  ['packs',    'packs?',         'pack'],
  ['trays',    'trays?',         'tray'],
]

const UNIT_WORDS = UNITS.map(u => u[1]).join('|')

const UNIT_NORMALIZE = {}
for (const [canonical, , ...aliases] of UNITS) {
  for (const alias of aliases) UNIT_NORMALIZE[alias] = canonical
}

function normalizeUnit(unit) {
  const lower = unit.toLowerCase()
  return UNIT_NORMALIZE[lower] || lower
}

// ============================================================
// Regex patterns
// ============================================================
const BULLET_PREFIX = '[-•*\\[\\]~\\s]*'
const QTY           = '(\\d+\\.?\\d*)'
const FRACTION      = `${QTY}\\s*(?:\\/\\s*${QTY})?`
const MODIFIER      = '(?:(?:misc|mixed|assorted|asst\\.?|random|big|large|small|medium|huge|heavy)\\s+)?'

const UNIT_PATTERN = new RegExp(
  `^${BULLET_PREFIX}~?${FRACTION}\\s*${MODIFIER}(${UNIT_WORDS})\\s+(?:of\\s+)?(.+)`, 'i'
)

const COMPOUND_PATTERN = new RegExp(
  `^${BULLET_PREFIX}~?(\\d+)\\s+(\\d+)[-\\s]?(${UNIT_WORDS})\\s+(?:of\\s+)?(.+)`, 'i'
)

// Reverse pattern: "Creamed Corn: 11 trays (24 cans per tray)"
// Captures: (1) item name before colon, (2) quantity, (3) unit
const REVERSE_UNIT_PATTERN = new RegExp(
  `^${BULLET_PREFIX}(.+?)\\s*:\\s*~?(\\d+\\.?\\d*)\\s*${MODIFIER}(${UNIT_WORDS})\\b`, 'i'
)

// ============================================================
// Word quantity conversion
// ============================================================
const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, half: 0.5,
}

function convertWordQuantities(line) {
  let s = line.trim()
  s = s.replace(/^([-•*\[\]~\s]*)a\s+dozen\b/i, '$112')
  s = s.replace(/^([-•*\[\]~\s]*)a\s+few\b/i, '$13')
  s = s.replace(/^([-•*\[\]~\s]*)(?:small|medium|large|big|huge)\s+/i, '$11 ')
  s = s.replace(/^([-•*\[\]~\s]*)(?:individual\s+)?(.+?)\s*\((\d+)\)\s*$/i, '$1$3 items $2')
  s = s.replace(/^([-•*\[\]~\s]*\d+)(case|box|bag|sack|pack|can|cs|bx|dozen|dz|crate|tray|pallet|bottle|jar|carton)/i, '$1 $2')
  const wordMatch = s.match(/^([-•*\[\]~\s]*)(\w+)\s+/)
  if (wordMatch) {
    const num = WORD_NUMBERS[wordMatch[2].toLowerCase()]
    if (num !== undefined) {
      s = wordMatch[1] + num + s.slice(wordMatch[0].length - 1)
    }
  }
  return s
}

// ============================================================
// Category detection
// ============================================================
export function detectCategory(itemName) {
  const lower = itemName.toLowerCase()
  if (/frozen\s+(meat|meats|chicken|beef|pork|turkey|fish|salmon|ribs|sausage|steak)/i.test(lower)) {
    return CFSC_CATEGORIES.find(c => c.name === 'Meat')
  }
  if (/ice\s*cream/i.test(lower)) {
    return CFSC_CATEGORIES.find(c => c.name === 'Assorted Freezer')
  }
  for (const cat of CFSC_CATEGORIES) {
    for (const regex of cat._kwRegexes) {
      if (regex.test(lower)) return cat
    }
  }
  return null
}

// ============================================================
// Weight estimation
// ============================================================
const RETAIL_BOX_KEYWORDS = [
  'cereal', 'cracker', 'pasta', 'rice', 'mac and cheese', 'mac n cheese', 'mac & cheese',
  'mac cheese', 'oatmeal', 'granola', 'snack', 'chip', 'chips', 'pretzel', 'popcorn',
  'cookie', 'cookies', 'tea', 'coffee', 'coffee pod', 'juice box', 'chocolate',
  'candy', 'bar', 'bars', 'tissue', 'rice pudding', 'fruit snack', 'ramen',
  'rice a roni', 'teething', 'smoothie', 'cream cheese snack',
]
const _retailBoxRegexes = RETAIL_BOX_KEYWORDS.map(kw => {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}`, 'i')
})

const COMPOUND_PRODUCT_NAMES = /\b(?:mac and cheese|salt and vinegar|bread and butter|peanut butter and jelly|half and half|rice and beans)\b/i

function isRetailBoxItem(itemName) {
  if (/,/.test(itemName)) return false
  if (/\s&\s/.test(itemName)) return false
  if (/\b(?:mixed|assorted|misc|various|asst|random)\b/i.test(itemName)) return false
  if (/\band\b/i.test(itemName) && !COMPOUND_PRODUCT_NAMES.test(itemName)) return false
  return _retailBoxRegexes.some(rx => rx.test(itemName))
}

export function estimateWeight(quantity, unit, category, itemName) {
  if (!category) return null
  const caseAvg = category.avg_lbs
  const r = (v) => Math.round(v * 10) / 10

  switch (unit) {
    case 'cases':
    case 'crates':
    case 'bins':
      return r(quantity * caseAvg)
    case 'boxes':
      if (itemName && isRetailBoxItem(itemName)) return r(quantity * 1.5)
      return r(quantity * caseAvg)
    case 'pallets':
      return r(quantity * caseAvg * 60)
    case 'trays':
    case 'flats':
      return r(quantity * caseAvg * 0.7)
    case 'sacks':
      return r(quantity * caseAvg)
    case 'bags':
      return r(quantity * caseAvg * 0.5)
    case 'cartons':
      return r(quantity * caseAvg * 0.4)
    case 'lbs':
      return r(quantity)
    case 'gallons':
      return r(quantity * 8)
    case 'dozen':
      if (category.name === 'Deli/Prepared') return r(quantity * 2)
      if (category.name === 'Bread/Bakery') return r(quantity * 12)
      if (category.name === 'Produce') return r(quantity * 5)
      return r(quantity * 5)
    case 'packages':
    case 'packs':
      return r(quantity * 3)
    case 'loaves':
      return r(quantity * 1.5)
    case 'cans':
    case 'jars':
    case 'bottles':
    case 'tubs':
    case 'items':
    case 'each':
    case 'bunches':
      return r(quantity * 1)
    default:
      return r(quantity * caseAvg)
  }
}

// ============================================================
// Item name cleaning
// ============================================================
function cleanItemName(raw) {
  return normalize(raw).trim()
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ============================================================
// Inline item splitting
// ============================================================
function splitInlineItems(text) {
  let cleaned = text.replace(
    /^(?:pick(?:ed)?\s+up|rescued?|grabbed|scooped)\s+(?:from\s+|at\s+)?[^0-9]*/i,
    ''
  ).trim()

  if (!cleaned) return text

  const splitPattern = new RegExp(`(?<=\\S)\\s+(?=\\d+\\.?\\d*\\s*(?:${UNIT_WORDS}))`, 'gi')
  const lines = cleaned.split(splitPattern)
  return lines.join('\n')
}

// ============================================================
// Main parser — parses text into structured items array
// ============================================================
export function parseItemsFromText(text, { inventoryMode = false } = {}) {
  // In inventory mode, items are already on separate lines — don't split
  // In rescue mode, split inline items (handles "3 cases produce 2 cases dairy")
  const expanded = inventoryMode ? text : splitInlineItems(text)
  const lines = expanded.split('\n')
  const items = []

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    const line = convertWordQuantities(trimmed)

    // Primary pattern: "3 cases produce"
    let match = line.match(UNIT_PATTERN)
    if (match) {
      let quantity = parseFloat(match[1])
      if (match[2]) {
        quantity = parseFloat(match[1]) / parseFloat(match[2])
      }
      const unit = normalizeUnit(match[3])
      const name = cleanItemName(match[4])
      if (name.length < 2) continue

      const cat = detectCategory(name)
      const estimated_lbs = estimateWeight(quantity, unit, cat, name)
      items.push({ name, quantity, unit, gcfd_category: cat?.name || null, estimated_lbs })
      continue
    }

    // Compound pattern: "4 12 packs of ice tea"
    const compMatch = line.match(COMPOUND_PATTERN)
    if (compMatch) {
      const quantity = parseFloat(compMatch[1])
      const unit = normalizeUnit(compMatch[3])
      const name = cleanItemName(compMatch[4])
      if (name.length < 2) continue

      const cat = detectCategory(name)
      const estimated_lbs = estimateWeight(quantity, unit, cat, name)
      items.push({ name, quantity, unit, gcfd_category: cat?.name || null, estimated_lbs })
      continue
    }

    // Unitless fallback: "6 fruit cups" (only if food keyword match)
    const unitlessMatch = line.match(/^[-•*\[\]~\s]*~?(\d+\.?\d*)\s+(?:of\s+)?(.+)/i)
    if (unitlessMatch) {
      const quantity = parseFloat(unitlessMatch[1])
      if (quantity > 500) continue
      const name = cleanItemName(unitlessMatch[2])
      if (name.length < 2) continue

      const cat = detectCategory(name)
      if (cat) {
        const fallbackUnit = cat.default_unit || 'cases'
        const estimated_lbs = estimateWeight(quantity, fallbackUnit, cat, name)
        items.push({ name, quantity, unit: fallbackUnit, gcfd_category: cat.name, estimated_lbs })
      }
      continue
    }

    // Reverse pattern: "Name: quantity unit (notes)"
    // e.g. "Creamed Corn: 11 trays (24 cans per tray)"
    const reverseMatch = line.match(REVERSE_UNIT_PATTERN)
    if (reverseMatch) {
      const name = cleanItemName(reverseMatch[1])
      const quantity = parseFloat(reverseMatch[2])
      const unit = normalizeUnit(reverseMatch[3])
      if (name.length >= 2) {
        const cat = detectCategory(name)
        // Accept if category recognized OR we're in inventory mode
        if (cat || inventoryMode) {
          const estimated_lbs = estimateWeight(quantity, unit, cat, name)
          items.push({ name, quantity, unit, gcfd_category: cat?.name || null, estimated_lbs })
          continue
        }
      }
    }

    // Inventory mode: bare item names without quantities — log the item but no weight estimate
    if (inventoryMode) {
      const bare = trimmed.replace(/^[-•*\[\]~\s]+/, '').trim()
      if (!bare || bare.length < 2) continue
      // Skip section headers / meta-text
      if (/^(?:in\s+(?:dry|cold|cooler|freezer)|(?:at\s+)?(?:uc|urban canopy|keystone)\s+going|going into|here'?s what|what we have|inventory|keystone\b|urban canopy\b|uc\b|warehouse|good variety|sorting|on hand|at uc\b|at urban canopy\b|dry\s*:|cold\s*:|cooler\s*:|freezer\s*:)/i.test(bare)) continue
      // Skip lines that look like descriptions, not items
      if (/^(?:need sorting|regular and|still)\b/i.test(bare)) continue
      // "lots of X" → extract item name
      const lotsMatch = bare.match(/^(?:lots of|tons of|some)\s+(.+)/i)
      const rawName = lotsMatch ? lotsMatch[1].replace(/\s+(?:still|left|remaining|too)\s*$/i, '') : bare
      // Strip parenthetical notes like "(need sorting)", "(tons!)", "(regular and blood orange)"
      const cleanBare = rawName.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*!+\s*/g, '').trim()
      if (!cleanBare || cleanBare.length < 2) continue
      const name = cleanItemName(cleanBare)
      const cat = detectCategory(name)
      // Log the item with no quantity/weight — just a name for the snapshot
      items.push({ name, quantity: null, unit: null, gcfd_category: cat?.name || null, estimated_lbs: null })
    }
  }

  return items
}

// ============================================================
// Location matching (taker orgs + rescue sources)
// ============================================================
const TAKER_ORGS = [
  { name: 'Love Fridge', patterns: ['love fridge', 'love fridges', 'la michoacana', 'lovefridge', 'lf took', 'lie fridge', 'live fridge', 'love shack', 'pulaski fridge', 'pulaski fridges'] },
  { name: 'BKMA', patterns: ['bkma', 'back of the yards'] },
  { name: 'SWC', patterns: ['swc'] },
  { name: 'WSMA', patterns: ['wsma', 'west side mutual aid', 'westside ma', 'westside mutual', 'west side ma'] },
  { name: 'PSN', patterns: ['psn', 'pilsen solidarity'] },
  { name: 'BYP', patterns: ['byp'] },
  { name: 'NA4J', patterns: ['na4j'] },
  { name: 'LSRSN', patterns: ['lsrsn', 'ls rsn', 'lsr'] },
  { name: 'EMAN', patterns: ['eman', 'edgewater mutual aid'] },
  { name: 'BSA', patterns: ['bsa'] },
  { name: 'UKV', patterns: ['ukv'] },
  { name: 'Marillac', patterns: ['marillac', 'merillac', 'merrilac'] },
  { name: 'Port Ministries', patterns: ['port ministries', 'port &', 'port and'] },
  { name: 'Pilsen Food Pantry', patterns: ['pilsen food pantry', 'pilsen pantry', 'pfp'] },
  { name: 'Pilsen Free Store', patterns: ['pilsen free store', 'pilsen free'] },
  { name: 'Sweet Water Foundation', patterns: ['sweet water', 'sweetwater'] },
  { name: 'New Hope', patterns: ['new hope'] },
  { name: 'Just Roots', patterns: ['just roots'] },
  { name: 'Northwestern Settlement', patterns: ['northwestern settlement'] },
  { name: 'NWMA', patterns: ['nwma', 'northwest mutual aid'] },
  { name: 'NSSN', patterns: ['nssn'] },
  { name: 'AMA', patterns: ['ama/nssn', 'ama '] },
  { name: 'RP FNB', patterns: ['rp fnb', 'rogers park fnb', 'rogers park free store'] },
  { name: 'Humble Hearts', patterns: ['humble hearts', 'humble heart'] },
  { name: 'Bryn Mawr Warming Center', patterns: ['bryn mawr warming', 'warming center', 'bryn mawr distro', 'bryn mawr log'] },
  { name: 'United Neighbors', patterns: ['united neighbors'] },
  { name: 'Avondale Mutual Aid', patterns: ['avondale mutual', 'avondale ma', 'avondale took', 'avondale grabbed', 'avondale picked', 'avondale'] },
  { name: 'OWMCL', patterns: ['owmcl', 'o.w.m.c.l', 'owmcl-chicago', 'd2 mutual aid', 'd2 precinct'] },
  { name: 'Todo Para Todos', patterns: ['todo para todos', 'todos para todos', 'tpt'] },
  { name: 'SSMA', patterns: ['ssma', 'south side mutual aid'] },
  { name: 'FNB', patterns: ['fnb ', 'food not bombs', '#everybodyeats', 'everybody eats'] },
  { name: 'RCC', patterns: ['rcc', 'refugee community connection', 'refugee community'] },
  { name: 'Task Force Chicago', patterns: ['task force chicago', 'task force'] },
  { name: 'East Garfield', patterns: ['mr wiggins', 'mr. wiggins', 'wiggins', 'anderson', 'east garfield', 'garfield park', 'austin distro', 'austin'] },
  { name: 'Nuevos Vecinos', patterns: ['nuevos vecinos', 'nv '] },
  { name: 'D2 Precinct', patterns: ['d2 precinct', 'district 2'] },
  { name: 'D10 Precinct', patterns: ['d10 precinct', 'district 10', 'd10'] },
  { name: 'D11 Precinct', patterns: ['d11 precinct', 'district 11', 'd11'] },
  { name: 'Stone Temple', patterns: ['stone temple'] },
  { name: 'Bill H', patterns: ['bill h '] },
  { name: 'Woodlawn Distro', patterns: ['woodlawn distro', 'woodlawn'] },
  { name: 'DPG', patterns: ['dpg', 'took to dpg'] },
  { name: 'LV Free Store', patterns: ['lv free store', 'lv free'] },
  { name: 'Casa al Fatiha', patterns: ['casa al fatiha', 'casa al'] },
  { name: 'Migrant Centers', patterns: ['migrant center', 'migrant centres'] },
  { name: 'District 7', patterns: ['district 7', 'd7 '] },
  { name: 'Breathing Room', patterns: ['breathing room'] },
]

const RESCUE_LOCATIONS = {
  'Aldi Wicker Park': ['aldi wp', 'wp aldi', 'wp adli', 'aldi wicker park', 'wicker park aldi', 'aldi n milwaukee', 'aldis wp', 'aldis wicker park', 'aldi wicker'],
  'Aldi Hodgkins': ['aldi hodgkins', 'hodgkins aldi', 'hodgkins'],
  'Aldi Lyons': ['aldi lyons', 'lyons aldi'],
  'Aldi Cicero': ['aldi cicero', 'cicero aldi'],
  'Aldi Englewood': ['aldi englewood', 'englewood aldi', 'englewood aldis', '63rd aldi', 'aldi 63rd', 'aldi on 63rd'],
  'Aldi Belmont': ['aldi belmont', 'belmont aldi', 'aldi avondale', 'avondale aldi', 'belmont aldis', 'aldis belmont'],
  'Aldi Kostner': ['aldi kostner', 'kostner aldi', 'aldis kostner', 'aldi on kostner', 'aldi n. kostner', 'aldi n kostner', '1440 kostner', '1440 n kostner'],
  "Mariano's": ['marianos', "mariano's", 'mariano'],
  "Mariano's South Loop": ['sl marianos', "mariano's sl", 'marianos sl', 'marianos south loop', 'south loop marianos', 's loop marianos', 's loop mariano'],
  'Whole Foods': ['whole foods', 'englewood whole foods', 'wf'],
  "Trader Joe's": ['trader joes', "trader joe's", 'trader joe', "tj's", 'tjs'],
  'Costco': ['costco'],
  'Above & Beyond': ['above and beyond', 'above & beyond', 'above &amp; beyond', 'a&b', 'a&amp;b'],
  'Jewel': ['jewel', 'jewel osco'],
  'Target': ['target'],
  'Fresh Thyme': ['fresh thyme'],
  "Pete's": ['petes', "pete's", "pete's fresh market"],
  'Local Foods': ['local foods'],
  'Sysco': ['sysco'],
  'Cold Chain': ['cold chain'],
  'Sharing Excess': ['sharing excess'],
  'Imperfect': ['imperfect', 'imperfect foods', 'misfits market', 'misfits'],
  'Logan Square Farmers Market': ['logan sq farmers market', 'logan square farmers market', 'logan square market', 'lsfm',
    "logan square farmer's market", "logan sq farmer's", 'ligan sq farmers', 'logan square fm', 'logan sq fm',
    "ls farmer's market", 'ls farmers market'],
  "What's Good Food": ['whats good', "what's good"],
  'Friendship Center': ['friendship center', 'friendship pick up', 'friendship pickup'],
  'CNO Financial': ['cno financial', 'cno'],
  // IPCFP merged into Irving Park Food Pantry
  'Walmart': ['walmart'],
  'Green City Market': ['green city market', 'green city', 'gcm'],
  "Dorothy's Bakery": ['dorothy', "dorothy's bakery"],
  'MSI': ['msi'],
  'Humboldt Health': ['humboldt health'],
  'F2F': ['f2f'],
  'Global Refugee Farm': ['global refugee'],
  'San Lucas': ['san lucas'],
  'Joined Hands': ['joined hands'],
  'Division Street Farmers Market': ['division street farmers', 'division st farmers', 'division street market', 'division st market'],
  'South Loop Farmers Market': ['south loop farmers', 'south loop market'],
  'Produce Market': ['produce market'],
  'Farm Link Project': ['farm link', 'farmlink'],
  'Irving Park Food Pantry': ['irving park', 'irving park pantry', 'irving park food pantry', 'ipfrc', 'icfp', 'irving park community', 'ipcfp'],
  'Uptown Baptist Church': ['uptown baptist'],
  'New Life GAP': ['new life gap', 'new life'],
  'Lollapalooza': ['lollapalooza', 'lolla'],
  'West Suburbs Community Pantry': ['west suburbs community pantry', 'wesr suburbs community pantry', 'ws community pantry'],
  '827 S Pulaski': ['827 s pulaski', '817 s pulaski'],
  'Nourishing Hope': ['nourishing hope'],
  'NWS': ['nws'],
}

const DROP_OFF_LOCATIONS = {
  'Urban Canopy': ['uc', 'urban canopy'],
  'Keystone': ['keystone', '2311 keystone'],
  ...Object.fromEntries(TAKER_ORGS.map(o => [o.name, o.patterns])),
}

function stripApostrophes(s) { return s.replace(/'/g, '') }
function stripNoise(s) { return stripApostrophes(s).replace(/@/g, ' ').replace(/\s+/g, ' ').trim() }

export function matchRescueLocation(text) {
  const lower = stripNoise(normalize(text).toLowerCase())
  for (const [canonical] of Object.entries(RESCUE_LOCATIONS)) {
    if (stripNoise(canonical.toLowerCase()) === lower) return canonical
  }
  let bestMatch = null
  let bestLen = 0
  for (const [canonical, aliases] of Object.entries(RESCUE_LOCATIONS)) {
    for (const alias of aliases) {
      const stripped = stripNoise(alias)
      if (lower.includes(stripped) && stripped.length > bestLen) {
        bestMatch = canonical
        bestLen = stripped.length
      }
    }
  }
  return bestMatch
}

export function matchDropOffLocation(text) {
  const lower = stripNoise(normalize(text).toLowerCase())
  for (const [canonical, aliases] of Object.entries(DROP_OFF_LOCATIONS)) {
    if (stripNoise(canonical.toLowerCase()) === lower) return canonical
    for (const alias of aliases) {
      if (lower.includes(stripNoise(alias))) return canonical
    }
  }
  return null
}

export function matchTakerOrg(text) {
  const lower = stripApostrophes(normalize(text).toLowerCase())
  for (const org of TAKER_ORGS) {
    for (const pat of org.patterns) {
      if (lower.includes(stripApostrophes(pat))) return org.name
    }
  }
  return null
}

// ============================================================
// Inventory detection
// ============================================================
const INVENTORY_POSITIVE = [
  /\binventory\b/i,
  /\bon hand\b/i,
  /\bgoing into the weekend\b/i,
  /\bwhat we have\b/i,
  /\bwhat'?s\s+(?:left|available|on hand)\b/i,
  /\bcurrently\s+(?:have|on hand|stocked)\b/i,
  /\bin\s+(?:stock|the warehouse|the cooler|the freezer|cold storage|dry storage|dry rack)\b/i,
  /\bstill have\b/i,
  /\bremaining\b/i,
  /\bavailable\s+(?:at|for)\b/i,
  /\b(?:north|south|east|west)\s+wall\b/i,
  /\bdry goods inventory\b/i,
  /\bfreezer inventory\b/i,
  /\bcooler inventory\b/i,
  /\bhere'?s what\b/i,
  /\bwhat'?s in\b/i,
]

const RESCUE_NEGATIVE = [
  /\b(?:picked up|rescued|scooped|grabbed)\s+(?:\S+\s+){0,3}(?:from|at)\b/i,
  /\b(?:dropped off|delivered|took to|brought to)\b/i,
  /\bdropped\s+from\b/i,
  /\btook\s*:/i,
  /\breceived\s+(?:on|from|at|today|yesterday|last)\b/i,
  /\b(?:excess\s+)?rescue\s+from\b/i,
  /\bpallets?\s+(?:excess\s+)?rescue\b/i,
]

// Messages that should never be classified as inventory (or rescue)
const NON_FOOD_LOG = [
  /\bproposed purchase\b/i,
  /\bpurchase\s+for\s+this\s+week\b/i,
  /\bpurchase order\b/i,
  /\border form\b/i,
  /\bwhat I ordered\b/i,
  /\bordered\b.*\$\d/i,           // "ordered" + dollar amounts
  /\$\d.*\bordered\b/i,           // dollar amounts + "ordered"
  /\btotal\s*[=:]\s*\$\d/i,       // "Total= $1,328" or "Total: $500"
]

function isInventoryMessage(text) {
  // Filter out non-food-log messages (proposed purchases, etc.)
  if (NON_FOOD_LOG.some(rx => rx.test(text))) return false
  const hasPositive = INVENTORY_POSITIVE.some(rx => rx.test(text))
  if (!hasPositive) return false
  const hasRescueLanguage = RESCUE_NEGATIVE.some(rx => rx.test(text))
  if (hasRescueLanguage) return false
  const mentionsWarehouse = /\b(uc|urban canopy|keystone|2311)\b/i.test(text)
  if (!mentionsWarehouse) return false
  // Long prose without bullet points / line breaks is not an inventory list
  const hasList = /[•*-]\s+\w|^\s*\w+\s*$/m.test(text) || text.split('\n').length >= 4
  if (!hasList && text.length > 200) return false
  return true
}

// ============================================================
// Message classification
// ============================================================
export function classifyMessage(text) {
  const normalized = normalize(text)
  const lower = normalized.toLowerCase()
  let rescueLocation = null
  let dropOffLocation = null
  let classification = 'unknown'

  // Step -2: Skip non-food-log messages (proposed purchases, order forms, etc.)
  if (NON_FOOD_LOG.some(rx => rx.test(lower))) {
    return { rescueLocation: null, dropOffLocation: null, classification: 'non_food_log' }
  }

  // Step -1: Inventory detection — catch warehouse inventory snapshots early
  if (isInventoryMessage(lower)) {
    if (/\bkeystone\b/i.test(lower)) {
      return { rescueLocation: 'Keystone', dropOffLocation: null, classification: 'inventory' }
    }
    return { rescueLocation: 'Urban Canopy', dropOffLocation: null, classification: 'inventory' }
  }

  // Step 0: "[Org] picked up from [Location]" — org is the actor, not the destination
  // e.g. "SWC picked up from SL Mariano's on Tuesday:" → rescue from Mariano's South Loop
  // Also handles: "me and others from SWC picked up from Marillac:"
  // Also handles mid-message: "10 crates dairy\nSWC scooped this from SL Mariano's and took to X"
  // Also handles day words: "SWC picked up today from X", "SWC picked up on Wednesday from X"
  // Also handles "took from": "SWC took from Aldi Hodgkins:" (but NOT "SWC took:" which is Step 1)
  // Does NOT apply when the source is a warehouse (UC/Keystone) — that's Step 1 territory
  const orgPickedFromMatch = lower.match(/(?:^|\n)\s*(?:from\s+)?(\w[\w\s&/.'-]*?)\s+(?:picked up|pick up|rescued|grabbed|scooped|took)(?:\s+(?:today|yesterday|(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+\d+[-/]\d+)?))?(?:\s+(?:this|it|everything|stuff))?\s+(?:from|at)\s+(.+?)(?:\s+on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)\b.*?)?(?:[:\n,]|\s+and\s+(?:took|dropped|delivered)|dropped\s+off|\s*$)/im)
  if (orgPickedFromMatch) {
    const orgName = orgPickedFromMatch[1].trim()
    const locationText = orgPickedFromMatch[2].trim()
    const resolved = matchRescueLocation(locationText)
    // Only use Step 0 if the resolved location is NOT a warehouse (UC/Keystone)
    // Warehouse pickups are handled by Step 1 as distributions
    if (resolved && !/^(Urban Canopy|Keystone)$/i.test(resolved)) {
      rescueLocation = resolved
      classification = 'explicit_rescue'
      // Check for drop-off: "Took to X", "dropped off @ X", "dropped off at X", "and took to X"
      const dropMatch = lower.match(/(?:(?:and\s+)?took\s+to|delivered\s+to|dropped\s+(?:off\s+)?(?:at|to|@))\s+(.+?)(?:\s*$|\s*\n)/im)
      if (dropMatch) {
        const dropResolved = matchDropOffLocation(dropMatch[1].trim())
        if (dropResolved) dropOffLocation = dropResolved
      }
      return { rescueLocation, dropOffLocation, classification }
    }
  }

  // Step 1: "X took:" pattern (warehouse distribution)
  const tookMatch = lower.match(/^(\w[\w\s&/.'-]*?)\s*\n?\s*(?:took|grabbed|picked up|scooped|is taking|taking|sited took)[:\s]/i)
  if (tookMatch) {
    const subject = tookMatch[1].trim()
    const taker = matchTakerOrg(subject)
    if (taker) {
      dropOffLocation = taker
      rescueLocation = /keystone|2311/i.test(lower) ? 'Keystone' : 'Urban Canopy'
      classification = 'warehouse_distribution'
      return { rescueLocation, dropOffLocation, classification }
    }
    if (/took\s*:/i.test(lower.slice(0, 80))) {
      const words = subject.split(/\s+/)
      const NOISE_WORDS = ['i', 'we', 'he', 'she', 'they', 'it', 'the', 'a', 'an', 'on', 'in', 'at',
        'for', 'to', 'from', 'with', 'this', 'that', 'and', 'or', 'but', 'left', 'just',
        'also', 'last', 'today', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      const isNoisy = words.length > 4 || NOISE_WORDS.includes(words[0].toLowerCase())
      if (!isNoisy) {
        dropOffLocation = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        rescueLocation = 'Urban Canopy'
        classification = 'warehouse_distribution'
        return { rescueLocation, dropOffLocation, classification }
      }
    }
  }

  // Step 1b: "for X" or "taking for X" patterns
  const forMatch = lower.match(/(?:taking |took |picked up |grabbed |for )\s*([a-z][\w\s&/'.-]*?)(?:\s*[-:,\n]|\s+(?:last|today|yesterday|this|in |at ))/i)
  if (forMatch) {
    const subject = forMatch[1].trim()
    const taker = matchTakerOrg(subject)
    if (taker && !rescueLocation) {
      dropOffLocation = taker
    }
  }

  // Step 2: Explicit rescue patterns
  const rescuePatterns = [
    /(?:rescued?|picked up|pickup|scooped|grabbed)\s+(?:(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)\s+)?(?:from|at)\s+([^.\n,:]+)/i,
    /^rescue\s+from\s+([^.\n,:]+)/im,
    /(?:dropped(?:\s+off)?|delivery)\s+(?:from)\s*([^.\n,:]+)/i,
    /(?:from|dropped from)\s+(aldi[^.\n,:]*)/i,
    /^from\s+(\w[\w\s,'.-]+?)(?:\s*[:\n,]|$)/im,
  ]
  for (const pat of rescuePatterns) {
    const m = text.match(pat)
    if (m) {
      const resolved = matchRescueLocation(m[1].trim())
      if (resolved) {
        rescueLocation = resolved
        classification = 'explicit_rescue'
        break
      }
    }
  }

  // Step 2b: "Dropped [location]:" pattern (no "from")
  if (!rescueLocation) {
    const droppedLocMatch = normalized.match(/^dropped\s+([^:\n,]+?)\s*(?:with\s+[^:\n]+?)?\s*:/im)
    if (droppedLocMatch) {
      const resolved = matchRescueLocation(droppedLocMatch[1].trim())
      if (resolved) {
        rescueLocation = resolved
        classification = 'dropped_location'
      }
    }
  }

  // Step 3: Explicit drop-off patterns
  const dropPatterns = [
    /(?:dropped(?:\s+off)?|delivered|took to|brought to)\s+(?:at\s+|to\s+)?([^.\n,:]+)/i,
    /(?:to|at)\s+(UC|Keystone|Urban Canopy)\b/i,
  ]
  for (const pat of dropPatterns) {
    const m = text.match(pat)
    if (m) {
      const resolved = matchDropOffLocation(m[1].trim())
      if (resolved) {
        dropOffLocation = resolved
        break
      }
    }
  }

  if (rescueLocation) {
    return { rescueLocation, dropOffLocation, classification }
  }

  // Step 4: Taker org as subject
  const orgSubjectMatch = lower.match(/^(\w[\w\s&/]*?)\s*[-:]\s*\d/i)
  if (orgSubjectMatch) {
    const subject = orgSubjectMatch[1].trim()
    const taker = matchTakerOrg(subject)
    if (taker) {
      dropOffLocation = taker
      rescueLocation = 'Urban Canopy'
      classification = 'taker_listed_items'
      return { rescueLocation, dropOffLocation, classification }
    }
  }

  // Step 5: Scan for any known rescue source
  const foundRescue = matchRescueLocation(lower)
  if (foundRescue) {
    rescueLocation = foundRescue
    classification = 'implicit_rescue'
    return { rescueLocation, dropOffLocation, classification }
  }

  // Step 6: Generic aldi fallback
  if (/\baldi[s']?\b/i.test(lower)) {
    rescueLocation = 'Aldi (unknown)'
    classification = 'generic_aldi'
    return { rescueLocation, dropOffLocation, classification }
  }

  // Step 7: Warehouse mention
  if (/\b(uc|urban canopy)\b/i.test(lower)) {
    rescueLocation = 'Urban Canopy'
    classification = 'warehouse_inventory'
  } else if (/\bkeystone\b/i.test(lower)) {
    rescueLocation = 'Keystone'
    classification = 'warehouse_inventory'
  }

  // Step 8: Any taker org mentioned
  if (!rescueLocation) {
    const anyTaker = matchTakerOrg(lower)
    if (anyTaker) {
      dropOffLocation = anyTaker
      rescueLocation = 'Urban Canopy'
      classification = 'taker_mentioned'
    }
  }

  // Step 9: Standalone "Dropped:", "Received from"
  if (!rescueLocation) {
    if (/^(?:just\s+)?(?:dropped|dripped)\s*(?:off)?\s*[:\n]/im.test(normalized) ||
        /^(?:just\s+)?(?:dropped|dripped)\s+(?:off\s+)?(?:some|a few|several|today|last night|this morning)/im.test(lower) ||
        /^received\s+(?:from\s+)?/im.test(lower) ||
        /^(?:we\s+)?dropped\s+(?:off\s+)?\n/im.test(normalized)) {
      rescueLocation = 'Urban Canopy'
      classification = 'warehouse_drop'
    }
  }

  // Step 10: "Dropped with X from Y"
  if (!rescueLocation) {
    const droppedWithMatch = lower.match(/dropped\s+(?:with\s+)?(\w[\w\s]*?)\s+from\s+(\w[\w\s]*?)(?:\s*[:.\n,]|$)/i)
    if (droppedWithMatch) {
      const possibleTaker = matchTakerOrg(droppedWithMatch[1].trim())
      const possibleRescue = matchRescueLocation(droppedWithMatch[2].trim())
      if (possibleTaker) dropOffLocation = possibleTaker
      if (possibleRescue) {
        rescueLocation = possibleRescue
        classification = 'dropped_with_from'
      }
    }
  }

  // Step 11: Generic warehouse pickup patterns
  if (!rescueLocation) {
    if (/^(?:grabbed|took)\s*[:\n]/im.test(normalized) ||
        /^(?:grabbed|took)\s+(?:some|a few|for\s)/im.test(lower) ||
        /^picked up for\s/im.test(lower) ||
        /^(?:last night'?s?\s+)?drop\s/im.test(lower) ||
        /^delivery acquired/im.test(lower) ||
        /^on hand\s/im.test(lower) ||
        /^dropped\s+\d+\s+(?:cases?|boxes?|pallets?|bags?|cs|bx)/im.test(lower) ||
        /dropped\s+(?:in|on)\s+(?:cold storage|dry rack|shelf|shelves|cooler|freezer)/im.test(lower)) {
      rescueLocation = 'Urban Canopy'
      classification = 'warehouse_inventory'
    }
  }

  // Step 12: "Picked up for [taker]"
  if (!rescueLocation) {
    const pickedForMatch = lower.match(/picked up for\s+([^:\n,]+)/i)
    if (pickedForMatch) {
      const taker = matchTakerOrg(pickedForMatch[1].trim())
      if (taker) {
        dropOffLocation = taker
        rescueLocation = 'Urban Canopy'
        classification = 'warehouse_distribution'
      }
    }
  }

  return {
    rescueLocation: rescueLocation || null,
    dropOffLocation,
    classification: rescueLocation ? classification : 'unknown',
  }
}

// ============================================================
// Multi-destination split
// ============================================================
function matchDropOffLocationWithSpan(text) {
  const lower = stripApostrophes(normalize(text).toLowerCase())
  for (const [canonical, aliases] of Object.entries(DROP_OFF_LOCATIONS)) {
    if (stripApostrophes(canonical.toLowerCase()) === lower) {
      return { name: canonical, endIndex: text.length }
    }
    for (const alias of aliases) {
      const strippedAlias = stripApostrophes(alias)
      const idx = lower.indexOf(strippedAlias)
      if (idx !== -1) {
        let aliasEnd = idx + strippedAlias.length
        const remainder = text.slice(aliasEnd)
        const digitRe = /\s+(?=\d)/g
        let dm
        while ((dm = digitRe.exec(remainder)) !== null) {
          const candidate = remainder.slice(dm.index).trim()
          const testItems = parseItemsFromText(candidate)
          if (testItems.length > 0) {
            return { name: canonical, endIndex: aliasEnd + dm.index }
          }
        }
        return { name: canonical, endIndex: text.length }
      }
    }
  }
  return null
}

function deduplicateItems(primary, secondary) {
  const secondaryCats = secondary.map(i => ({ cat: i.gcfd_category, qty: i.quantity }))
  const result = []
  for (const item of primary) {
    const matchIdx = secondaryCats.findIndex(
      s => s.cat && s.cat === item.gcfd_category && s.qty === item.quantity
    )
    if (matchIdx !== -1) {
      secondaryCats.splice(matchIdx, 1)
    } else {
      result.push(item)
    }
  }
  return result
}

export function splitByDropOff(sectionText, defaultDropOff) {
  const dropPattern = /(?:dropped(?:\s+off)?\s+(?:at|to)|delivered\s+(?:at|to)|took\s+(?:at|to|for))\s+(.+)/i
  const lines = sectionText.split('\n')

  let dropLineIdx = -1
  let dropLocationRaw = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (i === 0) continue
    const m = line.match(dropPattern)
    if (m) {
      const resolved = matchDropOffLocation(m[1])
      if (resolved) {
        dropLineIdx = i
        dropLocationRaw = resolved
        break
      }
    }
  }

  // Single-line: try mid-line match
  if (dropLineIdx === -1 && lines.length <= 2) {
    const fullText = sectionText
    const midLineMatch = fullText.match(/(.+?)\s+(?:dropped(?:\s+off)?\s+(?:at|to)|delivered\s+(?:at|to)|took\s+(?:at|to|for))\s+(.+)/i)
    if (midLineMatch) {
      const afterDrop = midLineMatch[2]
      const span = matchDropOffLocationWithSpan(afterDrop)
      if (span) {
        const beforeText = midLineMatch[1]
        const afterItemsText = afterDrop.slice(span.endIndex).trim()
        const afterItems = parseItemsFromText(splitInlineItems(afterItemsText || afterDrop))
        const beforeItems = parseItemsFromText(splitInlineItems(beforeText))

        if (beforeItems.length > 0 && afterItems.length > 0) {
          const dedupedBefore = deduplicateItems(beforeItems, afterItems)
          if (dedupedBefore.length > 0) {
            return [
              { items: dedupedBefore, dropOff: defaultDropOff, rawText: beforeText.trim() },
              { items: afterItems, dropOff: span.name, rawText: afterItemsText.trim() },
            ]
          }
        }
      }
    }
  }

  if (dropLineIdx === -1) return null

  const beforeLines = lines.slice(0, dropLineIdx)
  const afterLines = lines.slice(dropLineIdx)
  const beforeText = beforeLines.join('\n')
  const afterText = afterLines.join('\n')
  const beforeItems = parseItemsFromText(beforeText)
  const afterItems = parseItemsFromText(afterText)

  if (beforeItems.length === 0 || afterItems.length === 0) return null

  const dedupedBefore = deduplicateItems(beforeItems, afterItems)
  if (dedupedBefore.length === 0) return null

  return [
    { items: dedupedBefore, dropOff: defaultDropOff, rawText: beforeText.trim() },
    { items: afterItems, dropOff: dropLocationRaw, rawText: afterText.trim() },
  ]
}

// ============================================================
// Section splitting for compound messages
// ============================================================
export function splitSections(text) {
  let sections = text.split(/\n\s*---+\s*\n/)

  const rescueStartPattern = /^(?:pick(?:ed)?\s+up|rescued?|grabbed|scooped)\s+(?:(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)\s+)?(?:from\s+|at\s+)?(\w)/im

  const finalSections = []
  for (const section of sections) {
    const lines = section.split('\n')
    let currentLines = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) {
        currentLines.push(lines[i])
        continue
      }
      if (i > 0 && rescueStartPattern.test(line)) {
        const currentText = currentLines.join('\n').trim()
        if (currentText && parseItemsFromText(currentText).length > 0) {
          finalSections.push(currentText)
          currentLines = []
        }
      }
      currentLines.push(lines[i])
    }

    const remaining = currentLines.join('\n').trim()
    if (remaining) finalSections.push(remaining)
  }

  return finalSections.filter(s => s.length > 0)
}

// ============================================================
// High-level: process a full message into food log record(s)
// ============================================================
export function processMessageText(text) {
  const sections = splitSections(text)
  const records = []

  for (const section of sections) {
    const { rescueLocation, dropOffLocation, classification } = classifyMessage(section)
    if (classification === 'non_food_log') continue
    const defaultDropOff = dropOffLocation || null
    const record_type = classification === 'inventory' ? 'inventory' : 'rescue'
    const inventoryMode = classification === 'inventory'

    const items = parseItemsFromText(section, { inventoryMode })
    if (items.length === 0) continue

    // Try multi-destination split
    const splits = splitByDropOff(section, defaultDropOff || 'Urban Canopy')
    if (splits) {
      for (const split of splits) {
        const totalLbs = split.items.reduce((sum, item) => sum + (item.estimated_lbs || 0), 0)
        records.push({
          rescue_location_name: rescueLocation || 'Unknown',
          drop_off_location_name: split.dropOff,
          items: split.items,
          total_estimated_lbs: Math.round(totalLbs * 10) / 10,
          classification,
          record_type,
          raw_text: split.rawText,
        })
      }
    } else {
      const totalLbs = items.reduce((sum, item) => sum + (item.estimated_lbs || 0), 0)
      records.push({
        rescue_location_name: rescueLocation || 'Unknown',
        drop_off_location_name: defaultDropOff,
        items,
        total_estimated_lbs: Math.round(totalLbs * 10) / 10,
        classification,
        record_type,
        raw_text: section,
      })
    }
  }

  return records
}

// ============================================================
// Exports for testing (internal helpers)
// ============================================================
export {
  normalize, normalizeUnit, convertWordQuantities,
  isRetailBoxItem, cleanItemName, splitInlineItems,
  stripApostrophes, matchDropOffLocationWithSpan, deduplicateItems,
  CFSC_CATEGORIES, UNIT_PATTERN, COMPOUND_PATTERN, UNIT_WORDS,
}
