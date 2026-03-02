-- Migration: Create slack_messages table for raw Slack message storage
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS slack_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_ts TEXT NOT NULL,
  slack_channel TEXT NOT NULL,
  slack_user TEXT,
  subtype TEXT,
  thread_ts TEXT,
  raw_text TEXT,
  raw_json JSONB,
  is_food_log BOOLEAN DEFAULT false,
  food_log_id UUID REFERENCES food_logs(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Slack timestamps are unique per channel, not globally
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_messages_ts_channel
  ON slack_messages(slack_ts, slack_channel);

-- Query by channel + recency
CREATE INDEX IF NOT EXISTS idx_slack_messages_channel
  ON slack_messages(slack_channel, created_at DESC);

-- RLS: public read-only
ALTER TABLE slack_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'slack_messages' AND policyname = 'Public read'
  ) THEN
    CREATE POLICY "Public read" ON slack_messages FOR SELECT USING (true);
  END IF;
END $$;
