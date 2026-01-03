-- Supabase table for storing audited Slack messages and recurring events
-- Replaces the JSONL file storage for production deployment

CREATE TABLE IF NOT EXISTS slack_messages_audited (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for filtering recurring events
CREATE INDEX IF NOT EXISTS idx_slack_audited_recurring
  ON slack_messages_audited ((data->>'recurring'));

-- Index for filtering by location (for recurring events)
CREATE INDEX IF NOT EXISTS idx_slack_audited_location
  ON slack_messages_audited ((data->>'rescue_location_canonical'));

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_slack_audited_start_ts
  ON slack_messages_audited ((data->>'start_ts'));

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_slack_messages_audited_updated_at
  BEFORE UPDATE ON slack_messages_audited
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE slack_messages_audited ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for service role
CREATE POLICY "Allow all operations for service role"
  ON slack_messages_audited
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Allow read access for authenticated users
CREATE POLICY "Allow read for authenticated users"
  ON slack_messages_audited
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow insert/update/delete for authenticated users
CREATE POLICY "Allow write for authenticated users"
  ON slack_messages_audited
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Comment for documentation
COMMENT ON TABLE slack_messages_audited IS 'Stores human-reviewed and corrected Slack message extractions, including recurring food rescue events';
COMMENT ON COLUMN slack_messages_audited.id IS 'Unique message ID or recurring event ID';
COMMENT ON COLUMN slack_messages_audited.data IS 'Full message/event data as JSON (items, sections, locations, timestamps, etc.)';
