#!/usr/bin/env python3
"""
Migrate audited messages from JSONL file to Supabase.

Usage:
  python migrate_to_supabase.py

This script:
1. Reads all records from slack_messages_audited.jsonl
2. Uploads them to Supabase table slack_messages_audited
3. Creates a backup of the JSONL file before migration
"""

import json
import os
import pathlib
import shutil
from datetime import datetime

from dotenv import load_dotenv
from supabase import create_client

# Load environment variables
env_local = pathlib.Path(__file__).resolve().parent.parent.parent / ".env.local"
if env_local.exists():
    load_dotenv(env_local)
else:
    load_dotenv()

BASE = pathlib.Path(__file__).resolve().parent
AUDIT_PATH = BASE / "data" / "slack_messages_audited.jsonl"

def main():
    print("=" * 60)
    print("Migrating audited messages from JSONL to Supabase")
    print("=" * 60)

    # Check Supabase configuration
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Error: Supabase not configured")
        print("   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")
        return 1

    # Check if JSONL file exists
    if not AUDIT_PATH.exists():
        print(f"❌ Error: File not found: {AUDIT_PATH}")
        return 1

    # Create backup
    backup_path = AUDIT_PATH.with_suffix(f".jsonl.backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
    print(f"\n1. Creating backup: {backup_path.name}")
    shutil.copy2(AUDIT_PATH, backup_path)
    print(f"   ✓ Backup created")

    # Load records from JSONL
    print(f"\n2. Loading records from {AUDIT_PATH.name}")
    records = []
    with AUDIT_PATH.open() as f:
        for line in f:
            try:
                records.append(json.loads(line))
            except Exception as e:
                print(f"   ⚠ Warning: Failed to parse line: {e}")
                continue
    print(f"   ✓ Loaded {len(records)} records")

    if not records:
        print("\n❌ No records to migrate")
        return 1

    # Connect to Supabase
    print(f"\n3. Connecting to Supabase...")
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print(f"   ✓ Connected to Supabase")
    except Exception as e:
        print(f"   ❌ Failed to connect: {e}")
        return 1

    # Upload records
    print(f"\n4. Uploading {len(records)} records to Supabase...")
    success_count = 0
    error_count = 0

    for i, rec in enumerate(records, 1):
        try:
            rec_id = str(rec.get("id"))
            supabase.table("slack_messages_audited").upsert({
                "id": rec_id,
                "data": rec
            }).execute()
            success_count += 1

            if i % 10 == 0 or i == len(records):
                print(f"   Progress: {i}/{len(records)} records uploaded")
        except Exception as e:
            error_count += 1
            print(f"   ⚠ Warning: Failed to upload record {rec.get('id')}: {e}")

    print(f"\n   ✓ Upload complete!")
    print(f"     Success: {success_count}")
    if error_count > 0:
        print(f"     Errors:  {error_count}")

    # Verify migration
    print(f"\n5. Verifying migration...")
    try:
        response = supabase.table("slack_messages_audited").select("id", count="exact").execute()
        db_count = response.count
        print(f"   ✓ Database contains {db_count} records")

        if db_count == len(records):
            print(f"   ✓ Record count matches!")
        else:
            print(f"   ⚠ Warning: Record count mismatch")
            print(f"     JSONL: {len(records)}")
            print(f"     Database: {db_count}")
    except Exception as e:
        print(f"   ⚠ Warning: Could not verify: {e}")

    print("\n" + "=" * 60)
    print("✓ Migration complete!")
    print("=" * 60)
    print(f"\nBackup saved to: {backup_path}")
    print(f"Original file preserved at: {AUDIT_PATH}")
    print(f"\nYou can now:")
    print(f"  1. Test the app with Supabase")
    print(f"  2. Keep the JSONL file as backup")
    print(f"  3. Delete the backup once verified: {backup_path}")

    return 0

if __name__ == "__main__":
    exit(main())
