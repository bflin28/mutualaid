// Cache locations from DB
let locationsCache = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

export async function loadLocations(supabase) {
  const now = Date.now()
  if (locationsCache && now - cacheTime < CACHE_TTL) {
    return locationsCache
  }

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('active', true)
    .order('name')

  if (error) {
    console.error('Failed to load locations:', error.message)
    return locationsCache || []
  }

  locationsCache = data
  cacheTime = now
  return data
}

export function resolveLocation(input, locations) {
  if (!input || !locations) return null
  const normalized = input.toLowerCase().trim()

  // Exact name match first
  const exact = locations.find(l => l.name.toLowerCase() === normalized)
  if (exact) return exact

  // Alias match
  for (const loc of locations) {
    for (const alias of loc.aliases || []) {
      if (alias.toLowerCase() === normalized) {
        return loc
      }
    }
  }

  // Partial match on name
  const partial = locations.find(l => normalized.includes(l.name.toLowerCase()))
  if (partial) return partial

  // Partial match on aliases
  for (const loc of locations) {
    for (const alias of loc.aliases || []) {
      if (normalized.includes(alias.toLowerCase())) {
        return loc
      }
    }
  }

  return null
}

export function inferLocationFromText(text, locations) {
  if (!text) return null

  // Common patterns: "picked up from X", "rescued from X", "from X"
  const patterns = [
    /(?:picked up|rescued|grabbed|scooped|took)\s+(?:from|at)\s+(.+?)(?:\s+(?:this|today|yesterday|to\b|and\b|,|\.|$))/i,
    /(?:from|at)\s+(.+?)(?:\s+(?:this|today|yesterday|to\b|and\b|,|\.|$))/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const resolved = resolveLocation(match[1].trim(), locations)
      if (resolved) return resolved
    }
  }

  // Try matching any known location name in the text
  const lower = text.toLowerCase()
  for (const loc of locations) {
    if (lower.includes(loc.name.toLowerCase())) return loc
    for (const alias of loc.aliases || []) {
      if (lower.includes(alias.toLowerCase())) return loc
    }
  }

  return null
}
