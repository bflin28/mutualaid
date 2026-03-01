-- CFSC Mutual Aid App - Clean Schema
-- Run this in the Supabase SQL editor to set up the database from scratch.

-- ============================================================
-- Drop existing tables (if any)
-- ============================================================
DROP TABLE IF EXISTS signups CASCADE;
DROP TABLE IF EXISTS pickup_events CASCADE;
DROP TABLE IF EXISTS food_logs CASCADE;
DROP TABLE IF EXISTS food_categories CASCADE;
DROP TABLE IF EXISTS locations CASCADE;
-- Drop legacy tables
DROP TABLE IF EXISTS rescue_logs CASCADE;
DROP TABLE IF EXISTS warehouse_logs CASCADE;
DROP TABLE IF EXISTS warehouse_log_items CASCADE;
DROP TABLE IF EXISTS slack_messages_audited CASCADE;
DROP TABLE IF EXISTS pickup_signups CASCADE;
DROP TABLE IF EXISTS pickup_accounts CASCADE;
DROP TABLE IF EXISTS weight_config CASCADE;

-- ============================================================
-- locations
-- ============================================================
CREATE TABLE locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'rescue' CHECK (type IN ('rescue', 'drop_off', 'both')),
  address TEXT,
  neighborhood TEXT,
  schedule_notes TEXT,
  aliases TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- food_categories (CFSC weight table, based on GCFD standards)
-- ============================================================
CREATE TABLE food_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gcfd_category TEXT NOT NULL UNIQUE,
  aldi_term TEXT,
  avg_lbs INTEGER NOT NULL,
  examples TEXT,
  keywords TEXT[] DEFAULT '{}',
  sort_order INTEGER DEFAULT 0
);

-- ============================================================
-- food_logs (unified rescue + warehouse logs)
-- ============================================================
CREATE TABLE food_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rescue_location_id UUID REFERENCES locations(id),
  rescue_location_name TEXT NOT NULL,
  drop_off_location_name TEXT,
  rescued_at TIMESTAMPTZ NOT NULL,
  rescued_by TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  total_estimated_lbs NUMERIC(10,1),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'slack', 'import')),
  slack_ts TEXT,
  slack_channel TEXT,
  raw_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_food_logs_rescued_at ON food_logs(rescued_at DESC);
CREATE INDEX idx_food_logs_location ON food_logs(rescue_location_name);
CREATE INDEX idx_food_logs_source ON food_logs(source);
CREATE UNIQUE INDEX idx_food_logs_slack_ts ON food_logs(slack_ts) WHERE slack_ts IS NOT NULL;

-- ============================================================
-- pickup_events
-- ============================================================
CREATE TABLE pickup_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES locations(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME,
  occurrence_date DATE,
  capacity INTEGER DEFAULT 1,
  notes TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- signups
-- ============================================================
CREATE TABLE signups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES pickup_events(id),
  occurrence_date DATE NOT NULL,
  volunteer_name TEXT NOT NULL,
  volunteer_email TEXT NOT NULL,
  volunteer_phone TEXT,
  notes TEXT,
  status TEXT DEFAULT 'confirmed',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_signups_event ON signups(event_id, occurrence_date);

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_locations_updated_at
  BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_food_logs_updated_at
  BEFORE UPDATE ON food_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS Policies (open read, backend writes via service role)
-- ============================================================
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON locations FOR SELECT USING (true);
CREATE POLICY "Public read" ON food_categories FOR SELECT USING (true);
CREATE POLICY "Public read" ON food_logs FOR SELECT USING (true);
CREATE POLICY "Public read" ON pickup_events FOR SELECT USING (true);
CREATE POLICY "Public read" ON signups FOR SELECT USING (true);

-- Service role bypasses RLS, so no write policies needed for backend
