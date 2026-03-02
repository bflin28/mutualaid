-- Add record_type and classification columns to food_logs
-- record_type: 'rescue' (default) or 'inventory' (warehouse snapshot)
-- classification: the parser's classification string (for debugging)

ALTER TABLE food_logs
  ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT 'rescue'
    CHECK (record_type IN ('rescue', 'inventory'));

ALTER TABLE food_logs
  ADD COLUMN IF NOT EXISTS classification TEXT;

CREATE INDEX IF NOT EXISTS idx_food_logs_record_type ON food_logs(record_type);
