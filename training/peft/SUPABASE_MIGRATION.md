# Supabase Migration Guide

This guide explains how to migrate your audited messages from JSONL file storage to Supabase database.

## Why Migrate to Supabase?

✅ **Persistent across deployments** - Data survives server restarts
✅ **Shared between users** - All users see the same data
✅ **Works with serverless** - Deploy backend anywhere
✅ **Production-ready** - Proper database with backups
✅ **Dev/Prod separation** - Use different databases or tables

## Prerequisites

- Supabase account (https://supabase.com)
- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in `.env.local`

## Migration Steps

### 1. Create Supabase Table

1. Go to your Supabase project dashboard
2. Click "SQL Editor" in the sidebar
3. Click "New Query"
4. Copy and paste the contents of `supabase_schema.sql`
5. Click "Run" or press Cmd+Enter

This creates:
- `slack_messages_audited` table
- Indexes for fast queries
- Row Level Security policies
- Auto-updating timestamps

### 2. Verify Table Creation

In the SQL Editor, run:
```sql
SELECT * FROM slack_messages_audited LIMIT 5;
```

Should return an empty result (no error).

### 3. Run Migration Script

From the `training/peft` directory:

```bash
python migrate_to_supabase.py
```

This will:
1. ✅ Create a timestamped backup of your JSONL file
2. ✅ Load all records from the JSONL
3. ✅ Upload them to Supabase
4. ✅ Verify the record count matches

### 4. Test the Backend

Restart your backend server:

```bash
# Kill the old server
pkill -f slack_api

# Start fresh
python3 training/peft/slack_api.py
```

You should see:
```
✓ Connected to Supabase (using database for audited messages)
```

### 5. Test the Frontend

1. Open your app at http://localhost:5174
2. Go to "Audited stats" tab
3. Click "Refresh"
4. Verify your audited messages appear
5. Try creating a recurring event
6. Refresh again - it should still be there!

### 6. Verify Persistence

**Test that data persists:**

1. Create a new recurring event or audit a message
2. Restart the backend server
3. Refresh the frontend
4. **The data should still be there!** ✓

**This confirms Supabase is working.**

## Rollback (if needed)

If something goes wrong, you can rollback:

1. Delete the Supabase table data:
   ```sql
   DELETE FROM slack_messages_audited;
   ```

2. Your original JSONL file is still intact
3. The backup file is in `data/slack_messages_audited.jsonl.backup-TIMESTAMP`

## Deployment

### For Production (Vercel + separate backend):

1. Deploy backend to Railway/Render/etc.
2. Set environment variables on the backend:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Set `VITE_SLACK_BROWSER_API` in Vercel to your backend URL
4. Deploy!

### For Shared Dev/Prod Database:

**Option A: Same database, different tables**

Production backend:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key
# Modify slack_api.py to use table name from env
```

Local dev:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key
# Use dev_slack_messages_audited table
```

**Option B: Separate databases**

Create a second Supabase project for development.

## Troubleshooting

### "Error loading from Supabase"

Check:
- Supabase credentials in `.env.local`
- Table exists: `SELECT * FROM slack_messages_audited;`
- Service role key (not anon key)

### "Falling back to JSONL file"

The app will automatically fallback to file storage if Supabase fails. Check:
- Network connection
- Supabase project status
- API key permissions

### Migration shows errors

- Check backup file: `data/slack_messages_audited.jsonl.backup-*`
- Verify original file is valid JSON: `cat data/slack_messages_audited.jsonl | jq`
- Run migration again (upsert will skip duplicates)

## FAQ

**Q: Will my local dev changes affect production?**
A: Not if you use separate databases or tables (see Deployment section)

**Q: What happens if Supabase is down?**
A: The app falls back to JSONL file storage automatically

**Q: Can I use both JSONL and Supabase?**
A: Yes - Supabase is tried first, JSONL is the fallback

**Q: How do I switch back to JSONL only?**
A: Remove `SUPABASE_URL` from your environment variables

## Next Steps

After successful migration:

1. ✅ Test all features (audit, edit, delete, recurring events)
2. ✅ Deploy to production
3. ✅ Keep JSONL backup file for safety
4. ✅ Set up regular Supabase backups (automatic in Supabase dashboard)
