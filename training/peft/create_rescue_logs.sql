-- Create rescue_logs table for manual rescue log entries
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS rescue_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location TEXT NOT NULL,
  drop_off TEXT,
  rescued_at DATE NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  total_estimated_lbs NUMERIC(10,1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add drop_off column if table already exists
ALTER TABLE rescue_logs ADD COLUMN IF NOT EXISTS drop_off TEXT;

-- Add source column to track where the entry came from (manual, slack_import)
ALTER TABLE rescue_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Add rescued_by column to track who did the rescue
ALTER TABLE rescue_logs ADD COLUMN IF NOT EXISTS rescued_by TEXT;

-- Index for querying by location
CREATE INDEX IF NOT EXISTS idx_rescue_logs_location ON rescue_logs(location);

-- Index for querying by rescue date
CREATE INDEX IF NOT EXISTS idx_rescue_logs_rescued_at ON rescue_logs(rescued_at);

-- Example items JSONB structure:
-- [
--   {"name": "Apples", "quantity": 2, "unit": "cs", "subcategory": "fruit", "estimated_lbs": 40},
--   {"name": "Bread", "quantity": 10, "unit": "loaves", "subcategory": "bakery", "estimated_lbs": 15}
-- ]
