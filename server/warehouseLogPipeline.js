/* eslint-env node */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { channelNameById } from './slackChannelRegistry.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { postSlackMessage } from './slackUtils.js'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN || process.env.OPENAI_KEY
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1'
const WAREHOUSE_LLM_MODEL = process.env.WAREHOUSE_LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
const WAREHOUSE_LOG_TABLE = process.env.WAREHOUSE_LOG_TABLE || 'warehouse_logs'
const WAREHOUSE_IMAGE_BUCKET = process.env.WAREHOUSE_IMAGE_BUCKET || 'warehouse-images'
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const MAX_IMAGES = Number(process.env.WAREHOUSE_LLM_MAX_IMAGES || 3)
const MAX_IMAGE_BYTES = Number(process.env.WAREHOUSE_LLM_MAX_IMAGE_BYTES || 5_000_000)
const LLM_TIMEOUT_MS = Number(process.env.WAREHOUSE_LLM_TIMEOUT_MS || 25000)
const EMPTY_IMAGES_RESULT = { imagesForModel: [], imagesMeta: [], errors: [], downloads: [] }
const MAX_INLINE_IMAGES = 3

const compact = (obj = {}) => Object.fromEntries(
  Object.entries(obj).filter(([, value]) => value !== undefined),
)

const parseCsvList = (value = '') => String(value || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)

const KNOWN_RESCUE_LOCATIONS = parseCsvList(
  process.env.WAREHOUSE_RESCUE_LOCATIONS
  || process.env.WAREHOUSE_RESCUE_LOCATIONS_CSV
  || '',
)

const resolveAliasFile = () => {
  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    return path.resolve(__dirname, '../training/peft/data/location_aliases.json')
  } catch (err) {
    return null
  }
}

const loadLocationAliases = () => {
  const aliasPath = resolveAliasFile()
  if (!aliasPath) return {}
  try {
    const raw = readFileSync(aliasPath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    return {}
  }
}

const LOCATION_ALIASES = loadLocationAliases()

const stableUuidFromString = (value) => {
  const hex = createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32)
  const part1 = hex.slice(0, 8)
  const part2 = hex.slice(8, 12)
  const part3 = `4${hex.slice(13, 16)}` // UUID v4-style version nibble
  const part4 = `8${hex.slice(17, 20)}` // RFC 4122 variant nibble
  const part5 = hex.slice(20, 32)
  return `${part1}-${part2}-${part3}-${part4}-${part5}`
}

const normalizeItemField = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ')
}

const canonicalItemKey = (item = {}) => {
  const name = normalizeItemField(item.name || item.item_name || '')
  const quantity = item.quantity ?? ''
  const unit = normalizeItemField(item.unit || item.container || '')
  const notes = normalizeItemField(item.notes || '')
  const pounds = normalizeItemField(item.pounds)
  return [name, quantity, unit, notes, pounds].join('|')
}

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export const coerceDateInputToIso = (value) => {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()

  const str = String(value || '').trim()
  if (!str) return null

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str)
  const date = new Date(dateOnly ? `${str}T12:00:00` : str)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export const buildItemNotes = (item = {}) => {
  const parts = []
  if (item.subcategory) parts.push(item.subcategory)
  const pounds = item.pounds ?? item.estimated_lbs
  if (pounds !== undefined && pounds !== null && pounds !== '') {
    const lbs = toNumberOrNull(pounds)
    parts.push(lbs ? `~${lbs} lbs` : `~${item.estimated_lbs} lbs`)
  }
  if (item.notes) parts.push(item.notes)
  return parts.length ? parts.join(' · ') : null
}

const normalizeLocationKey = (value) => normalizeItemField(value)
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const aliasLocationEntries = Object.entries(LOCATION_ALIASES || {}).flatMap(([canonical, aliases]) => {
  const canonKey = normalizeLocationKey(canonical)
  const list = Array.isArray(aliases) ? aliases : []
  const aliasKeys = list
    .map((alias) => [normalizeLocationKey(alias), canonical])
    .filter(([key]) => key)
  return [
    ...(canonKey ? [[canonKey, canonical]] : []),
    ...aliasKeys,
  ]
})

const aliasLocationMap = new Map(aliasLocationEntries)

const knownLocationMap = new Map(
  KNOWN_RESCUE_LOCATIONS
    .map((loc) => [normalizeLocationKey(loc), loc])
    .filter(([key]) => key)
    .concat([...aliasLocationMap.entries()]),
)

const titleCaseWords = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  return words.map((word) => {
    const clean = word.replace(/[^a-z0-9'-]/gi, '')
    if (!clean) return word
    if (clean.length <= 2) return clean.toUpperCase()
    return `${clean[0].toUpperCase()}${clean.slice(1).toLowerCase()}`
  }).join(' ')
}

const looksTitleCased = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return false
  return words.every((word) => {
    const clean = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
    if (!clean) return true
    if (/^\d/.test(clean)) return true
    if (/^[A-Z0-9]{2,}$/.test(clean)) return true
    return /^[A-Z]/.test(clean)
  })
}

const canonicalizeLocation = (value) => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  const cleaned = trimmed
    .replace(/^\s*from\s+/i, '')
    .split('\n')[0]
    .split('(')[0]
    .replace(/\s*[:;,-]+\s*$/, '')
    .replace(/\btook\b\s*$/i, '')
    .trim()
  const key = normalizeLocationKey(cleaned)
  if (!key) return ''
  const exact = knownLocationMap.get(key)
  if (exact) return exact
  for (const [aliasKey, canonical] of knownLocationMap.entries()) {
    if (aliasKey && key.includes(aliasKey)) return canonical
  }
  return ''
}

const extractRescueLocationFromText = (text = '') => {
  const input = String(text || '')
  if (!input.trim()) return ''

  const match = input.match(
    /(?:picked\s+up\s+from|rescued\s+from|rescue\s+from|pickup(?:ed)?\s+from|earlier\s+today\s+from|today\s+from)\s+(.+)/i,
  ) || input.match(/\bfrom\s+([^\n]+)/i)
  if (!match) return ''

  let remainder = String(match[1] || '').trim()
  remainder = remainder.split(/\r?\n/)[0] || ''

  const colonIdx = remainder.indexOf(':')
  if (colonIdx >= 0) remainder = remainder.slice(0, colonIdx)

  const dashMatch = remainder.match(/\s[-–—]\s/)
  if (dashMatch?.index !== undefined) remainder = remainder.slice(0, dashMatch.index)

  remainder = remainder.replace(/[;,.]+$/, '').trim()

  const canonical = canonicalizeLocation(remainder)
  if (canonical) return canonical

  return ''
}

const isNonFoodItemName = (name = '') => {
  const normalized = normalizeItemField(name)
  if (!normalized) return true
  return /^(picked\s+up\s+from|rescued\s+from|rescue\s+from|pickup(?:ed)?\s+from|dropped\s+off|drop\s+off|dropped\s+at|delivered\s+to|earlier\s+today\s+from)\b/i
    .test(normalized)
}

const normalizeItemNameForMatch = (value) => normalizeItemField(value)
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const itemMatchKey = (item = {}) => {
  const name = normalizeItemNameForMatch(item?.name || item?.item_name || '')
  const unit = normalizeItemField(item?.unit || item?.container || '')
  return `${name}|${unit}`
}

const unitTokens = new Set([
  'case',
  'cases',
  'box',
  'boxes',
  'bin',
  'bins',
  'tote',
  'totes',
  'crate',
  'crates',
  'flat',
  'flats',
  'bag',
  'bags',
  'shopping',
  'shopping bag',
  'shopping bags',
  'sack',
  'sacks',
  'package',
  'packages',
  'bottle',
  'bottles',
  'unit',
  'units',
  'lb',
  'lbs',
  'pound',
  'pounds',
  'gallon',
  'gallons',
  'dozen',
])

const unitAdjectives = new Set(['big', 'large', 'small'])
const dozenContainers = new Set(['package', 'packages', 'bottle', 'bottles'])

const stripUnitAdjectives = (value = '') => {
  const parts = String(value || '').split(/\s+/).filter(Boolean)
  const cleaned = parts.filter((part) => !unitAdjectives.has(part.toLowerCase()))
  return cleaned.join(' ').trim()
}

const normalizeUnitValue = (value = '') => {
  const lowered = stripUnitAdjectives(String(value || '').toLowerCase())
  if (!lowered) return ''
  const tokens = lowered.split(/\s+/).filter(Boolean)
  if (!tokens.length) return ''
  const last = tokens[tokens.length - 1]
  if (last === 'shopping' && tokens[tokens.length - 2]) {
    return `${tokens[tokens.length - 2]} ${last}`
  }
  return lowered
}

const categorizeItemName = (name = '') => {
  const value = String(name || '').toLowerCase()
  const drinks = ['water', 'juice', 'soda', 'coffee', 'tea', 'latte', 'drink', 'beverage', 'milk', 'kombucha', 'sparkling', 'sports drink', 'coconut water']
  const snacks = ['snack', 'chips', 'cracker', 'pretzel', 'cookie', 'popcorn', 'granola', 'trail mix', 'protein bar', 'granola bar', 'candy', 'nuts', 'almond', 'peanut', 'cashew', 'pistachio']
  const dryGoods = ['canned', 'dry goods', 'pantry', 'shelf stable', 'flour', 'sugar', 'salt', 'spice', 'seasoning', 'oil', 'vinegar', 'beans', 'lentil', 'lentils', 'chickpea', 'oat', 'oats', 'oatmeal', 'cereal', 'broth', 'stock', 'sauce', 'condiment']
  const produce = ['apple', 'orange', 'banana', 'berry', 'grape', 'melon', 'clementine', 'fruit', 'green', 'greens', 'lettuce', 'cabbage', 'potato', 'onion', 'pepper', 'tomato', 'carrot', 'spinach', 'produce', 'vegetable']
  const grain = ['bread', 'loaf', 'loaves', 'rice', 'pasta', 'grain', 'tortilla', 'dessert', 'cake', 'bun']
  const meat = ['chicken', 'beef', 'pork', 'turkey', 'meat', 'steak', 'sausage']
  const dairy = ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'half and half', 'cottage cheese', 'sour cream', 'kefir']

  const hasAny = (list) => list.some((token) => value.includes(token))
  if (hasAny(drinks)) return 'drinks'
  if (hasAny(snacks)) return 'snacks'
  if (hasAny(produce)) return 'produce'
  if (hasAny(grain)) return 'grain'
  if (hasAny(meat)) return 'meat'
  if (hasAny(dryGoods)) return 'dry goods'
  if (hasAny(dairy)) return 'dairy'
  return ''
}

const estimateItemWeight = ({ quantity, unit, name }) => {
  const qty = Number(quantity)
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1
  const unitNorm = normalizeUnitValue(unit).toLowerCase()
  const nameNorm = String(name || '').toLowerCase()

  const isPoundUnit = unitNorm.includes('lb') || unitNorm.includes('pound')
  if (isPoundUnit) {
    return Math.round(safeQty)
  }

  const perUnit = (() => {
    if (unitNorm.includes('bag')) return 8
    if (unitNorm.includes('bin') || unitNorm.includes('tote') || unitNorm.includes('crate')) return 25
    if (unitNorm.includes('box') || unitNorm.includes('case')) return 18
    if (unitNorm.includes('flat')) return 12
    if (unitNorm.includes('gallon')) return 8
    if (unitNorm.includes('lb') || unitNorm.includes('pound')) return 1
    if (unitNorm.includes('dozen')) return 6
    if (nameNorm.includes('bread') || nameNorm.includes('dessert')) return 2.5
    return 5
  })()

  const estimate = Math.round(perUnit * safeQty)
  return Number.isFinite(estimate) ? estimate : null
}

const extractSlackChecklistLines = (text = '') => {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  if (!normalized.includes('•') && !normalized.includes('[ ]') && !normalized.includes('[x]') && !normalized.includes('[X]')) {
    return []
  }

  const withNewlines = normalized.replace(/\s*•\s*/g, '\n• ')
  return withNewlines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('•') || line.startsWith('[ ]') || line.startsWith('[x]') || line.startsWith('[X]'))
}

const parseSlackChecklistItem = (line = '') => {
  let text = String(line || '').trim()
  if (!text) return null

  if (text.startsWith('•')) {
    text = text.replace(/^•\s*/, '')
  }
  text = text.replace(/^\[\s*[xX]?\s*\]\s*/, '').trim()
  if (!text) return null
  if (isNonFoodItemName(text)) return null

  let approximate = false
  if (/^[~≈]/.test(text)) {
    approximate = true
    text = text.replace(/^[~≈]\s*/, '').trim()
  }

  const qtyMatch = text.match(/^(\d+(?:\.\d+)?)\s+(.+)$/)
  if (!qtyMatch) {
    return { name: text, quantity: null, unit: null, notes: approximate ? 'approx' : null, sources: ['text'] }
  }

  const quantity = Number(qtyMatch[1])
  if (!Number.isFinite(quantity)) {
    return { name: text, quantity: null, unit: null, notes: approximate ? 'approx' : null, sources: ['text'] }
  }

  const remainder = String(qtyMatch[2] || '').trim()
  if (!remainder) return null

  const tokens = remainder.split(/\s+/).filter(Boolean)
  const first = (tokens[0] || '').toLowerCase()
  const second = (tokens[1] || '').toLowerCase()

  let unit = null
  let nameTokens = [...tokens]
  let notesParts = []

  if (first === 'dozen') {
    unit = 'dozen'
    nameTokens.shift()
    const container = (nameTokens[0] || '').toLowerCase()
    if (dozenContainers.has(container)) {
      notesParts.push(nameTokens.shift())
    }
    if ((nameTokens[0] || '').toLowerCase() === 'of') nameTokens.shift()
  } else if (unitAdjectives.has(first) && unitTokens.has(second)) {
    unit = `${tokens[0]} ${tokens[1]}`
    nameTokens = nameTokens.slice(2)
    if ((nameTokens[0] || '').toLowerCase() === 'of') nameTokens.shift()
  } else if (unitTokens.has(first)) {
    unit = tokens[0]
    nameTokens = nameTokens.slice(1)
    if ((nameTokens[0] || '').toLowerCase() === 'of') nameTokens.shift()
  }

  let name = nameTokens.join(' ').trim()
  if (!name) name = remainder

  const parenMatch = name.match(/\(([^)]{1,200})\)\s*$/)
  if (parenMatch) {
    notesParts.push(parenMatch[1].trim())
    name = name.slice(0, parenMatch.index).trim()
  }

  if (approximate) notesParts.push('approx')

  const notes = notesParts.length ? notesParts.join('; ') : null

  return {
    name,
    quantity,
    unit: unit || null,
    notes,
    sources: ['text'],
  }
}

export const previewWarehouseLogFromText = async ({ text, slackBotToken, images: _images = [] }) => {
  const draftId = stableUuidFromString(`${Date.now()}:${text || ''}`)
  // Inline uploads are ignored for preview so we do not send photos to the LLM.
  const parsed = await parseWarehouseLogContent({ text, files: [], inlineImages: [], slackBotToken })
  return {
    draftId,
    raw_text: parsed.text,
    location: parsed.location,
    drop_off_location: parsed.dropOff,
    summary: parsed.llmResult?.data?.summary || '',
    notes: parsed.llmResult?.data?.notes || '',
    items: (parsed.parsedItems || []).map((item) => ({
      ...item,
      subcategory: categorizeItemName(item.name || item.item_name || ''),
      estimated_lbs: estimateItemWeight(item),
      pounds: estimateItemWeight(item),
    })),
    llm_error: parsed.llmResult?.error || null,
    llm_model: parsed.llmResult?.model || null,
  }
}

export const saveWarehouseLogDraft = async ({
  supabase,
  draft,
  channelName = 'Manual entry',
  inlineImages = [],
}) => persistWarehouseLog({
  supabase,
  rawText: draft?.raw_text || draft?.text || '',
  location: canonicalizeLocation(draft?.location) || '',
  dropOff: canonicalizeLocation(draft?.drop_off_location || draft?.dropOffLocation) || '',
  rescuedAt: draft?.rescued_at || draft?.rescuedAt || draft?.created_at || null,
  parsedItems: Array.isArray(draft?.items)
    ? draft.items.map((item) => ({
      ...item,
      pounds: item.pounds ?? item.estimated_lbs,
    }))
    : [],
  images: inlineImages?.length ? inlineImagesToUploads(inlineImages) : EMPTY_IMAGES_RESULT,
  messageKey: draft?.draftId ? `manual:${draft.draftId}` : stableUuidFromString(`manual:${draft?.raw_text || draft?.text || Date.now()}`),
  slackMeta: {
    channel: 'manual',
    channel_name: channelName,
    user: draft?.submitted_by || '',
  },
  defaultChannelName: channelName,
  sentAt: new Date().toISOString(),
})

const parseItemsFromSlackChecklist = (text = '') => {
  const lines = extractSlackChecklistLines(text)
  const items = []
  for (const line of lines) {
    const parsed = parseSlackChecklistItem(line)
    if (parsed) items.push(parsed)
  }
  return items
}

const cleanParsedItems = (items = []) => {
  const normalizedUnits = (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    unit: normalizeUnitValue(item.unit || item.container || ''),
    container: normalizeUnitValue(item.container || item.unit || ''),
    quantity: toNumberOrNull(item.quantity),
    pounds: toNumberOrNull(item.pounds ?? item.estimated_lbs),
  }))

  const deduped = dedupeParsedItems(normalizedUnits)
  return deduped.filter((item) => {
    const name = item?.name || item?.item_name || ''
    return !isNonFoodItemName(name)
  })
}

const dedupeParsedItems = (items = []) => {
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const key = canonicalItemKey(item)
    if (!key || key === '|||') continue
    const existing = map.get(key)
    if (!existing) {
      map.set(key, item)
      continue
    }

    const mergedSources = new Set([...(existing.sources || []), ...(item.sources || [])].filter(Boolean))
    map.set(key, {
      ...existing,
      ...item,
      sources: mergedSources.size ? Array.from(mergedSources) : existing.sources || item.sources || null,
    })
  }

  return Array.from(map.values())
}

const fallbackParseItems = (text = '') => {
  if (!text.trim()) return []

  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const baseUnits = new Set([
    'case', 'cases', 'box', 'boxes', 'bin', 'bins', 'bag', 'bags', 'shopping bag', 'shopping bags', 'tote', 'totes', 'crate', 'crates', 'flat', 'flats',
    'package', 'packages', 'pallet', 'pallets', 'lb', 'lbs', 'pound', 'pounds', 'dozen', 'unit', 'units',
  ])

  const parseLine = (line = '') => {
    const tokens = line.split(/\s+/).filter(Boolean)
    if (!tokens.length) return null
    const qty = Number(tokens[0])
    if (!Number.isFinite(qty)) return null

    let unit = ''
    let unitIdx = -1

    for (let i = 1; i < tokens.length; i += 1) {
      const candidate = normalizeUnitValue(tokens.slice(1, i + 1).join(' '))
      const parts = candidate.split(' ')
      const last = parts[parts.length - 1]
      if (baseUnits.has(candidate)) {
        unit = candidate
        unitIdx = i
        break
      }
      if (baseUnits.has(last)) {
        unit = last
        unitIdx = i
        break
      }
    }

    if (!unit) return null

    const remainder = tokens.slice(unitIdx + 1)
    if (remainder[0]?.toLowerCase() === 'of') remainder.shift()
    const name = remainder.join(' ').trim()
    if (!name) return null

    return {
      quantity: qty,
      unit,
      name,
      sources: ['text'],
    }
  }

  const parsed = []
  for (const line of lines) {
    const withBullets = line.replace(/^[-•\[\] ]+/, '').trim()
    if (isNonFoodItemName(withBullets)) continue
    const parsedLine = parseLine(withBullets)
    if (parsedLine) {
      parsed.push(parsedLine)
    } else {
      parsed.push({ name: withBullets, sources: ['text'] })
    }
  }

  return parsed
}

const hasQuantity = (item) => {
  const num = toNumberOrNull(item?.quantity)
  return num !== null && num !== undefined
}

const hasUnit = (item) => Boolean(normalizeUnitValue(item?.unit || item?.container || ''))

const mergeItems = (existing = {}, incoming = {}) => ({
  ...existing,
  ...incoming,
  quantity: hasQuantity(incoming) ? incoming.quantity : existing.quantity,
  unit: hasUnit(incoming) ? incoming.unit : existing.unit,
  container: hasUnit(incoming) ? incoming.unit || incoming.container : existing.container,
  notes: existing.notes || incoming.notes || null,
})

const chooseBetterItem = (existing, incoming) => {
  if (!existing) return incoming
  const qtyBetter = hasQuantity(incoming) && !hasQuantity(existing)
  const unitBetter = hasUnit(incoming) && !hasUnit(existing)
  if (qtyBetter || unitBetter) {
    return mergeItems(existing, incoming)
  }
  return mergeItems(existing, incoming)
}

const combineParsedItems = ({ checklistItems = [], llmItems = [], fallbackItems = [] }) => {
  const sources = [checklistItems, llmItems, fallbackItems]
  const map = new Map()

  for (const list of sources) {
    for (const item of list) {
      const key = itemMatchKey(item)
      if (!key) continue
      const existing = map.get(key)
      const merged = chooseBetterItem(existing, item)
      map.set(key, merged)
    }
  }

  return Array.from(map.values())
}

const buildInlineImagesForModel = (inlineImages = []) => {
  const safeImages = Array.isArray(inlineImages) ? inlineImages.slice(0, MAX_INLINE_IMAGES) : []
  return safeImages
    .map((url) => (url ? {
      type: 'image_url',
      image_url: { url, detail: 'low' },
    } : null))
    .filter(Boolean)
}

const inlineImagesToUploads = (inlineImages = []) => {
  const safeImages = Array.isArray(inlineImages) ? inlineImages.slice(0, MAX_INLINE_IMAGES) : []
  const imagesMeta = []
  const downloads = []
  const errors = []

  safeImages.forEach((dataUrl, idx) => {
    if (typeof dataUrl !== 'string') {
      errors.push('Inline image missing data URL string')
      return
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) {
      errors.push('Inline image is not a base64 data URL')
      return
    }

    const mimeType = match[1] || ''
    const base64 = match[2] || ''
    if (!mimeType.startsWith('image/')) {
      errors.push('Inline image must be an image MIME type')
      return
    }

    let buffer
    try {
      buffer = Buffer.from(base64, 'base64')
    } catch (err) {
      errors.push(`Inline image decode failed: ${err.message}`)
      return
    }

    if (!buffer || !buffer.length) {
      errors.push('Inline image is empty')
      return
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      errors.push(`Inline image too large: ${buffer.length} bytes (limit ${MAX_IMAGE_BYTES})`)
      return
    }

    const ext = (mimeType.split('/')[1] || 'img').split('+')[0]
    const name = `inline-${idx + 1}.${ext}`

    imagesMeta.push(compact({
      id: name,
      name,
      mime_type: mimeType,
      size: buffer.length,
      source: 'inline',
    }))

    downloads.push({
      id: name,
      name,
      mimetype: mimeType,
      size: buffer.length,
      buffer,
    })
  })

  return {
    imagesForModel: [],
    imagesMeta,
    errors,
    downloads,
  }
}

const parseWarehouseLogContent = async ({ text, files = [], inlineImages = [], slackBotToken }) => {
  const normalizedText = String(text || '').trim()
  const hasSlackImages = Array.isArray(files) && files.length > 0
  const images = hasSlackImages
    ? await downloadSlackImages({ files, slackBotToken })
    : { ...EMPTY_IMAGES_RESULT }

  const inlineImagesForModel = buildInlineImagesForModel(inlineImages)
  const mergedImagesForModel = [...inlineImagesForModel, ...(images.imagesForModel || [])]

  const llmResult = await callWarehouseLlm({ text: normalizedText, imagesForModel: mergedImagesForModel })
  if (llmResult?.error) {
    console.error('Warehouse LLM error:', llmResult.error)
  }

  const llmItems = Array.isArray(llmResult?.data?.items) ? llmResult.data.items : []
  const checklistItems = parseItemsFromSlackChecklist(normalizedText)
  const fallbackItems = fallbackParseItems(normalizedText)
  const combinedItems = combineParsedItems({ checklistItems, llmItems, fallbackItems })
  const parsedItems = cleanParsedItems(combinedItems)

  const inferredLocation = extractRescueLocationFromText(normalizedText)
  const location = canonicalizeLocation(llmResult?.data?.location) || inferredLocation || ''
  const dropOff = canonicalizeLocation(llmResult?.data?.drop_off_location) || ''

  return {
    text: normalizedText,
    images,
    llmResult,
    checklistItems,
    fallbackItems,
    parsedItems,
    location,
    dropOff,
  }
}

const slackTimestampToIso = (ts) => {
  if (!ts) return null
  const num = Number(ts)
  if (!Number.isFinite(num)) return null
  const ms = Math.round(num * 1000)
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const withTimeout = async (promise, timeoutMs, onTimeoutMessage) => {
  if (!timeoutMs) return promise
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(onTimeoutMessage || 'Timed out')), timeoutMs)),
  ])
}

const downloadSlackImages = async ({ files = [], slackBotToken }) => {
  if (!slackBotToken) return { imagesForModel: [], imagesMeta: [], errors: ['Slack bot token missing for image download'] }

  const imageFiles = (files || []).filter((file) => (file?.mimetype || '').startsWith('image/'))
  const imagesForModel = []
  const imagesMeta = []
  const errors = []
  const downloads = []

  for (const file of imageFiles.slice(0, MAX_IMAGES)) {
    const downloadUrl = file.url_private_download || file.url_private
    if (!downloadUrl) {
      errors.push(`File ${file.id || file.name} missing download URL`)
      continue
    }

    try {
      const resp = await withTimeout(
        fetch(downloadUrl, {
          headers: { Authorization: `Bearer ${slackBotToken}` },
        }),
        LLM_TIMEOUT_MS,
        'Slack image download timed out',
      )

      if (!resp.ok) {
        errors.push(`Failed to download ${file.id || file.name}: ${resp.status}`)
        continue
      }

      const arrayBuffer = await resp.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      if (buffer.length > MAX_IMAGE_BYTES) {
        errors.push(`Skipped ${file.id || file.name}: ${buffer.length} bytes exceeds limit of ${MAX_IMAGE_BYTES}`)
        continue
      }

      const base64 = buffer.toString('base64')
      const dataUrl = `data:${file.mimetype};base64,${base64}`
      imagesForModel.push({
        type: 'image_url',
        image_url: { url: dataUrl, detail: 'low' },
      })

      imagesMeta.push(compact({
        id: file.id,
        name: file.name,
        mime_type: file.mimetype,
        size: file.size,
        permalink: file.permalink_public || file.permalink,
      }))

      downloads.push({
        id: file.id,
        name: file.name,
        mimetype: file.mimetype,
        size: buffer.length,
        buffer,
      })
    } catch (err) {
      errors.push(`Error downloading ${file.id || file.name}: ${err.message}`)
    }
  }

  return { imagesForModel, imagesMeta, errors, downloads }
}

const uploadImagesToBucket = async ({ supabase, images, event }) => {
  if (!supabase || !(images?.downloads?.length)) return { urls: [], errors: [] }
  const bucket = supabase.storage.from(WAREHOUSE_IMAGE_BUCKET)
  const uploaded = []
  const uploadErrors = []

  for (const file of images.downloads) {
    const path = `${event?.channel || 'channel'}/${event?.ts || Date.now()}/${file.name || file.id || 'image'}`.replace(/\\+/g, '/')
    const { data, error } = await bucket.upload(path, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false,
    })
    if (error) {
      uploadErrors.push(`Upload failed for ${file.name || file.id || 'image'}: ${error.message}`)
    } else if (data?.path) {
      const publicUrl = SUPABASE_URL
        ? `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${WAREHOUSE_IMAGE_BUCKET}/${data.path}`
        : data.path
      uploaded.push(publicUrl)
    }
  }

  return { urls: uploaded, errors: uploadErrors }
}

const llmSchema = {
  name: 'food_rescue_log',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      location: { type: ['string', 'null'], description: 'Where the pickup came from (store or pantry).' },
      drop_off_location: { type: ['string', 'null'], description: 'Where the food was dropped off, if mentioned.' },
      summary: { type: ['string', 'null'], description: 'One-line summary of the pickup contents.' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Name of the food item.' },
            quantity: { type: ['number', 'null'], description: 'Numeric quantity if present.' },
            unit: { type: ['string', 'null'], description: 'Unit such as case, box, bag, lb.' },
            container: { type: ['string', 'null'], description: 'Container descriptor if useful.' },
            notes: { type: ['string', 'null'], description: 'Short note for preparation or destination.' },
            confidence: { type: ['number', 'null'], description: '0-1 confidence for this item.' },
            sources: {
              type: 'array',
              items: { type: 'string', enum: ['text', 'image'] },
              description: 'Where the evidence came from.',
            },
          },
          required: ['name', 'quantity', 'unit', 'container', 'notes', 'confidence', 'sources'],
        },
      },
      notes: { type: ['string', 'null'], description: 'Anything else worth logging.' },
    },
    required: ['location', 'drop_off_location', 'summary', 'items', 'notes'],
  },
  strict: true,
}

const callWarehouseLlm = async ({ text, imagesForModel }) => {
  if (!OPENAI_API_KEY) {
    return { error: 'OPENAI_API_KEY missing', data: null }
  }

  const locationHint = KNOWN_RESCUE_LOCATIONS.length
    ? `Known rescue locations: ${KNOWN_RESCUE_LOCATIONS.join(', ')}. If one matches, prefer it.`
    : ''

  const messages = [
    {
      role: 'system',
      content: [
        'You are a food rescue logging assistant.',
        'Extract `location` (where the pickup came from), `drop_off_location` (if mentioned), and `items` with quantities/units when possible.',
        'If the message contains a checklist or bullet list, create ONE item per bullet (do not omit bullets).',
        'Items must be FOOD ITEMS ONLY. Do NOT include headings or metadata as items (e.g. "Picked up from X:", "Rescued from X:", "Dropped off at Y").',
        'If the message includes a header like "Picked up from X:" or "Rescued from X:", set `location` to X and do not include that header as an item.',
        'Use null when a quantity or unit is unknown.',
        locationHint,
      ].filter(Boolean).join(' '),
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Slack message:\n${text || '(no text)'}\n\nReturn only JSON in the provided schema.`,
        },
        ...imagesForModel,
      ],
    },
  ]

  try {
    const started = Date.now()
    const resp = await withTimeout(
      fetch(`${OPENAI_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: WAREHOUSE_LLM_MODEL,
          temperature: 0,
          response_format: { type: 'json_schema', json_schema: llmSchema },
          messages,
        }),
      }),
      LLM_TIMEOUT_MS,
      'LLM call timed out',
    )

    const latencyMs = Date.now() - started
    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '')
      return { error: `LLM error ${resp.status}: ${errorText}`, data: null, latencyMs }
    }

    const json = await resp.json()
    const rawContent = json.choices?.[0]?.message?.content
    let parsed = null
    try {
      parsed = rawContent ? JSON.parse(rawContent) : null
    } catch (err) {
      return { error: `Failed to parse LLM JSON: ${err.message}`, data: null, latencyMs }
    }

    return {
      data: parsed,
      raw: rawContent,
      model: json.model || WAREHOUSE_LLM_MODEL,
      usage: json.usage,
      latencyMs,
    }
  } catch (err) {
    return { error: err.message || 'LLM request failed', data: null }
  }
}

const persistWarehouseLog = async ({
  supabase,
  rawText,
  location,
  dropOff,
  rescuedAt = null,
  parsedItems = [],
  images = EMPTY_IMAGES_RESULT,
  slackMeta = {},
}) => {
  if (!supabase) {
    console.warn('Supabase client missing; skipping warehouse log insert')
    return { supabaseResult: null, headerRow: null, itemResult: null, uploadedImages: { urls: [], errors: [] } }
  }

  const uploadedImages = await uploadImagesToBucket({ supabase, images, event: slackMeta.event || slackMeta })
  const createdAt = coerceDateInputToIso(rescuedAt)
  // Clean and format items for embedded JSONB storage
  const cleanedItems = cleanParsedItems(parsedItems).filter((item) => (item?.name || item?.item_name || '').trim())
  const itemsJson = cleanedItems.map((item) => ({
    name: item.name || item.item_name || null,
    quantity: toNumberOrNull(item.quantity),
    unit: item.unit || item.container || null,
    estimated_lbs: toNumberOrNull(item.pounds ?? item.estimated_lbs),
    subcategory: item.subcategory || null,
    notes: item.notes || null,
    sources: item.sources || null,
  }))

  const payload = compact({
    created_at: createdAt || undefined,
    rescued_at: createdAt || undefined,
    location: location || null,
    drop_off_location: dropOff || null,
    raw_text: rawText,
    photo_urls: uploadedImages.urls?.length ? uploadedImages.urls : null,
    image_files: images?.imagesMeta,
    image_download_errors: [...(images?.errors || []), ...(uploadedImages.errors || [])].filter(Boolean),
    items: itemsJson,
  })

  let supabaseResult = null
  let headerRow = null

  const response = await supabase
    .from(WAREHOUSE_LOG_TABLE)
    .insert(payload)
    .select()
    .maybeSingle()
  supabaseResult = response
  headerRow = response.data || null

  if (response.error) {
    console.error('Supabase warehouse log insert error:', response.error)
  }

  return { payload, supabaseResult, headerRow, uploadedImages }
}

const formatSlackFollowup = ({ llmResult, location, items }) => {
  const lines = ['Logged warehouse pickup']
  if (location) lines.push(`Location: ${location}`)
  if (llmResult?.data?.drop_off_location) {
    lines.push(`Drop off: ${llmResult.data.drop_off_location}`)
  }

  const displayItems = cleanParsedItems(items?.length ? items : (llmResult?.data?.items || []))
  if (displayItems.length) {
    lines.push('LLM items:')
    displayItems.slice(0, 6).forEach((item) => {
      const qty = (item.quantity ?? '').toString()
      const unit = item.unit || item.container || ''
      const suffix = item.sources?.length ? ` [${item.sources.join(', ')}]` : ''
      lines.push(`• ${[qty, unit, item.name].filter(Boolean).join(' ')}${suffix}`)
    })
  }

  if (llmResult?.error) lines.push(`LLM error: ${llmResult.error}`)

  return lines.join('\n')
}

export const processWarehouseLogMessage = async ({
  event,
  supabase,
  slackBotToken,
  slackPostingDisabled,
}) => {
  const text = (event.text || event.message?.text || '').trim()
  const files = event.files || event.message?.files || []

  const parsed = await parseWarehouseLogContent({ text, files, slackBotToken })
  const persistence = await persistWarehouseLog({
    supabase,
    rawText: parsed.text,
    location: parsed.location,
    dropOff: parsed.dropOff,
    rescuedAt: slackTimestampToIso(event.ts),
    parsedItems: parsed.parsedItems,
    images: parsed.images,
    slackMeta: {
      ts: event.ts,
      thread_ts: event.thread_ts,
      channel: event.channel,
      channel_name: channelNameById(event.channel),
      user: event.user || event.username || '',
      event_ts: event.event_ts,
      message_ts: event.message?.ts,
      event,
    },
  })

  if (!slackPostingDisabled && slackBotToken) {
    const messageText = formatSlackFollowup({
      llmResult: parsed.llmResult,
      location: parsed.location,
      items: parsed.parsedItems,
    })

    await postSlackMessage({
      slackBotToken,
      channel: event.channel,
      text: messageText,
      threadTs: event.ts,
    })
  }

  return {
    ok: true,
    payload: persistence.payload || {
      location: parsed.location || null,
      drop_off_location: parsed.dropOff || null,
      raw_text: parsed.text,
    },
    supabaseResult: persistence.supabaseResult,
    headerRow: persistence.headerRow,
    itemResult: persistence.itemResult,
    llmResult: parsed.llmResult,
    images: parsed.images,
    uploadedImages: persistence.uploadedImages,
    parsedItems: parsed.parsedItems,
    location: parsed.location,
    dropOff: parsed.dropOff,
  }
}
