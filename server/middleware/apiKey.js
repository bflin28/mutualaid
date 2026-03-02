/**
 * Lightweight API key middleware for POST endpoints.
 * If API_KEY env var is not set, all requests pass through (dev mode).
 */
export function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY
  if (!expected) return next() // No key configured — allow all (dev mode)

  const provided = req.headers['x-api-key']
  if (provided === expected) return next()

  return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' })
}
