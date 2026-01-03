/* eslint-env node */
import dotenv from 'dotenv'

// Load local overrides first, then fall back to .env
dotenv.config({ path: '.env.local' })
dotenv.config()
