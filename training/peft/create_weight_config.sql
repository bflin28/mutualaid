-- Create weight_config table to store unit weight configuration
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS weight_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default row if not exists (will be populated from weight_config.json on first load)
INSERT INTO weight_config (id, config)
VALUES ('default', '{}')
ON CONFLICT (id) DO NOTHING;
