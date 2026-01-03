/* eslint-env node */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const defaultPromptTemplate = (text, photos = []) => {
  const photoLines = Array.isArray(photos) && photos.length
    ? ['Photos (public URLs):', ...photos, '']
    : []

  return [
    'You are a warehouse intake extractor. Return JSON only with keys:',
    '- location (string|null)',
    '- items (array of rows with item_name, quantity, unit, pounds, notes, sources, confidence)',
    '',
    'Message:',
    text.trim(),
    ...photoLines,
    'JSON:',
  ].join('\n')
}

const stringOrNull = (value) => {
  if (value === null || value === undefined) return null
  const str = String(value || '').trim()
  return str || null
}

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const sourcesOrNull = (value) => {
  if (!Array.isArray(value)) return null
  const cleaned = value.map((v) => String(v || '').trim()).filter(Boolean)
  return cleaned.length ? cleaned : null
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const opts = {
    limit: 1000,
    output: path.resolve(__dirname, 'data/warehouse_logs.jsonl'),
    since: null,
    includeEmpty: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--limit') opts.limit = Number(args[i + 1])
    if (arg === '--output') opts.output = path.resolve(process.cwd(), args[i + 1])
    if (arg === '--since') opts.since = args[i + 1]
    if (arg === '--include-empty') opts.includeEmpty = true
  }

  if (!Number.isFinite(opts.limit)) opts.limit = 1000

  if (opts.since) {
    const parsed = new Date(opts.since)
    opts.since = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }

  return opts
}

const loadEnv = () => {
  const envLocal = path.resolve(__dirname, '../../.env.local')
  dotenv.config({ path: envLocal })
  dotenv.config()
}

const fetchLogs = async ({ supabase, table, limit, since }) => {
  let query = supabase
    .from(table)
    .select('id, created_at, raw_text, location, photo_urls, image_files')
    .order('created_at', { ascending: true })

  if (Number.isFinite(limit)) {
    query = query.limit(limit)
  }
  if (since) {
    query = query.gte('created_at', since)
  }

  const { data, error } = await query
  if (error) throw new Error(`Supabase header query failed: ${error.message}`)
  return data || []
}

const fetchItems = async ({ supabase, table, logIds }) => {
  if (!logIds.length) return new Map()
  const { data, error } = await supabase
    .from(table)
    .select('log_id, item_name, quantity, unit, pounds, notes, sources, confidence')
    .in('log_id', logIds)
  if (error) throw new Error(`Supabase items query failed: ${error.message}`)

  const map = new Map()
  for (const item of data || []) {
    const items = map.get(item.log_id) || []
    items.push(item)
    map.set(item.log_id, items)
  }
  return map
}

const buildDatasetRow = ({ log, items }) => {
  const inputText = String(log.raw_text || '').trim()
  if (!inputText) return null

  const photoUrls = Array.isArray(log.photo_urls) ? log.photo_urls.filter(Boolean) : []
  const normalizedItems = (items || [])
    .map((item) => ({
      item_name: stringOrNull(item.item_name),
      quantity: numberOrNull(item.quantity),
      unit: stringOrNull(item.unit),
      pounds: numberOrNull(item.pounds),
      notes: stringOrNull(item.notes),
      sources: sourcesOrNull(item.sources),
      confidence: numberOrNull(item.confidence),
    }))
    .filter((item) => item.item_name)

  const target = {
    location: stringOrNull(log.location),
    items: normalizedItems,
  }

  return {
    id: log.id,
    created_at: log.created_at,
    input_text: inputText,
    prompt: defaultPromptTemplate(inputText, photoUrls),
    response: JSON.stringify(target),
    target,
    meta: {
      photo_urls: photoUrls,
      image_files: log.image_files || null,
    },
    photos: photoUrls,
  }
}

const main = async () => {
  loadEnv()
  const opts = parseArgs()

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your env or .env.local.')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const headerTable = process.env.WAREHOUSE_LOG_TABLE || 'warehouse_logs'
  const itemTable = process.env.WAREHOUSE_LOG_ITEMS_TABLE || 'warehouse_log_items'

  const logs = await fetchLogs({ supabase, table: headerTable, limit: opts.limit, since: opts.since })
  const itemsMap = await fetchItems({ supabase, table: itemTable, logIds: logs.map((l) => l.id).filter(Boolean) })

  const rows = logs
    .map((log) => buildDatasetRow({ log, items: itemsMap.get(log.id) }))
    .filter(Boolean)
    .filter((row) => opts.includeEmpty || (row.target.items || []).length > 0)

  await fs.mkdir(path.dirname(opts.output), { recursive: true })
  const payload = rows.map((row) => JSON.stringify(row)).join('\n')
  await fs.writeFile(opts.output, payload ? `${payload}\n` : '')

  const skipped = logs.length - rows.length
  console.log(`Exported ${rows.length} rows to ${opts.output}${skipped ? ` (${skipped} skipped)` : ''}`)
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
