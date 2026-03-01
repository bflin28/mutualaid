/**
 * Converts slack_history_parsed.jsonl → public/parsed_data.json
 * for the frontend stats page to load directly.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const lines = readFileSync('slack_history_parsed.jsonl', 'utf8').split('\n').filter(Boolean)
const records = lines.map(l => JSON.parse(l))

mkdirSync('public', { recursive: true })
writeFileSync('public/parsed_data.json', JSON.stringify(records))
console.log(`Exported ${records.length} records to public/parsed_data.json (${(JSON.stringify(records).length / 1024).toFixed(0)} KB)`)
