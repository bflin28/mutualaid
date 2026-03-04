import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET

/**
 * Express middleware that verifies Supabase JWT from Authorization header.
 * If SUPABASE_JWT_SECRET is not set, all requests pass through (dev mode).
 */
export function requireAuth(req, res, next) {
  // Allow admin password as alternative auth (for admin page data fetches)
  const adminPw = process.env.ADMIN_PASSWORD
  const providedAdminPw = req.headers['x-admin-password']
  if (adminPw && providedAdminPw === adminPw) {
    return next()
  }

  if (!JWT_SECRET) {
    return next()
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = authHeader.slice(7)

  try {
    const decoded = jwt.verify(token, JWT_SECRET)

    if (decoded.role !== 'authenticated') {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    }

    return next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' })
    }
    return res.status(401).json({ error: 'Invalid token' })
  }
}
