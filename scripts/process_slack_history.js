/**
 * Process historical Slack messages from XLSX into structured food_logs.
 *
 * Parses items, maps to CFSC categories, estimates weights,
 * resolves rescue vs drop-off locations, and outputs:
 *   - slack_history_parsed.jsonl (structured records)
 *   - review_unknowns.md (human-readable list of unresolved messages)
 *
 * Usage: node scripts/process_slack_history.js
 */
import XLSX from 'xlsx'
import { writeFileSync } from 'fs'

// ============================================================
// CFSC Categories with keywords for matching
// ============================================================
const CFSC_CATEGORIES = [
  {
    name: 'Bread/Bakery', avg_lbs: 15, default_unit: 'cases', aldi: 'Bread',
    keywords: ['bread', 'bakery', 'pastry', 'pastries', 'roll', 'rolls', 'bun', 'buns', 'bagel', 'bagels',
      'tortilla', 'tortillas', 'muffin', 'muffins', 'donut', 'donuts', 'cake', 'croissant', 'baked goods',
      'cookie', 'cookies', 'pie', 'pies', 'biscuit', 'loaf', 'loaves', 'conchas', 'tarts', 'cupcake',
      'breads', 'bimbo', 'bimbo sweets', 'bimbo treats'],
  },
  {
    name: 'Produce', avg_lbs: 25, default_unit: 'cases', aldi: 'Produce',
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
    name: 'Non-Food', avg_lbs: 25, default_unit: 'cases', aldi: 'Non-Food',
    keywords: ['toilet paper', 'hygiene', 'clothing', 'toys', 'textiles', 'paper towel', 'paper towels',
      'soap', 'shampoo', 'diaper', 'diapers', 'wipes', 'sanitizer', 'gloves', 'masks', 'tissue',
      'non-food', 'baby wipes', 'hand soap', 'hand sanitizer', 'detergent', 'cleaning', 'laundry',
      'cascade', 'glade', 'toothbrush', 'toothpaste', 'deodorant'],
  },
  {
    name: 'Dairy', avg_lbs: 40, default_unit: 'cases', aldi: 'Dairy',
    keywords: ['milk', 'oat milk', 'almond milk', 'soy milk', 'creamer',
      'half and half', 'half & half', 'coconut milk', 'protein shake',
      'dairy', 'mixed dairy'],
  },
  {
    name: 'Beverages', avg_lbs: 35, default_unit: 'cases', aldi: 'Drinks',
    keywords: ['water', 'waters', 'juice', 'soda', 'soft drink', 'coffee', 'tea', 'beverage',
      'drink', 'drinks', 'kombucha', 'lemonade', 'gatorade', 'lacroix', 'sparkling water',
      'seltzer', 'pop', 'cola', 'pepsi', 'vitamin water', 'flavored water', 'propel', 'voss',
      'ice tea', 'iced tea', 'energy drink', 'coconut water'],
  },
  {
    name: 'Grocery', avg_lbs: 25, default_unit: 'cases', aldi: 'Assorted Dry',
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
    name: 'Deli/Prepared', avg_lbs: 30, default_unit: 'cases', aldi: 'Assorted Cooler',
    keywords: ['egg', 'eggs', 'yogurt', 'cheese', 'deli', 'prepared', 'refrigerated', 'hummus',
      'cream cheese', 'butter', 'cream', 'lunch meat', 'ham', 'hot dog', 'hot dogs',
      'sandwich', 'sandwiches', 'salad kit', 'salad kits', 'dip', 'guacamole',
      'prepared meals', 'gyros', 'breakfast', 'cooler', 'assorted cooler', 'asst cooler',
      'mixed deli', 'asst deli', 'refrigerated goods', 'queso fresco', 'queso'],
  },
  {
    name: 'Meat', avg_lbs: 45, default_unit: 'cases', aldi: 'Meat',
    keywords: ['chicken', 'beef', 'pork', 'turkey', 'meat', 'meats', 'fish', 'seafood', 'salmon',
      'bacon', 'ground beef', 'steak', 'tuna', 'shrimp', 'lamb', 'ribs', 'thigh', 'breast',
      'wing', 'sausage', 'sausages', 'frozen meat', 'frozen meats', 'frozen chicken',
      'asst meat', 'assorted meat', 'random meat', 'mixed meat'],
  },
  {
    name: 'Assorted Freezer', avg_lbs: 25, default_unit: 'cases', aldi: 'Assorted Freezer',
    keywords: ['frozen', 'ice cream', 'pizza', 'pizzas', 'waffle', 'waffles', 'frozen bread',
      'frozen meals', 'frozen foods', 'frozen goods', 'popsicle', 'freezer',
      'frozen bakery', 'frozen rolls', 'frozen burritos'],
  },
]

// ============================================================
// Text normalization — curly quotes, smart apostrophes
// ============================================================
function normalize(text) {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes → straight
    .replace(/[\u2014\u2013]/g, '-')                 // em/en dash → hyphen
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')     // curly double quotes → straight
    .replace(/&amp;/g, '&')                           // HTML entity &amp; → &
    .replace(/&lt;/g, '<')                            // HTML entity &lt; → <
    .replace(/&gt;/g, '>')                            // HTML entity &gt; → >
    .replace(/&nbsp;/g, ' ')                          // HTML non-breaking space
}

// ============================================================
// Locations — separated into RESCUE sources vs DROP-OFF destinations
// ============================================================

// Organizations that TAKE food from the warehouse (they are drop-off destinations)
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
  { name: 'Above & Beyond', patterns: ['above and beyond', 'above & beyond', 'a&b', 'a&amp;b'] },
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
]

// Places food is RESCUED FROM (stores, farms, distributors)
const RESCUE_LOCATIONS = {
  'Aldi Wicker Park': ['aldi wp', 'wp aldi', 'wp adli', 'aldi wicker park', 'wicker park aldi', 'aldi n milwaukee', 'aldis wp', 'aldis wicker park', 'aldi wicker'],
  'Aldi Hodgkins': ['aldi hodgkins', 'hodgkins aldi', 'hodgkins'],
  'Aldi Lyons': ['aldi lyons', 'lyons aldi'],
  'Aldi Cicero': ['aldi cicero', 'cicero aldi'],
  'Aldi Englewood': ['aldi englewood', 'englewood aldi', 'englewood aldis', '63rd aldi', 'aldi 63rd', 'aldi on 63rd'],
  'Aldi Belmont': ['aldi belmont', 'belmont aldi', 'aldi avondale', 'avondale aldi', 'belmont aldis', 'aldis belmont'],
  'Aldi Kostner': ['aldi kostner', 'kostner aldi', 'aldis kostner', 'aldi on kostner', '1440 kostner', '1440 n kostner'],
  "Mariano's": ['marianos', "mariano's", 'mariano'],
  "Mariano's South Loop": ['sl marianos', "mariano's sl", 'marianos sl', 'marianos south loop', 'south loop marianos'],
  'Whole Foods': ['whole foods', 'englewood whole foods', 'wf'],
  "Trader Joe's": ['trader joes', "trader joe's", 'trader joe', "tj's", 'tjs'],
  'Costco': ['costco'],
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
}

// Places food is DROPPED OFF (warehouse, community orgs)
const DROP_OFF_LOCATIONS = {
  'Urban Canopy': ['uc', 'urban canopy'],
  'Keystone': ['keystone', '2311 keystone'],
  ...Object.fromEntries(TAKER_ORGS.map(o => [o.name, o.patterns])),
}

// ============================================================
// Item parsing
// ============================================================

// ── Single source of truth for all recognized units ──────────
// Each entry: [canonical, regexPattern, ...aliases]
//   canonical:  the normalized plural form used everywhere
//   regex:      regex fragment for UNIT_WORDS (handles singular/plural)
//   aliases:    abbreviations that normalize to canonical
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

// Build UNIT_WORDS regex from the table
const UNIT_WORDS = UNITS.map(u => u[1]).join('|')

// Build normalization map from the table
const UNIT_NORMALIZE = {}
for (const [canonical, , ...aliases] of UNITS) {
  for (const alias of aliases) UNIT_NORMALIZE[alias] = canonical
}

function normalizeUnit(unit) {
  const lower = unit.toLowerCase()
  return UNIT_NORMALIZE[lower] || lower
}

// ── Shared regex fragments ───────────────────────────────────
const BULLET_PREFIX = '[-•*\\[\\]~\\s]*'                             // leading bullet/whitespace
const QTY           = '(\\d+\\.?\\d*)'                               // numeric quantity
const FRACTION      = `${QTY}\\s*(?:\\/\\s*${QTY})?`                 // "3" or "1/2"
const MODIFIER      = '(?:(?:misc|mixed|assorted|asst\\.?|random|big|large|small|medium|huge|heavy)\\s+)?'

// Primary pattern: "3 cases produce", "1/2 case bread", "6 misc cans veg"
const UNIT_PATTERN = new RegExp(
  `^${BULLET_PREFIX}~?${FRACTION}\\s*${MODIFIER}(${UNIT_WORDS})\\s+(?:of\\s+)?(.+)`, 'i'
)

// Compound pattern: "4 12 packs of ice tea", "4 12-packs ice tea"
const COMPOUND_PATTERN = new RegExp(
  `^${BULLET_PREFIX}~?(\\d+)\\s+(\\d+)[-\\s]?(${UNIT_WORDS})\\s+(?:of\\s+)?(.+)`, 'i'
)

// ── Word quantities pre-processing ──────────────────────────
const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, half: 0.5,
}

function convertWordQuantities(line) {
  let s = line.trim()
  // Multi-word phrases first
  s = s.replace(/^([-•*\[\]~\s]*)a\s+dozen\b/i, '$112')
  s = s.replace(/^([-•*\[\]~\s]*)a\s+few\b/i, '$13')
  // Size words without a number → treat as qty 1: "Small box" → "1 box"
  s = s.replace(/^([-•*\[\]~\s]*)(?:small|medium|large|big|huge)\s+/i, '$11 ')
  // Parenthetical quantities: "fruit cups(20)" → "20 items fruit cups"
  s = s.replace(/^([-•*\[\]~\s]*)(?:individual\s+)?(.+?)\s*\((\d+)\)\s*$/i, '$1$3 items $2')
  // No-space fix: "1case" → "1 case" (generated from UNITS table)
  s = s.replace(/^([-•*\[\]~\s]*\d+)(case|box|bag|sack|pack|can|cs|bx|dozen|dz|crate|tray|pallet|bottle|jar|carton)/i, '$1 $2')
  // Single word numbers: "Four packages" → "4 packages"
  const wordMatch = s.match(/^([-•*\[\]~\s]*)(\w+)\s+/)
  if (wordMatch) {
    const num = WORD_NUMBERS[wordMatch[2].toLowerCase()]
    if (num !== undefined) {
      s = wordMatch[1] + num + s.slice(wordMatch[0].length - 1)
    }
  }
  return s
}

// Pre-compile keyword regexes for word-boundary matching (avoids "tea" in "steak")
for (const cat of CFSC_CATEGORIES) {
  cat._kwRegexes = cat.keywords.map(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`, 'i')
  })
}

function detectCategory(itemName) {
  const lower = itemName.toLowerCase()
  // Specific overrides before general keyword matching
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

/**
 * Estimate weight based on quantity, unit, and category.
 * The category avg_lbs represents weight per CASE. Other units need scaling.
 */
// Items typically sold in small retail boxes at stores (~1 lb each).
// "8 boxes of crackers" = 8 retail boxes, not 8 large cardboard shipping cases.
// Contrast with "2 boxes of apples" which IS a large cardboard box.
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
// Known product names that contain "and" — these are single items, not lists
const COMPOUND_PRODUCT_NAMES = /\b(?:mac and cheese|salt and vinegar|bread and butter|peanut butter and jelly|half and half|rice and beans)\b/i

function isRetailBoxItem(itemName) {
  // If the name lists multiple items (commas, &, "and") or says mixed/assorted,
  // it's a big box packed with assorted stuff, not a single retail box.
  if (/,/.test(itemName)) return false
  if (/\s&\s/.test(itemName)) return false
  if (/\b(?:mixed|assorted|misc|various|asst|random)\b/i.test(itemName)) return false
  // "and" between items means multi-item box, UNLESS it's a known compound name
  if (/\band\b/i.test(itemName) && !COMPOUND_PRODUCT_NAMES.test(itemName)) return false
  return _retailBoxRegexes.some(rx => rx.test(itemName))
}

function estimateWeight(quantity, unit, category, itemName) {
  if (!category) return null
  const caseAvg = category.avg_lbs
  const r = (v) => Math.round(v * 10) / 10

  switch (unit) {
    // Cases/crates/bins — always bulk containers, use category average
    case 'cases':
    case 'crates':
    case 'bins':
      return r(quantity * caseAvg)

    // Boxes — could be retail (cereal, crackers) or bulk (apples, meat)
    case 'boxes':
      if (itemName && isRetailBoxItem(itemName)) {
        return r(quantity * 1.5)  // retail boxes avg ~1-2 lbs
      }
      return r(quantity * caseAvg)  // bulk cardboard box

    // Pallets — roughly 20 cases
    case 'pallets':
      return r(quantity * caseAvg * 20)

    // Trays/flats — roughly 70% of a case
    case 'trays':
    case 'flats':
      return r(quantity * caseAvg * 0.7)

    // Sacks — big sacks of produce (potatoes, onions) are ~25 lbs
    case 'sacks':
      return r(quantity * caseAvg)

    // Bags — roughly half a case
    case 'bags':
      return r(quantity * caseAvg * 0.5)

    // Cartons — roughly 40% of a case (smaller containers)
    case 'cartons':
      return r(quantity * caseAvg * 0.4)

    // Pounds — quantity IS the weight
    case 'lbs':
      return r(quantity)

    // Gallons — ~8.3 lbs per gallon
    case 'gallons':
      return r(quantity * 8)

    // Dozen — per-dozen weights vary by item type
    case 'dozen':
      if (category.name === 'Deli/Prepared') return r(quantity * 2)
      if (category.name === 'Bread/Bakery') return r(quantity * 12)
      if (category.name === 'Produce') return r(quantity * 5)
      return r(quantity * 5)

    // Packages/packs — retail size, ~3-5 lbs typically
    case 'packages':
    case 'packs':
      return r(quantity * 3)

    // Loaves — ~1.5 lbs each
    case 'loaves':
      return r(quantity * 1.5)

    // Individual containers/items — ~1 lb each
    case 'cans':
    case 'jars':
    case 'bottles':
    case 'tubs':
    case 'items':
    case 'each':
    case 'bunches':
      return r(quantity * 1)

    // Fallback — use case average
    default:
      return r(quantity * caseAvg)
  }
}

function cleanItemName(raw) {
  return normalize(raw).trim()          // normalize HTML entities + smart quotes
    .replace(/\s*[-–—]\s*$/, '')       // trailing dash
    .replace(/\s*\(.*?\)\s*$/, '')      // trailing parens
    .replace(/<[^>]+>/g, '')            // Slack formatting
    .replace(/\s+/g, ' ')
    .trim()
}

function parseItemsFromMessage(text) {
  const lines = text.split('\n')
  const items = []

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    // Pre-process: convert word quantities to digits
    const line = convertWordQuantities(trimmed)

    // Try primary pattern: "3 cases produce" or "6 misc cans veg"
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

    // Try compound pattern: "4 12 packs of ice tea" → qty=4, unit=packs, name="ice tea"
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

    // Fallback: unitless items like "6 fruit cups", "50 loaves of bread"
    // Only match if the item name contains a known food keyword (avoid matching addresses/noise)
    const unitlessMatch = line.match(/^[-•*\[\]~\s]*~?(\d+\.?\d*)\s+(?:of\s+)?(.+)/i)
    if (unitlessMatch) {
      const quantity = parseFloat(unitlessMatch[1])
      if (quantity > 500) continue  // skip very large numbers (probably addresses, etc.)
      const name = cleanItemName(unitlessMatch[2])
      if (name.length < 2) continue

      const cat = detectCategory(name)
      if (cat) {
        // No unit specified — fall back to category's default unit (typically cases)
        const fallbackUnit = cat.default_unit || 'cases'
        const estimated_lbs = estimateWeight(quantity, fallbackUnit, cat, name)
        items.push({ name, quantity, unit: fallbackUnit, gcfd_category: cat.name, estimated_lbs })
      }
    }
  }

  return items
}

// ============================================================
// Location classification — multi-step logic
// ============================================================

// Strip apostrophes for fuzzy matching ("Aldis'" → "Aldis", "Mariano's" → "Marianos")
function stripApostrophes(s) { return s.replace(/'/g, '') }

function matchRescueLocation(text) {
  const lower = stripApostrophes(normalize(text).toLowerCase())
  // Check for exact canonical match first
  for (const [canonical, aliases] of Object.entries(RESCUE_LOCATIONS)) {
    if (stripApostrophes(canonical.toLowerCase()) === lower) return canonical
  }
  // Find the location with the longest matching alias (prefer specific over generic)
  let bestMatch = null
  let bestLen = 0
  for (const [canonical, aliases] of Object.entries(RESCUE_LOCATIONS)) {
    for (const alias of aliases) {
      const stripped = stripApostrophes(alias)
      if (lower.includes(stripped) && stripped.length > bestLen) {
        bestMatch = canonical
        bestLen = stripped.length
      }
    }
  }
  return bestMatch
}

function matchDropOffLocation(text) {
  const lower = stripApostrophes(normalize(text).toLowerCase())
  for (const [canonical, aliases] of Object.entries(DROP_OFF_LOCATIONS)) {
    if (stripApostrophes(canonical.toLowerCase()) === lower) return canonical
    for (const alias of aliases) {
      if (lower.includes(stripApostrophes(alias))) return canonical
    }
  }
  return null
}

// Like matchDropOffLocation but also returns the position where the matched
// alias ends in the original text, so callers can split location from items.
// Scans forward past address text (e.g. "21st and Cali") to find where items begin.
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

        // Try each digit occurrence in the remainder — the first one that
        // starts a parseable item list is where the items begin.
        const digitRe = /\s+(?=\d)/g
        let dm
        while ((dm = digitRe.exec(remainder)) !== null) {
          const candidate = remainder.slice(dm.index).trim()
          const testItems = parseItemsFromMessage(candidate)
          if (testItems.length > 0) {
            return { name: canonical, endIndex: aliasEnd + dm.index }
          }
        }

        // No items found after alias — the whole text is just the location
        return { name: canonical, endIndex: text.length }
      }
    }
  }
  return null
}

function matchTakerOrg(text) {
  const lower = stripApostrophes(normalize(text).toLowerCase())
  for (const org of TAKER_ORGS) {
    for (const pat of org.patterns) {
      if (lower.includes(stripApostrophes(pat))) return org.name
    }
  }
  return null
}

/**
 * Classify a message into rescue_location and drop_off_location.
 *
 * Message patterns observed in the Slack history:
 *
 * 1. WAREHOUSE DISTRIBUTION: Someone at UC/Keystone says "BKMA took: 5 boxes produce"
 *    → rescue_location = "Urban Canopy" or "Keystone" (warehouse), drop_off = "BKMA"
 *
 * 2. STORE RESCUE: "Rescued from Aldi WP: 10 cases bread"
 *    → rescue_location = "Aldi Wicker Park", drop_off = null
 *
 * 3. STORE TO WAREHOUSE: "Picked up from Aldi Belmont, dropped at UC"
 *    → rescue_location = "Aldi Belmont", drop_off = "Urban Canopy"
 *
 * 4. TAKER PICKUP: "Love Fridge picked up 8 bags produce"
 *    → rescue_location = "Urban Canopy" (warehouse default), drop_off = "Love Fridge"
 *
 * 5. GENERIC ALDI: "Dropped from Aldi: 5 boxes produce"
 *    → rescue_location = "Aldi (unknown)", drop_off = null
 */
function classifyMessage(text) {
  const normalized = normalize(text)
  const lower = normalized.toLowerCase()
  let rescueLocation = null
  let dropOffLocation = null
  let classification = 'unknown'

  // ----- Step 0: "[Org] picked up from [Location]" — org is the actor, not the destination -----
  // e.g. "SWC picked up from SL Mariano's on Tuesday:" → rescue from Mariano's South Loop
  // Also handles mid-message: "10 crates dairy\nSWC scooped this from SL Mariano's and took to X"
  // Does NOT apply when the source is a warehouse (UC/Keystone) — that's Step 1 territory
  const orgPickedFromMatch = lower.match(/(?:^|\n)\s*(?:from\s+)?(\w[\w\s&/.'-]*?)\s+(?:picked up|rescued|grabbed|scooped)\s+(?:(?:this|it|everything|stuff)\s+)?(?:from|at)\s+(.+?)(?:\s+on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)\b.*?)?(?:[:\n,]|\s+and\s+(?:took|dropped|delivered)|dropped\s+off|\s*$)/im)
  if (orgPickedFromMatch) {
    const orgName = orgPickedFromMatch[1].trim()
    const locationText = orgPickedFromMatch[2].trim()
    const resolved = matchRescueLocation(locationText)
    if (resolved && !/^(Urban Canopy|Keystone)$/i.test(resolved)) {
      rescueLocation = resolved
      classification = 'explicit_rescue'
      const dropMatch = lower.match(/(?:(?:and\s+)?took\s+to|delivered\s+to|dropped\s+(?:off\s+)?(?:at|to|@))\s+(.+?)(?:\s*$|\s*\n)/im)
      if (dropMatch) {
        const dropResolved = matchDropOffLocation(dropMatch[1].trim())
        if (dropResolved) dropOffLocation = dropResolved
      }
      return { rescueLocation, dropOffLocation, classification }
    }
  }

  // ----- Step 1: Check for "X took:" pattern (warehouse distribution) -----
  // Also handle multiline "Avondale\ngrabbed:" and "sited took:" (typo for "site took")
  const tookMatch = lower.match(/^(\w[\w\s&/.'-]*?)\s*\n?\s*(?:took|grabbed|picked up|scooped|is taking|taking|sited took)[:\s]/i)
  if (tookMatch) {
    const subject = tookMatch[1].trim()
    const taker = matchTakerOrg(subject)
    if (taker) {
      dropOffLocation = taker
      // The rescue source is the warehouse (UC or Keystone — try to detect which)
      if (/keystone|2311/i.test(lower)) {
        rescueLocation = 'Keystone'
      } else {
        rescueLocation = 'Urban Canopy'  // default warehouse
      }
      classification = 'warehouse_distribution'
      return { rescueLocation, dropOffLocation, classification }
    }
    // Even if we don't recognize the org, if it ends in "took:", it's likely a taker
    // Use the raw subject as the drop-off name — but only if it looks like a short org name
    // (avoid garbage like "Left this at uc and" or "On Wednesday Avondale")
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

  // ----- Step 1b: Check for "for X" or "taking for X" patterns -----
  const forMatch = lower.match(/(?:taking |took |picked up |grabbed |for )\s*([a-z][\w\s&/'.-]*?)(?:\s*[-:,\n]|\s+(?:last|today|yesterday|this|in |at ))/i)
  if (forMatch) {
    const subject = forMatch[1].trim()
    const taker = matchTakerOrg(subject)
    if (taker && !rescueLocation) {
      dropOffLocation = taker
    }
  }

  // ----- Step 2: Check for explicit "rescued/picked up/dropped from [store]" -----
  const rescuePatterns = [
    /(?:rescued?|picked up|pickup|scooped|grabbed)\s+(?:(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)\s+)?(?:from|at)\s+([^.\n,:]+)/i,
    /^rescue\s+from\s+([^.\n,:]+)/im,
    /(?:dropped(?:\s+off)?|delivery)\s+(?:from)\s*([^.\n,:]+)/i,   // handles "fromAldi" (no space)
    /(?:from|dropped from)\s+(aldi[^.\n,:]*)/i,
    /^from\s+(\w[\w\s,'.-]+?)(?:\s*[:\n,]|$)/im,                   // "From Sree, Logan Square..." → "From X"
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

  // ----- Step 2b: Check for "Dropped [location]:" pattern (no "from") -----
  // e.g. "Dropped Mariano's:" means rescued from Mariano's
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

  // ----- Step 3: Check for explicit drop-off patterns -----
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

  // If we found a rescue location in step 2, we're done
  if (rescueLocation) {
    return { rescueLocation, dropOffLocation, classification }
  }

  // ----- Step 4: Check if a taker org is mentioned as the subject/actor -----
  // Pattern: "Love Fridge: 5 bags produce" or "BKMA - 3 boxes bread"
  const orgSubjectMatch = lower.match(/^(\w[\w\s&/]*?)\s*[-:]\s*\d/i)
  if (orgSubjectMatch) {
    const subject = orgSubjectMatch[1].trim()
    const taker = matchTakerOrg(subject)
    if (taker) {
      dropOffLocation = taker
      rescueLocation = 'Urban Canopy'  // default warehouse
      classification = 'taker_listed_items'
      return { rescueLocation, dropOffLocation, classification }
    }
  }

  // ----- Step 5: Scan whole message for any known rescue source -----
  const foundRescue = matchRescueLocation(lower)
  if (foundRescue) {
    rescueLocation = foundRescue
    classification = 'implicit_rescue'
    return { rescueLocation, dropOffLocation, classification }
  }

  // ----- Step 6: Generic "aldi" or "aldis" fallback -----
  if (/\baldi[s']?\b/i.test(lower)) {
    rescueLocation = 'Aldi (unknown)'
    classification = 'generic_aldi'
    return { rescueLocation, dropOffLocation, classification }
  }

  // ----- Step 7: If UC or Keystone mentioned but no rescue source found -----
  // These are warehouse messages where someone listed what arrived/is available
  if (/\b(uc|urban canopy)\b/i.test(lower)) {
    rescueLocation = 'Urban Canopy'
    classification = 'warehouse_inventory'
  } else if (/\bkeystone\b/i.test(lower)) {
    rescueLocation = 'Keystone'
    classification = 'warehouse_inventory'
  }

  // ----- Step 8: Check if any taker org is mentioned anywhere -----
  if (!rescueLocation) {
    const anyTaker = matchTakerOrg(lower)
    if (anyTaker) {
      dropOffLocation = anyTaker
      rescueLocation = 'Urban Canopy'  // default warehouse
      classification = 'taker_mentioned'
    }
  }

  // ----- Step 9: Standalone "Dropped:", "Dripped:" (typo), or "Received from" -----
  // These are people dropping food at the warehouse (UC) — warehouse inventory
  if (!rescueLocation) {
    if (/^(?:just\s+)?(?:dropped|dripped)\s*(?:off)?\s*[:\n]/im.test(normalized) ||
        /^(?:just\s+)?(?:dropped|dripped)\s+(?:off\s+)?(?:some|a few|several|today|last night|this morning)/im.test(lower) ||
        /^received\s+(?:from\s+)?/im.test(lower) ||
        /^(?:we\s+)?dropped\s+(?:off\s+)?\n/im.test(normalized)) {
      rescueLocation = 'Urban Canopy'
      classification = 'warehouse_drop'
    }
  }

  // ----- Step 10: "Dropped with X from Y" pattern -----
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

  // ----- Step 11: Generic "Grabbed:", "Took\n", "Picked up for [X]" with no location -----
  // These are warehouse pickups where someone took items
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

  // ----- Step 12: "Picked up for [taker]" patterns -----
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
// Group consecutive messages from same user
// ============================================================
function groupMessages(messages) {
  const groups = []
  let current = null

  for (const msg of messages) {
    const ts = new Date(msg.Timestamp).getTime()

    if (current && current.user === msg.User) {
      const timeDiff = ts - current.lastTs
      // Merge if within 10 minutes
      if (timeDiff < 10 * 60 * 1000) {
        current.text += '\n' + (msg.Message || '')
        current.lastTs = ts
        current.rawMessages.push(msg.Message || '')
        continue
      }
    }

    // Start new group
    if (current) groups.push(current)
    current = {
      user: msg.User,
      timestamp: msg.Timestamp,
      firstTs: ts,
      lastTs: ts,
      text: msg.Message || '',
      rawMessages: [msg.Message || ''],
    }
  }
  if (current) groups.push(current)

  return groups
}

// ---------------------------------------------------------------------------
// splitInlineItems: splits a single-line text containing multiple items
// into separate lines so parseItemsFromMessage can handle them.
//
// Example: "4 cases meat 1case bread 2 boxes snacks 4 cases deli"
//       → "4 cases meat\n1case bread\n2 boxes snacks\n4 cases deli"
//
// Also strips "Picked up [location]" prefixes from the text.
// ---------------------------------------------------------------------------
function splitInlineItems(text) {
  // Strip pickup prefix like "Picked up Mariano's" or "Rescued from Aldi WP"
  let cleaned = text.replace(
    /^(?:pick(?:ed)?\s+up|rescued?|grabbed|scooped)\s+(?:from\s+|at\s+)?[^0-9]*/i,
    ''
  ).trim()

  if (!cleaned) return text

  // Split on boundaries where a new quantity starts: look for digit preceded by
  // a letter (end of previous item name) and whitespace
  // e.g. "meat 1case" → split before "1case"; "snacks 4 cases" → split before "4"
  const splitPattern = new RegExp(`(?<=\\S)\\s+(?=\\d+\\.?\\d*\\s*(?:${UNIT_WORDS}))`, 'gi')
  const lines = cleaned.split(splitPattern)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Multi-destination split: detect mid-message "Dropped at [location]" and
// create separate records for items before vs after the drop-off marker.
//
// Example: "Picked up Mariano's 4 cases meat 1case bread 2 boxes snacks
//           4 cases deli  Dropped at love fridge 4 cases mixed deli"
// → Record 1: meat, bread, snacks → Urban Canopy (default warehouse)
// → Record 2: mixed deli → Love Fridge
// ---------------------------------------------------------------------------
function splitByDropOff(sectionText, rescueLocation, defaultDropOff) {
  // Match "Dropped (off)? (at|to)? [location]" mid-message followed by items.
  // Excludes "dropped from" which indicates a source, not a destination.
  const dropPattern = /(?:dropped(?:\s+off)?\s+(?:at|to)|delivered\s+(?:at|to)|took\s+(?:at|to|for))\s+(.+)/i
  const lines = sectionText.split('\n')

  // Find the line index where a drop-off marker appears
  let dropLineIdx = -1
  let dropLocationRaw = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    // Skip the first line (usually "Picked up from X") — we want mid-message drops
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

  // For single-line messages, try to find "Dropped at [location]" mid-line
  if (dropLineIdx === -1 && lines.length <= 2) {
    const fullText = sectionText
    const midLineMatch = fullText.match(/(.+?)\s+(?:dropped(?:\s+off)?\s+(?:at|to)|delivered\s+(?:at|to)|took\s+(?:at|to|for))\s+(.+)/i)
    if (midLineMatch) {
      const afterDrop = midLineMatch[2]
      const span = matchDropOffLocationWithSpan(afterDrop)
      if (span) {
        const beforeText = midLineMatch[1]
        // Strip the location portion and parse only the items that follow
        const afterItemsText = afterDrop.slice(span.endIndex).trim()
        const afterItems = parseItemsFromMessage(splitInlineItems(afterItemsText || afterDrop))

        // Split inline items and strip pickup prefix for parsing
        const beforeItems = parseItemsFromMessage(splitInlineItems(beforeText))

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

  const beforeItems = parseItemsFromMessage(beforeText)
  const afterItems = parseItemsFromMessage(afterText)

  if (beforeItems.length === 0 || afterItems.length === 0) return null

  const dedupedBefore = deduplicateItems(beforeItems, afterItems)
  if (dedupedBefore.length === 0) return null

  return [
    { items: dedupedBefore, dropOff: defaultDropOff, rawText: beforeText.trim() },
    { items: afterItems, dropOff: dropLocationRaw, rawText: afterText.trim() },
  ]
}

// Remove items from `primary` that appear to be restated in `secondary` (same category + qty).
// Handles "4 cases deli" in pickup + "4 cases mixed deli" in drop-off = same Deli/Prepared × 4.
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

// Split compound messages that contain multiple rescues in one post.
// Detects new rescue boundaries like "Pick up Mariano's SL" mid-message.
function splitSections(text) {
  // First split on explicit "---" separators
  let sections = text.split(/\n\s*---+\s*\n/)

  // Then split each section further if it contains multiple rescue starts
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

      // Check if this line starts a new rescue (not the first line)
      if (i > 0 && rescueStartPattern.test(line)) {
        // Only split if the current section has some content with items
        const currentText = currentLines.join('\n').trim()
        if (currentText && parseItemsFromMessage(currentText).length > 0) {
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
// Main processing
// ============================================================
console.log('Reading XLSX...')
const wb = XLSX.readFile('slack_messages.xlsx')
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])

// Filter to real messages only
const systemSubtypes = ['channel_join', 'channel_leave', 'channel_purpose', 'channel_topic']
const realMessages = data.filter(r => !r.Subtype || (!systemSubtypes.includes(r.Subtype) && r.Subtype !== 'bot_message'))

console.log(`Total messages: ${data.length}, real messages: ${realMessages.length}`)

// Sort by timestamp
realMessages.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp))

// Group consecutive messages from same user
const grouped = groupMessages(realMessages)
console.log(`Grouped into ${grouped.length} message groups`)

// Process each group
const results = []
const unknowns = []
let parsed = 0
let skipped = 0
const categoryCounts = {}
const classificationCounts = {}

for (const group of grouped) {
  const sections = splitSections(group.text)
  let anyParsed = false

  for (const section of sections) {
    const items = parseItemsFromMessage(section)
    if (items.length === 0) continue

    const { rescueLocation, dropOffLocation, classification } = classifyMessage(section)
    const defaultDropOff = dropOffLocation || 'Urban Canopy'

    // Check for multi-destination: items split across drop-off locations.
    // The "before" items default to warehouse (Urban Canopy) because classifyMessage's
    // dropOffLocation is typically the SAME location that splitByDropOff will assign
    // to the "after" items — we don't want both halves going to the same place.
    const multiDest = splitByDropOff(section, rescueLocation, 'Urban Canopy')

    if (multiDest) {
      // Create separate records for each destination
      for (const dest of multiDest) {
        const totalLbs = dest.items.reduce((sum, i) => sum + (i.estimated_lbs || 0), 0)

        for (const item of dest.items) {
          const cat = item.gcfd_category || 'Uncategorized'
          categoryCounts[cat] = (categoryCounts[cat] || 0) + (item.estimated_lbs || 0)
        }
        classificationCounts[classification] = (classificationCounts[classification] || 0) + 1

        const record = {
          rescue_location_name: rescueLocation || 'Unknown',
          drop_off_location_name: dest.dropOff,
          rescued_at: group.timestamp,
          rescued_by: group.user || null,
          items: dest.items,
          total_estimated_lbs: Math.round(totalLbs * 10) / 10,
          notes: null,
          source: 'import',
          classification: classification + '_multi',
          raw_text: section.trim(),
        }

        results.push(record)
        parsed++
      }
      anyParsed = true
      continue
    }

    // Single destination (normal case)
    const totalLbs = items.reduce((sum, i) => sum + (i.estimated_lbs || 0), 0)

    // Count categories
    for (const item of items) {
      const cat = item.gcfd_category || 'Uncategorized'
      categoryCounts[cat] = (categoryCounts[cat] || 0) + (item.estimated_lbs || 0)
    }

    // Count classifications
    classificationCounts[classification] = (classificationCounts[classification] || 0) + 1

    const record = {
      rescue_location_name: rescueLocation || 'Unknown',
      drop_off_location_name: defaultDropOff,
      rescued_at: group.timestamp,
      rescued_by: group.user || null,
      items,
      total_estimated_lbs: Math.round(totalLbs * 10) / 10,
      notes: null,
      source: 'import',
      classification,
      raw_text: section.trim(),
    }

    results.push(record)
    parsed++
    anyParsed = true

    // Track unknowns for review
    if (!rescueLocation) {
      unknowns.push({
        date: (group.timestamp || '').slice(0, 10),
        user: group.user,
        text: section.slice(0, 400),
        itemCount: items.length,
        totalLbs: Math.round(totalLbs),
      })
    }
  }

  if (!anyParsed) skipped++
}

// ============================================================
// Console output — summary
// ============================================================
console.log(`\nResults:`)
console.log(`  Parsed into food logs: ${parsed}`)
console.log(`  Skipped (no items): ${skipped}`)
console.log(`  Total estimated lbs: ${Math.round(results.reduce((s, r) => s + r.total_estimated_lbs, 0)).toLocaleString()}`)

console.log(`\nClassification breakdown:`)
const sortedClass = Object.entries(classificationCounts).sort((a, b) => b[1] - a[1])
for (const [cls, count] of sortedClass) {
  console.log(`  ${cls}: ${count}`)
}

console.log(`\nBy CFSC category (estimated lbs):`)
const sortedCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])
for (const [cat, lbs] of sortedCats) {
  console.log(`  ${cat}: ${Math.round(lbs).toLocaleString()} lbs`)
}

// Location breakdown
const byLocation = {}
for (const r of results) {
  const loc = r.rescue_location_name
  if (!byLocation[loc]) byLocation[loc] = { count: 0, lbs: 0 }
  byLocation[loc].count++
  byLocation[loc].lbs += r.total_estimated_lbs
}
const sortedLocs = Object.entries(byLocation).sort((a, b) => b[1].lbs - a[1].lbs)
console.log(`\nRescue locations (top 20):`)
for (const [loc, d] of sortedLocs.slice(0, 20)) {
  console.log(`  ${loc}: ${d.count} logs, ${Math.round(d.lbs).toLocaleString()} lbs`)
}
if (sortedLocs.length > 20) {
  console.log(`  ... ${sortedLocs.length - 20} more locations`)
}

// Drop-off breakdown
const byDropOff = {}
for (const r of results) {
  if (r.drop_off_location_name) {
    const loc = r.drop_off_location_name
    if (!byDropOff[loc]) byDropOff[loc] = { count: 0, lbs: 0 }
    byDropOff[loc].count++
    byDropOff[loc].lbs += r.total_estimated_lbs
  }
}
const sortedDrops = Object.entries(byDropOff).sort((a, b) => b[1].lbs - a[1].lbs)
console.log(`\nDrop-off destinations:`)
for (const [loc, d] of sortedDrops) {
  console.log(`  ${loc}: ${d.count} logs, ${Math.round(d.lbs).toLocaleString()} lbs`)
}

// Year breakdown
const byYear = {}
for (const r of results) {
  const y = (r.rescued_at || '').slice(0, 4)
  if (!byYear[y]) byYear[y] = { count: 0, lbs: 0 }
  byYear[y].count++
  byYear[y].lbs += r.total_estimated_lbs
}
console.log(`\nBy year:`)
for (const [year, d] of Object.entries(byYear).sort()) {
  console.log(`  ${year}: ${d.count} rescues, ${Math.round(d.lbs).toLocaleString()} lbs`)
}

// ============================================================
// Write JSONL output
// ============================================================
const outputPath = 'slack_history_parsed.jsonl'
const lines = results.map(r => JSON.stringify(r))
writeFileSync(outputPath, lines.join('\n'))
console.log(`\nWrote ${results.length} records to ${outputPath}`)

// ============================================================
// Write review_unknowns.md for human review
// ============================================================
let md = `# Unknown Location Messages — Review Needed\n\n`
md += `These ${unknowns.length} messages had items but no identifiable rescue location.\n`
md += `Review them to add new aliases or location patterns.\n\n`

for (let i = 0; i < unknowns.length; i++) {
  const u = unknowns[i]
  md += `---\n\n`
  md += `### #${i + 1} — ${u.date} (${u.itemCount} items, ~${u.totalLbs} lbs)\n`
  md += `**User:** ${u.user || 'unknown'}\n\n`
  md += '```\n' + u.text + '\n```\n\n'
}

writeFileSync('review_unknowns.md', md)
console.log(`Wrote ${unknowns.length} unknown messages to review_unknowns.md`)
