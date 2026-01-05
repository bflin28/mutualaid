-- Drop old warehouse tables after migration is complete
-- Run this in Supabase SQL Editor AFTER verifying rescue_logs is working

-- WARNING: This will permanently delete all data in these tables!
-- Make sure rescue_logs is working correctly before running this.

DROP TABLE IF EXISTS warehouse_log_items;
DROP TABLE IF EXISTS warehouse_logs;
