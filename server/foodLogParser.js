const UNIT_SPECS = [
  {
    key: 'lb',
    kind: 'weight',
    canonicalUnit: 'lb',
    aliases: ['lb', 'lbs', 'pound', 'pounds'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'kg',
    kind: 'weight',
    canonicalUnit: 'lb',
    aliases: ['kg', 'kgs', 'kilogram', 'kilograms'],
    toCanonical: (qty) => qty * 2.20462,
  },
  {
    key: 'g',
    kind: 'weight',
    canonicalUnit: 'lb',
    aliases: ['g', 'gram', 'grams'],
    toCanonical: (qty) => qty * 0.00220462,
  },
  {
    key: 'oz',
    kind: 'weight',
    canonicalUnit: 'lb',
    aliases: ['oz', 'ounce', 'ounces'],
    toCanonical: (qty) => qty / 16,
  },
  {
    key: 'ton',
    kind: 'weight',
    canonicalUnit: 'lb',
    aliases: ['ton', 'tons', 'tonne', 'tonnes'],
    toCanonical: (qty) => qty * 2000,
  },
  {
    key: 'gallon',
    kind: 'volume',
    canonicalUnit: 'gallon',
    aliases: ['gallon', 'gallons', 'gal'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'liter',
    kind: 'volume',
    canonicalUnit: 'gallon',
    aliases: ['liter', 'liters', 'litre', 'litres', 'l'],
    toCanonical: (qty) => qty * 0.264172,
  },
  {
    key: 'quart',
    kind: 'volume',
    canonicalUnit: 'gallon',
    aliases: ['quart', 'quarts', 'qt', 'qts'],
    toCanonical: (qty) => qty * 0.25,
  },
  {
    key: 'pint',
    kind: 'volume',
    canonicalUnit: 'gallon',
    aliases: ['pint', 'pints', 'pt', 'pts'],
    toCanonical: (qty) => qty * 0.125,
  },
  {
    key: 'bag',
    kind: 'container',
    canonicalUnit: 'bag',
    aliases: ['bag', 'bags', 'sack', 'sacks'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'case',
    kind: 'container',
    canonicalUnit: 'case',
    aliases: ['case', 'cases', 'carton', 'cartons'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'pallet',
    kind: 'container',
    canonicalUnit: 'pallet',
    aliases: ['pallet', 'pallets', 'pallete', 'pallette', 'pallett', 'palletts', 'pallettes'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'box',
    kind: 'container',
    canonicalUnit: 'box',
    aliases: ['box', 'boxes', 'crate', 'crates', 'bin', 'bins', 'tote', 'totes'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'bunch',
    kind: 'container',
    canonicalUnit: 'bunch',
    aliases: ['bunch', 'bunches'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'bottle',
    kind: 'container',
    canonicalUnit: 'bottle',
    aliases: ['bottle', 'bottles'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'can',
    kind: 'container',
    canonicalUnit: 'can',
    aliases: ['can', 'cans', 'tin', 'tins'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'jar',
    kind: 'container',
    canonicalUnit: 'jar',
    aliases: ['jar', 'jars'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'tray',
    kind: 'container',
    canonicalUnit: 'tray',
    aliases: ['tray', 'trays'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'clamshell',
    kind: 'container',
    canonicalUnit: 'clamshell',
    aliases: ['clamshell', 'clamshells'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'loaf',
    kind: 'container',
    canonicalUnit: 'loaf',
    aliases: ['loaf', 'loaves'],
    toCanonical: (qty) => qty,
  },
  {
    key: 'each',
    kind: 'count',
    canonicalUnit: 'each',
    aliases: ['each', 'ea', 'item', 'items', 'unit', 'units', 'piece', 'pieces'],
    toCanonical: (qty) => qty,
  },
]

const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  half: 0.5,
  quarter: 0.25,
  couple: 2,
  few: 3,
}

const numberWordPattern = Object.keys(NUMBER_WORDS).join('|')
const QUANTITY_REGEX = new RegExp(
  `^(?:[-*•]\\s*)?(?:about|approx(?:\\.|imately)?|around|~)?\\s*(${numberWordPattern}|\\d+(?:\\.\\d+)?)(?:\\s*(?:-|to|–|—)\\s*(\\d+(?:\\.\\d+)?))?`,
  'i',
)

const approxPrefixRegex = /^(?:[-*•]\s*)?(about|approx(?:\.|imately)?|around|~)/i

const unitAliasMap = new Map()
UNIT_SPECS.forEach((spec) => {
  spec.aliases.forEach((alias) => {
    unitAliasMap.set(alias.toLowerCase(), spec)
  })
})

const cleanToken = (token = '') => token.replace(/[^a-z0-9]/gi, '').toLowerCase()

const parseQuantityToken = (token = '') => {
  const numeric = Number(token.replace(/,/g, ''))
  if (!Number.isNaN(numeric)) return numeric
  const lower = token.toLowerCase()
  if (NUMBER_WORDS.hasOwnProperty(lower)) {
    return NUMBER_WORDS[lower]
  }
  return null
}

const computeConfidence = ({ hasQuantity, unitFound, item, approx }) => {
  let score = 0.3
  if (hasQuantity) score += 0.3
  if (unitFound) score += 0.25
  if (item) score += 0.1
  if (!unitFound) score -= 0.1
  if (approx) score -= 0.05
  return Math.min(0.98, Math.max(0.05, score))
}

export const parseFoodLogLine = (line = '') => {
  const trimmed = line.trim()
  if (!trimmed) return null

  const quantityMatch = trimmed.match(QUANTITY_REGEX)
  if (!quantityMatch) return null

  const quantityVal = parseQuantityToken(quantityMatch[1])
  if (quantityVal === null) return null

  const approx = approxPrefixRegex.test(trimmed)
  const hasRange = typeof quantityMatch[2] !== 'undefined' && quantityMatch[2] !== null
  const quantityMaxVal = hasRange ? Number(quantityMatch[2]) : quantityVal
  const quantity = hasRange ? (quantityVal + quantityMaxVal) / 2 : quantityVal

  const remainder = trimmed.slice(quantityMatch[0].length).trim()
  const tokens = remainder.split(/\s+/).filter(Boolean)

  let unitSpec = null
  let unitToken = ''
  let itemStartIdx = 0

  // Try to resolve a unit from the first two tokens; handles typos like "pallett"
  for (let i = 0; i < Math.min(tokens.length, 2); i += 1) {
    const candidate = cleanToken(tokens[i])
    const found = unitAliasMap.get(candidate)
    if (found) {
      unitSpec = found
      unitToken = tokens[i]
      itemStartIdx = i + 1
      break
    }
  }

  let implicitUnit = false
  if (!unitSpec) {
    unitSpec = unitAliasMap.get('each')
    implicitUnit = true
    itemStartIdx = 0
  }

  let itemTokens = tokens.slice(itemStartIdx)
  if (itemTokens[0]?.toLowerCase() === 'of') {
    itemTokens = itemTokens.slice(1)
  }

  const item = itemTokens.join(' ').replace(/^[^a-z0-9]+/i, '').replace(/[.,;]+$/, '')

  const canonicalQuantity = unitSpec.toCanonical(quantity)
  const canonicalQuantityMin = unitSpec.toCanonical(Math.min(quantityVal, quantityMaxVal))
  const canonicalQuantityMax = unitSpec.toCanonical(Math.max(quantityVal, quantityMaxVal))

  const confidence = computeConfidence({
    hasQuantity: true,
    unitFound: !implicitUnit,
    item,
    approx,
  })

  return {
    raw: trimmed,
    quantity,
    quantityMin: Math.min(quantityVal, quantityMaxVal),
    quantityMax: Math.max(quantityVal, quantityMaxVal),
    unit: unitToken || unitSpec.key,
    canonicalUnit: unitSpec.canonicalUnit,
    unitKind: unitSpec.kind,
    canonicalQuantity,
    canonicalQuantityMin,
    canonicalQuantityMax,
    item,
    confidence,
    approx,
    implicitUnit,
  }
}

export const normalizeFoodLogText = (text = '') => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .filter((ln) => ln.length > 0)

  const items = []
  const unparsed = []

  lines.forEach((line) => {
    const parsed = parseFoodLogLine(line)
    if (parsed) {
      items.push(parsed)
    } else {
      unparsed.push(line)
    }
  })

  const totals = {
    weightLb: 0,
    volumeGallons: 0,
    containers: {},
    countEach: 0,
  }

  items.forEach((item) => {
    if (item.unitKind === 'weight') {
      totals.weightLb += item.canonicalQuantity
    } else if (item.unitKind === 'volume') {
      totals.volumeGallons += item.canonicalQuantity
    } else if (item.unitKind === 'container') {
      totals.containers[item.canonicalUnit] = (totals.containers[item.canonicalUnit] || 0) + item.canonicalQuantity
    } else if (item.unitKind === 'count') {
      totals.countEach += item.canonicalQuantity
    }
  })

  return { items, totals, unparsed }
}
