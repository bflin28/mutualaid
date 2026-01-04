-- Migration: Add items JSONB column to warehouse_logs
-- This consolidates warehouse_log_items into the parent table

-- 1. Add items column to warehouse_logs
ALTER TABLE warehouse_logs
ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;

-- 2. Add rescued_at column for the rescue date (separate from created_at)
ALTER TABLE warehouse_logs
ADD COLUMN IF NOT EXISTS rescued_at TIMESTAMPTZ;

-- 3. Migrate existing items from warehouse_log_items into the items JSONB column
UPDATE warehouse_logs wl
SET items = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', wli.item_name,
        'quantity', wli.quantity,
        'unit', wli.unit,
        'estimated_lbs', wli.pounds,
        'notes', wli.notes,
        'sources', wli.sources
      )
    )
    FROM warehouse_log_items wli
    WHERE wli.log_id = wl.id
  ),
  '[]'::jsonb
);

-- 4. Add index for querying by location
CREATE INDEX IF NOT EXISTS idx_warehouse_logs_location
ON warehouse_logs (location);

-- 5. Add index for querying by rescued_at date
CREATE INDEX IF NOT EXISTS idx_warehouse_logs_rescued_at
ON warehouse_logs (rescued_at);

-- Optional: After verifying migration, you can drop the old table:
-- DROP TABLE IF EXISTS warehouse_log_items;

-- View to check migration results:
-- SELECT id, location, rescued_at, jsonb_array_length(items) as item_count FROM warehouse_logs;
