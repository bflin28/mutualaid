# Warehouse log pipeline

This pipeline listens to Slack events, combines message text and attached images with an LLM, and writes a structured record to Supabase.

Notes:
- For reliability, checklist/bullet items like `• [ ] 3 boxes apples` are also parsed deterministically from the Slack message text (so we still capture every bullet even if the LLM misses some).
- `location` is inferred from headers like `Picked up from X:` / `Rescued from X:` / `Earlier today from X:` when present.

## Setup
- Slack:
  - Add the Events API URL to your app: `POST /api/slack/events`.
  - Subscribe to `message.channels`.
  - Note the channel id for `warehouse-log`, then set `SLACK_WAREHOUSE_LOG_CHANNEL_ID=<channel_id>` in your env.
- Env (all on the server process):
  - `SLACK_BOT_TOKEN` – bot token with `channels:history` to read image URLs and `chat:write` to post follow-ups.
  - `OPENAI_API_KEY` – for the LLM call. Optional overrides: `OPENAI_API_BASE`, `WAREHOUSE_LLM_MODEL` (default `gpt-4o-mini`), `WAREHOUSE_LLM_TIMEOUT_MS`, `WAREHOUSE_LLM_MAX_IMAGES` (default 3), `WAREHOUSE_LLM_MAX_IMAGE_BYTES` (default 2MB).
  - `WAREHOUSE_RESCUE_LOCATIONS` – optional comma-separated list of known pickup locations (e.g. `Irving Park, Fresh Market`). This is fed into the prompt and used to canonicalize `location`.
- `WAREHOUSE_LOG_TABLE` – Supabase table name (default `warehouse_logs`).
  - `SLACK_POSTING_DISABLED=true` to silence Slack follow-up messages if desired.

## Supabase table suggestions (two-table model)
```sql
create table if not exists warehouse_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  slack_ts text,
  slack_thread_ts text,
  slack_channel text,
  slack_channel_name text,
  slack_user text,
  raw_text text,
  location text,              -- rescued from
  drop_off_location text,     -- drop off location if present
  photo_urls text[],          -- public URLs in storage
  image_files jsonb,          -- Slack file metadata
  image_download_errors text[]
);

create table if not exists warehouse_log_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  log_id uuid references warehouse_logs(id) on delete cascade,
  item_name text,
  quantity numeric,
  unit text,
  notes text,
  sources text[],
  confidence numeric
);
```

Env mappings:
- Header table (server insert): `WAREHOUSE_LOG_TABLE` (default `warehouse_logs`)
- Item table (server insert): `WAREHOUSE_LOG_ITEMS_TABLE` (default `warehouse_log_items`)
- Image bucket: `WAREHOUSE_IMAGE_BUCKET` (default `warehouse-images`)

## Storage bucket
```sql
-- Create a public bucket for delivery photos
select storage.create_bucket('warehouse-images', public => true);
```
Make sure the service key is used on the server so uploads succeed, and that the bucket is public if you want the URLs to render directly in the UI.

Run the server with `npm run server` after setting the env vars. A message in `warehouse-log` will be parsed, sent to the LLM (plus up to three images), stored in Supabase, and echoed back to the Slack thread unless posting is disabled.
