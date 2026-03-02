import '../server/loadEnv.js'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Supabase JS doesn't support raw SQL directly,
// so we use the REST API to run the migration via the pg_net extension
// Instead, let's just test if columns exist by trying to query them

async function run() {
  // Test if record_type column exists
  const { data, error } = await supabase
    .from('food_logs')
    .select('record_type, classification')
    .limit(1)

  if (error && error.message.includes('record_type')) {
    console.log('Columns do not exist yet. Please run the following SQL in the Supabase SQL Editor:')
    console.log('')
    console.log("ALTER TABLE food_logs ADD COLUMN record_type TEXT NOT NULL DEFAULT 'rescue';")
    console.log('ALTER TABLE food_logs ADD COLUMN classification TEXT;')
    console.log('CREATE INDEX idx_food_logs_record_type ON food_logs(record_type);')
    process.exit(1)
  } else if (error) {
    console.log('Columns do not exist yet. Please run the following SQL in the Supabase SQL Editor:')
    console.log('')
    console.log("ALTER TABLE food_logs ADD COLUMN record_type TEXT NOT NULL DEFAULT 'rescue';")
    console.log('ALTER TABLE food_logs ADD COLUMN classification TEXT;')
    console.log('CREATE INDEX idx_food_logs_record_type ON food_logs(record_type);')
    process.exit(1)
  } else {
    console.log('Columns already exist! record_type and classification are ready.')
    console.log('Sample:', JSON.stringify(data[0]))
  }
}

run()
