# Slack App Setup Guide

## 1. Create the Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name: `CFSC Food Rescue Bot` (or similar)
3. Select your workspace → **Create App**

## 2. Enable Socket Mode

1. Left sidebar → **Socket Mode**
2. Toggle **Enable Socket Mode** → ON
3. Create an **App-Level Token**:
   - Name: `socket-token`
   - Scope: `connections:write`
   - Click **Generate**
4. Copy the token (starts with `xapp-`) → this is your `SLACK_APP_TOKEN`

## 3. Configure Bot Scopes

1. Left sidebar → **OAuth & Permissions**
2. Under **Bot Token Scopes**, add:
   - `channels:history` — read messages in public channels
   - `channels:read` — list channels
   - `chat:write` — post summary replies
   - `groups:history` — read messages in private channels (if needed)
   - `groups:read` — list private channels (if needed)
3. Click **Install to Workspace** (or **Reinstall**)
4. Authorize → copy the **Bot User OAuth Token** (starts with `xoxb-`) → this is your `SLACK_BOT_TOKEN`

## 4. Subscribe to Events

1. Left sidebar → **Event Subscriptions** → toggle ON
2. (No Request URL needed — Socket Mode handles it)
3. Under **Subscribe to bot events**, add:
   - `message.channels` — messages in public channels
   - `message.groups` — messages in private channels (if needed)
4. **Save Changes**

## 5. Add the Bot to Channels

In Slack, go to each channel you want monitored and type:
```
/invite @CFSC Food Rescue Bot
```

To get channel IDs: right-click channel name → **Copy link** → the ID is the last path segment (e.g., `C0123ABCDEF`).

## 6. Set Environment Variables

Add to Railway (or `.env.local` for local dev):

```
SLACK_APP_TOKEN=xapp-1-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_WAREHOUSE_LOG_CHANNEL_IDS=C0123ABCDEF,C0456GHIJKL
```

- `SLACK_APP_TOKEN` — the app-level token from step 2
- `SLACK_BOT_TOKEN` — the bot OAuth token from step 3
- `SLACK_WAREHOUSE_LOG_CHANNEL_IDS` — comma-separated channel IDs where food rescue messages should be parsed into `food_logs`. Raw messages from ALL channels the bot is in are saved to `slack_messages`.
- `SLACK_POSTING_DISABLED=true` — (optional) suppress bot summary replies

## 7. Run the Database Migration

Run the SQL in `supabase/slack_messages_migration.sql` in the Supabase SQL Editor to create the `slack_messages` table.

## 8. Verify

1. Deploy / restart the server
2. Check logs for: `Slack Socket Mode connected.`
3. Post a test message in a monitored channel: `3 cases bread from Aldi WP`
4. Check:
   - `slack_messages` table has the raw message
   - `food_logs` table has a parsed entry with items
   - Bot replies in a thread with a summary
5. Test the API: `GET /api/slack-messages` and `GET /api/slack-messages/stats`
