import { Router } from 'express'

export default function allowedEmailRoutes(supabase) {
  const router = Router()

  // Verify admin password on all routes
  function requireAdmin(req, res, next) {
    const adminPw = process.env.ADMIN_PASSWORD
    if (!adminPw) {
      return res.status(503).json({ error: 'ADMIN_PASSWORD not configured on server' })
    }
    const provided = req.headers['x-admin-password']
    if (provided !== adminPw) {
      return res.status(401).json({ error: 'Invalid admin password' })
    }
    next()
  }

  // POST /api/allowed-emails/verify — verify admin password
  router.post('/verify', (req, res) => {
    const adminPw = process.env.ADMIN_PASSWORD
    if (!adminPw) {
      return res.status(503).json({ error: 'ADMIN_PASSWORD not configured on server' })
    }
    const { password } = req.body
    if (password === adminPw) {
      return res.json({ ok: true })
    }
    return res.status(401).json({ error: 'Invalid admin password' })
  })

  // GET /api/allowed-emails
  router.get('/', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
      .from('allowed_emails')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    res.json(data)
  })

  // POST /api/allowed-emails — invite user by email + whitelist
  router.post('/', requireAdmin, async (req, res) => {
    const { email } = req.body
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Send Supabase invite email (user sets their own password)
    const { data: authData, error: authError } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail)

    if (authError) {
      if (authError.message?.includes('already been registered')) {
        return res.status(409).json({ error: 'User with this email already exists' })
      }
      return res.status(500).json({ error: authError.message })
    }

    // Add to allowed_emails table
    const { data, error } = await supabase
      .from('allowed_emails')
      .insert({ email: normalizedEmail, added_by: 'admin' })
      .select()
      .single()

    if (error) {
      // If whitelist insert fails but invite was sent, that's ok
      if (error.code === '23505') {
        return res.status(201).json({ id: 'existing', email: normalizedEmail, created_at: new Date().toISOString() })
      }
      return res.status(500).json({ error: error.message })
    }

    res.status(201).json(data)
  })

  // POST /api/allowed-emails/resend — resend invite (password reset email)
  router.post('/resend', requireAdmin, async (req, res) => {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Email required' })

    const { error } = await supabase.auth.resetPasswordForEmail(
      email.toLowerCase().trim()
    )
    if (error) return res.status(500).json({ error: error.message })
    res.json({ ok: true })
  })

  // DELETE /api/allowed-emails/:id
  router.delete('/:id', requireAdmin, async (req, res) => {
    const { error } = await supabase
      .from('allowed_emails')
      .delete()
      .eq('id', req.params.id)

    if (error) return res.status(500).json({ error: error.message })
    res.json({ ok: true })
  })

  return router
}
