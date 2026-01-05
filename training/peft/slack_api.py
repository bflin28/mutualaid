"""
Lightweight FastAPI backend to browse regex-parsed Slack warehouse messages.

Run locally:
  pip install fastapi uvicorn
  uvicorn training.peft.slack_api:app --reload --port 5055

Requires the XLSX at training/peft/data/slack_messages_C026VATTHDE.xlsx.
If the parsed JSONL is missing, it will call extract_slack_regex.py to generate it.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
from typing import List, Dict, Any

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env.local or .env
env_local = pathlib.Path(__file__).resolve().parent.parent.parent / ".env.local"
if env_local.exists():
    load_dotenv(env_local)
else:
    load_dotenv()

BASE = pathlib.Path(__file__).resolve().parent
DATA_PATH = BASE / "data" / "slack_messages_parsed.jsonl"
ALIASES_PATH = BASE / "data" / "location_aliases.json"
EXTRACT_SCRIPT = BASE / "extract_slack_regex.py"

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_KEY)

# Initialize Supabase client (required)
supabase: Client | None = None
if USE_SUPABASE:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print(f"✓ Connected to Supabase")
    except Exception as e:
        print(f"✗ Failed to connect to Supabase: {e}")
        raise RuntimeError(f"Supabase connection failed: {e}")
else:
    print(f"✗ Supabase not configured!")
    print(f"  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables")


def ensure_parsed_file() -> pathlib.Path:
  if DATA_PATH.exists():
    return DATA_PATH
  if not EXTRACT_SCRIPT.exists():
    raise FileNotFoundError(f"Missing extractor script at {EXTRACT_SCRIPT}")
  subprocess.run([sys.executable, str(EXTRACT_SCRIPT)], check=True, cwd=EXTRACT_SCRIPT.parent)
  if not DATA_PATH.exists():
    raise FileNotFoundError(f"Extractor ran but {DATA_PATH} is still missing.")
  return DATA_PATH


def _normalize_loc(value: str) -> str:
  import re
  clean = re.sub(r"[^a-z0-9 ]+", " ", str(value or "").lower()).strip()
  clean = re.sub(r"\s+", " ", clean)
  return clean


DEFAULT_LOCATION_ALIASES = {
  "aldi wp": "Aldi Wicker Park",
  "aldi wicker park": "Aldi Wicker Park",
  "wicker park aldi": "Aldi Wicker Park",
  "aldi n milwaukee": "Aldi Wicker Park",
  "aldi n milwaukee ave": "Aldi Wicker Park",
  "aldis wp": "Aldi Wicker Park",
  "aldis wicker park": "Aldi Wicker Park",
  "aldi hodgkins": "Aldi Hodgkins",
  "aldi lyons": "Aldi Lyons",
  "aldi cicero": "Aldi Cicero",
  "aldi englewood": "Aldi Englewood",
  "uc": "UC",
  "love fridge": "Love Fridge",
  "love fridges": "Love Fridge",
  "na4j": "NA4J",
  "lsrsn": "LSRSN",
  "ls rsn": "LSRSN",
  "marianos": "Mariano's",
  "mariano's": "Mariano's",
  "sl mariano's": "Mariano's South Loop",
  "marianos sl": "Mariano's South Loop",
  "mariano's sl": "Mariano's South Loop",
  "marianos south loop": "Mariano's South Loop",
  "south loop marianos": "Mariano's South Loop",
  "south loop mariano's": "Mariano's South Loop",
}


def load_alias_map() -> Dict[str, str]:
  try:
    with ALIASES_PATH.open() as f:
      data = json.load(f)
  except FileNotFoundError:
    return dict(DEFAULT_LOCATION_ALIASES)
  except Exception as exc:
    print(f"Warning: failed to load location aliases file: {exc}")
    return dict(DEFAULT_LOCATION_ALIASES)

  aliases: Dict[str, str] = {}
  for canonical, values in data.items():
    canon = str(canonical or "").strip()
    if not canon:
      continue
    for alias in [canon, *(values or [])]:
      key = _normalize_loc(alias)
      if key:
        aliases[key] = canon
  return aliases


LOCATION_ALIASES = load_alias_map()


def canonical_loc(value: str) -> str:
  if not value:
    return ""
  import re

  cleaned = str(value or "").strip()

  # Strip common lead-ins like "SWC picked up this morning at X"
  lead_patterns = [
    r"^[A-Za-z0-9 /&'’.-]+\s+picked\s+up\s+(?:this\s+morning|earlier\s+today|today)?\s+at\s+(.+)$",
    r"^[A-Za-z0-9 /&'’.-]+\s+picked\s+up\s+at\s+(.+)$",
    r"^[A-Za-z0-9 /&'’.-]+\s+picked\s+up\s+from\s+(.+)$",
    r"^[A-Za-z0-9 /&'’.-]+\s+took\s+(?:directly\s+)?from\s+(.+)$",
  ]
  for pat in lead_patterns:
    m = re.match(pat, cleaned, flags=re.IGNORECASE)
    if m:
      cleaned = m.group(1).strip(" :-")
      break

  # If a trailing "at <location>" remains and it contains Mariano's, keep just the location.
  lower_clean = cleaned.lower()
  if " mariano" in lower_clean and " at " in lower_clean:
    before, after = cleaned.rsplit(" at ", 1)
    if after.strip():
      cleaned = after.strip(" :-")

  cleaned = re.sub(r"^\s*from\s+", "", cleaned, flags=re.IGNORECASE)
  cleaned = cleaned.split("\n")[0]
  cleaned = cleaned.split("(")[0]
  cleaned = re.sub(r"\s*[:;,-]+\s*$", "", cleaned)
  cleaned = re.sub(r"\btook\b\s*$", "", cleaned, flags=re.IGNORECASE).strip()

  key = _normalize_loc(cleaned)
  if key in LOCATION_ALIASES:
    return LOCATION_ALIASES[key]
  for alias_key, canonical in LOCATION_ALIASES.items():
    if alias_key and key and alias_key in key:
      return canonical
  return ""


def load_records() -> List[Dict[str, Any]]:
  path = ensure_parsed_file()
  records = []
  with path.open() as f:
    for line in f:
      rec = json.loads(line)
      items = rec.get("items") or []

      def normalize_lb_items(obj_items: List[Dict[str, Any]]) -> None:
        for itm in obj_items or []:
          unit = (itm.get("unit") or "").lower()
          if unit in {"lb", "lbs", "pound", "pounds"}:
            try:
              qty_val = float(itm.get("quantity") or 0)
            except (TypeError, ValueError):
              qty_val = 0.0
            if qty_val > 0:
              itm["estimated_lbs"] = round(qty_val, 2)

      normalize_lb_items(items)
      total_estimated_lbs = 0.0
      for item in items:
        lbs = item.get("estimated_lbs")
        try:
          val = float(lbs)
        except (TypeError, ValueError):
          val = 0.0
        total_estimated_lbs += val
      rec["total_estimated_lbs"] = round(total_estimated_lbs, 2)
      rec["rescue_location_canonical"] = canonical_loc(rec.get("rescue_location"))
      rec["drop_off_location_canonical"] = canonical_loc(rec.get("drop_off_location"))
      if isinstance(rec.get("sections"), list):
        for sec in rec["sections"]:
          if isinstance(sec, dict):
            sec["location_canonical"] = canonical_loc(sec.get("location"))
            normalize_lb_items(sec.get("items") or [])
      records.append(rec)
  return records


def load_audited() -> List[Dict[str, Any]]:
  """Load audited records from both slack_messages_audited and rescue_logs tables."""
  if not USE_SUPABASE or not supabase:
    raise RuntimeError("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")

  records = []

  # Load from slack_messages_audited (audited Slack messages)
  try:
    response = supabase.table("slack_messages_audited").select("*").execute()
    for row in response.data:
      records.append(row["data"])
  except Exception as e:
    print(f"Warning: Could not load from slack_messages_audited: {e}")

  # Load from rescue_logs (manual rescue log entries)
  try:
    response = supabase.table("rescue_logs").select("*").execute()
    for row in response.data:
      # Normalize rescue_logs format to match slack_messages_audited format for stats
      items = row.get("items") or []
      normalized = {
        "id": f"rescue-{row['id']}",
        "source": "rescue_logs",
        "rescue_location_canonical": row.get("location") or "",
        "drop_off_location_canonical": "",
        "start_ts": row.get("rescued_at") or row.get("created_at"),
        "raw_messages": [],
        "sections": [{
          "location_canonical": row.get("location") or "",
          "items": items,
        }] if items else [],
        "total_estimated_lbs": float(row.get("total_estimated_lbs") or 0),
        "photo_urls": row.get("photo_urls") or [],
        "audited": True,
        "recurring": False,
      }
      records.append(normalized)
  except Exception as e:
    print(f"Warning: Could not load from rescue_logs: {e}")

  return records


def save_audited_record(rec: Dict[str, Any]) -> None:
  """Save audited record to Supabase."""
  if not USE_SUPABASE or not supabase:
    raise RuntimeError("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")

  rec = {**rec, "audited": True}

  # Add estimated weights to items in sections
  if rec.get('sections'):
    for section in rec['sections']:
      if section.get('items'):
        section['items'] = add_estimated_weights(section['items'])

  # Recalculate total_estimated_lbs
  total_lbs = 0
  if rec.get('sections'):
    for section in rec['sections']:
      for item in section.get('items', []):
        if item.get('estimated_lbs'):
          total_lbs += float(item['estimated_lbs'])

  rec['total_estimated_lbs'] = round(total_lbs, 1) if total_lbs > 0 else None

  rec_id = str(rec.get("id"))

  supabase.table("slack_messages_audited").upsert({
    "id": rec_id,
    "data": rec
  }).execute()


def delete_audited_record(rec_id: Any) -> None:
  """Delete audited record from Supabase."""
  if not USE_SUPABASE or not supabase:
    raise RuntimeError("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")

  rec_id_str = str(rec_id)
  supabase.table("slack_messages_audited").delete().eq("id", rec_id_str).execute()


app = FastAPI(title="Slack Regex Browser")
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

# Load parsed records lazily - don't fail if data file is missing (e.g., in production)
try:
    RECORDS: List[Dict[str, Any]] = load_records()
except Exception as e:
    print(f"⚠ Warning: Could not load parsed messages: {e}")
    print(f"  Continuing with empty records (audited messages still work via Supabase)")
    RECORDS: List[Dict[str, Any]] = []


@app.get("/messages")
def list_messages(
  start: int = Query(0, ge=0),
  limit: int = Query(1, ge=1, le=5000),
  start_date: str | None = Query(None, description="ISO date YYYY-MM-DD, inclusive"),
  end_date: str | None = Query(None, description="ISO date YYYY-MM-DD, inclusive"),
  audited: bool = Query(False, description="If true, return audited records instead of parsed"),
  hide_audited: bool = Query(False, description="If true, exclude audited records from the parsed feed"),
  include_recurring: bool = Query(False, description="If true, include recurring event templates"),
):
  audited_records = load_audited()

  # Filter out recurring events unless explicitly requested
  if not include_recurring:
    audited_records = [r for r in audited_records if not r.get("recurring")]

  audited_id_set = {rec.get("id") for rec in audited_records if rec.get("id") is not None}
  data_source = audited_records if audited else RECORDS
  filtered = data_source

  if start_date or end_date:
    from datetime import datetime

    def in_range(rec):
      ts = rec.get("start_ts") or rec.get("end_ts")
      if not ts:
        return False
      try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
      except Exception:
        return False
      if start_date:
        try:
          if dt.date() < datetime.fromisoformat(start_date).date():
            return False
        except Exception:
          pass
      if end_date:
        try:
          if dt.date() > datetime.fromisoformat(end_date).date():
            return False
        except Exception:
          pass
      return True

    filtered = [rec for rec in filtered if in_range(rec)]

  if hide_audited and not audited:
    filtered = [rec for rec in filtered if rec.get("id") not in audited_id_set]

  enriched = []
  for rec in filtered:
    annotated = dict(rec)
    annotated["audited"] = rec.get("id") in audited_id_set
    enriched.append(annotated)

  total = len(enriched)
  end = min(start + limit, total)
  return {"total": total, "records": enriched[start:end], "start": start, "limit": limit, "audited": audited}


@app.get("/search")
def search_messages(
  query: str = Query(..., min_length=1, description="Search query string"),
  limit: int = Query(50, ge=1, le=500, description="Max results to return"),
):
  """Search across all Slack messages by keyword, ignoring audit filters."""
  audited_records = load_audited()
  audited_id_set = {rec.get("id") for rec in audited_records if rec.get("id") is not None}

  query_lower = query.lower()
  query_terms = query_lower.split()

  results = []

  for idx, rec in enumerate(RECORDS):
    matched_in = []
    match_texts = []

    # Search raw messages
    raw_text = ' '.join(rec.get('raw_messages', [])).lower()
    if raw_text and all(term in raw_text for term in query_terms):
      matched_in.append('raw_messages')
      match_texts.append(raw_text)

    # Search rescue location
    rescue = (rec.get('rescue_location_canonical') or rec.get('rescue_location') or '').lower()
    if rescue and all(term in rescue for term in query_terms):
      matched_in.append('rescue_location')
      match_texts.append(rescue)

    # Search drop-off location
    dropoff = (rec.get('drop_off_location_canonical') or rec.get('drop_off_location') or '').lower()
    if dropoff and all(term in dropoff for term in query_terms):
      matched_in.append('drop_off_location')
      match_texts.append(dropoff)

    # Search top-level items
    for item in rec.get('items', []):
      item_name = (item.get('name') or '').lower()
      if item_name and all(term in item_name for term in query_terms):
        if 'items' not in matched_in:
          matched_in.append('items')
          match_texts.append(item_name)
        break

    # Search sections
    for section in rec.get('sections', []):
      # Search section location
      sec_loc = (section.get('location_canonical') or section.get('location') or '').lower()
      if sec_loc and all(term in sec_loc for term in query_terms):
        if 'section_location' not in matched_in:
          matched_in.append('section_location')
          match_texts.append(sec_loc)

      # Search section items
      for item in section.get('items', []):
        item_name = (item.get('name') or '').lower()
        if item_name and all(term in item_name for term in query_terms):
          if 'section_items' not in matched_in:
            matched_in.append('section_items')
            match_texts.append(item_name)
          break

    # If we found matches, add to results
    if matched_in:
      # Create match preview (first 150 chars of first match)
      preview = match_texts[0][:150]
      if len(match_texts[0]) > 150:
        preview += '...'

      results.append({
        'id': rec.get('id'),
        'index': idx,
        'matched_in': list(set(matched_in)),
        'match_preview': preview,
        'start_ts': rec.get('start_ts'),
        'direction': rec.get('direction'),
        'audited': rec.get('id') in audited_id_set,
        'record': rec
      })

  # Sort by start_ts descending (newest first)
  results.sort(key=lambda x: x.get('start_ts') or '', reverse=True)

  # Limit results
  results = results[:limit]

  return {
    'query': query,
    'total': len(results),
    'results': results
  }


@app.get("/messages/{message_id}")
def get_message_by_id(
  message_id: int,
  start_date: str | None = Query(None, description="ISO date YYYY-MM-DD, inclusive"),
  end_date: str | None = Query(None, description="ISO date YYYY-MM-DD, inclusive"),
  audited: bool = Query(False, description="If true, return audited records instead of parsed"),
  hide_audited: bool = Query(False, description="If true, exclude audited records from the parsed feed"),
):
  """Get a specific message by ID and return its position in the filtered results."""
  audited_records = load_audited()
  audited_id_set = {rec.get("id") for rec in audited_records if rec.get("id") is not None}

  # Search ALL records - this endpoint is for direct ID lookup from search results
  # Don't apply date/audit filters since the ID itself is the primary filter
  all_records = audited_records if audited else RECORDS

  # Find the message by ID in ALL records
  target_record = None
  for rec in all_records:
    if rec.get("id") == message_id:
      target_record = rec
      break

  if target_record is None:
    raise HTTPException(status_code=404, detail=f"Message {message_id} not found")

  # Now apply filters ONLY to get the correct position/index for navigation
  filtered = all_records

  if start_date or end_date:
    from datetime import datetime

    def in_range(rec):
      ts = rec.get("start_ts") or rec.get("end_ts")
      if not ts:
        return False
      try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
      except Exception:
        return False
      if start_date:
        try:
          if dt.date() < datetime.fromisoformat(start_date).date():
            return False
        except Exception:
          pass
      if end_date:
        try:
          if dt.date() > datetime.fromisoformat(end_date).date():
            return False
        except Exception:
          pass
      return True

    filtered = [rec for rec in filtered if in_range(rec)]

  if hide_audited and not audited:
    filtered = [rec for rec in filtered if rec.get("id") not in audited_id_set]

  # Find the index within filtered results for the UI navigation
  message_index = None
  for idx, rec in enumerate(filtered):
    if rec.get("id") == message_id:
      message_index = idx
      break

  # If message not in filtered results, set index to 0 (show as first item)
  if message_index is None:
    message_index = 0

  # Return the target record with its position in filtered results
  annotated = dict(target_record)
  annotated["audited"] = target_record.get("id") in audited_id_set

  return {
    "total": len(filtered),
    "records": [annotated],
    "start": message_index,
    "limit": 1,
    "audited": audited
  }


@app.post("/reload")
def reload_data():
  global RECORDS
  RECORDS = load_records()
  return {"total": len(RECORDS)}


def estimate_item_weight(item: Dict[str, Any]) -> float | None:
    """Estimate weight in pounds for an item based on quantity, unit, and item name"""
    if not item:
        return None

    name = str(item.get('name', '')).lower().strip()
    quantity = item.get('quantity')
    unit = str(item.get('unit', '')).lower().strip()
    subcategory = str(item.get('subcategory', '')).lower().strip()

    # If already has estimated_lbs, use it
    if item.get('estimated_lbs') is not None:
        return float(item['estimated_lbs'])

    # If no quantity, can't estimate
    try:
        qty = float(quantity) if quantity else 0
    except (ValueError, TypeError):
        return None

    if qty <= 0:
        return None

    # Direct weight units
    if unit in ['lb', 'lbs', 'pound', 'pounds']:
        return qty

    # Pallet weights
    if 'pallet' in unit:
        if 'full' in unit:
            return qty * 800  # Full pallet
        elif 'small' in unit:
            return qty * 250  # Small/partial pallet
        else:
            return qty * 500  # Generic pallet (middle estimate)

    # Case/box weights (estimated by category/item)
    if unit in ['case', 'cases', 'box', 'boxes']:
        # Item-specific case weights
        if 'produce' in name or 'fruit' in name or 'vegetable' in name or subcategory == 'produce':
            return qty * 30
        if 'meat' in name or 'chicken' in name or 'beef' in name or subcategory == 'meat':
            return qty * 40
        if 'dairy' in name or subcategory == 'dairy':
            return qty * 35
        if 'bread' in name or 'baked' in name:
            return qty * 20
        # Default case weight
        return qty * 25

    # Bag weights
    if unit in ['bag', 'bags']:
        return qty * 5

    # Item-specific weights (per unit/item)
    item_weights = {
        'apple': 0.33, 'banana': 0.25, 'orange': 0.3,
        'potato': 0.5, 'onion': 0.3, 'carrot': 0.1,
        'broccoli': 1.5, 'cauliflower': 2, 'lettuce': 1,
        'milk': 8.6, 'bread': 1.5, 'chicken': 3,
        'beef': 3, 'pork': 3, 'eggs': 1.5
    }

    for item_key, weight in item_weights.items():
        if item_key in name:
            return qty * weight

    # Fallback by subcategory
    if not unit or unit in ['item', 'items', 'unit', 'units']:
        if subcategory == 'produce':
            return qty * 1
        if subcategory == 'meat':
            return qty * 2
        if subcategory == 'dairy':
            return qty * 2
        if subcategory in ['bread', 'grain']:
            return qty * 1.5

    return None

def add_estimated_weights(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Add estimated_lbs to items that don't have it"""
    if not items:
        return items

    result = []
    for item in items:
        item_copy = dict(item)
        if item_copy.get('estimated_lbs') is None:
            weight = estimate_item_weight(item_copy)
            if weight is not None:
                item_copy['estimated_lbs'] = round(weight, 1)
        result.append(item_copy)
    return result

@app.post("/audit")
def audit_record(rec: Dict[str, Any]):
  if not isinstance(rec, dict):
    raise HTTPException(status_code=400, detail="Invalid payload: expected JSON object")
  if rec.get("id") is None:
    raise HTTPException(status_code=400, detail="Invalid payload: missing id")

  # Validate recurring events
  if rec.get("recurring"):
    if not rec.get("rescue_location_canonical"):
      raise HTTPException(status_code=400, detail="Recurring event requires rescue_location_canonical")
    day_of_week = rec.get("day_of_week")
    if not isinstance(day_of_week, int) or not (0 <= day_of_week <= 6):
      raise HTTPException(status_code=400, detail="Recurring event requires day_of_week (0-6)")
    if not rec.get("sections") or not isinstance(rec.get("sections"), list):
      raise HTTPException(status_code=400, detail="Recurring event requires sections array")

    # Check for duplicates: same location + day_of_week
    existing_recurring = [r for r in load_audited() if r.get("recurring") and r.get("id") != rec.get("id")]
    for existing in existing_recurring:
      if (existing.get("rescue_location_canonical") == rec.get("rescue_location_canonical") and
          existing.get("day_of_week") == day_of_week):
        raise HTTPException(
          status_code=409,
          detail=f"A recurring event already exists for {rec.get('rescue_location_canonical')} on this day"
        )

  try:
    if rec.get("audited"):
      save_audited_record(rec)
      return {"status": "ok", "id": rec.get("id"), "audited": True}
    delete_audited_record(rec.get("id"))
    return {"status": "ok", "id": rec.get("id"), "audited": False}
  except Exception as exc:
    raise HTTPException(status_code=500, detail=f"Could not persist audit: {exc}") from exc


@app.post("/rescue-log")
def create_rescue_log(payload: Dict[str, Any]):
  """Create a new rescue log entry in the rescue_logs table."""
  if not USE_SUPABASE or not supabase:
    raise HTTPException(status_code=500, detail="Supabase not configured")

  # Validate required fields
  if not payload.get("location"):
    raise HTTPException(status_code=400, detail="Missing required field: location")
  if not payload.get("rescued_at"):
    raise HTTPException(status_code=400, detail="Missing required field: rescued_at")

  items = payload.get("items", [])
  if not isinstance(items, list):
    raise HTTPException(status_code=400, detail="items must be an array")

  # Add estimated weights to items
  items_with_weights = add_estimated_weights(items)

  # Calculate total estimated lbs
  total_lbs = sum(float(item.get("estimated_lbs") or 0) for item in items_with_weights)

  try:
    result = supabase.table("rescue_logs").insert({
      "location": payload.get("location"),
      "rescued_at": payload.get("rescued_at"),
      "items": items_with_weights,
      "total_estimated_lbs": round(total_lbs, 1) if total_lbs > 0 else None,
      "photo_urls": payload.get("photo_urls", []),
      "notes": payload.get("notes"),
    }).execute()

    new_id = result.data[0]["id"] if result.data else None
    return {"status": "ok", "id": new_id}
  except Exception as exc:
    raise HTTPException(status_code=500, detail=f"Could not save rescue log: {exc}") from exc


@app.get("/health")
def health():
  return {"status": "ok", "total": len(RECORDS)}


# Model inference endpoints

_CACHED_INFERENCER = None


def get_inferencer():
  """Lazy-load inferencer singleton."""
  global _CACHED_INFERENCER
  if _CACHED_INFERENCER is None:
    try:
      from infer import SlackMessageInferencer
      from manage_models import ModelRegistry

      registry = ModelRegistry()
      adapter_path = registry.get_adapter_path("active")

      if not adapter_path:
        raise RuntimeError("No active model set")

      _CACHED_INFERENCER = SlackMessageInferencer(adapter_path=adapter_path, use_quantization=True)
      _CACHED_INFERENCER.load_model()

    except Exception as exc:
      raise HTTPException(status_code=503, detail=f"Model not available: {exc}") from exc

  return _CACHED_INFERENCER


@app.post("/infer")
def run_inference(request: Dict[str, Any]):
  """Run model inference on a message."""
  message_text = request.get("message_text")
  if not message_text:
    raise HTTPException(status_code=400, detail="message_text is required")

  version = request.get("version", "active")

  try:
    inferencer = get_inferencer()
    prediction = inferencer.infer_single(message_text)

    return {"inference": prediction, "version": version}

  except Exception as exc:
    raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc


@app.get("/compare/{record_id}")
def compare_extractions(record_id: int):
  """Compare regex vs model extraction for a record."""
  record = next((r for r in RECORDS if r.get("id") == record_id), None)
  if not record:
    raise HTTPException(status_code=404, detail=f"Record {record_id} not found")

  message_text = "\n".join(record.get("raw_messages", []))
  if not message_text:
    raise HTTPException(status_code=400, detail="Record has no raw messages")

  # Regex extraction (from record)
  regex_result = {
    "direction": record.get("direction"),
    "rescue_location": record.get("rescue_location_canonical") or record.get("rescue_location"),
    "drop_off_location": record.get("drop_off_location_canonical") or record.get("drop_off_location"),
    "items": record.get("items", []),
    "sections": record.get("sections", []),
  }

  # Model inference
  try:
    inferencer = get_inferencer()
    model_result = inferencer.infer_single(message_text)

    # Compute comparison
    comparison = inferencer.compare_with_regex(model_result, regex_result)

    return {
      "record_id": record_id,
      "message_text": message_text,
      "regex": regex_result,
      "model": model_result,
      "comparison": comparison,
    }

  except Exception as exc:
    raise HTTPException(status_code=500, detail=f"Comparison failed: {exc}") from exc


@app.get("/training/stats")
def get_training_stats():
  """Get statistics about audited data and model versions."""
  from manage_models import ModelRegistry

  audited_records = load_audited()
  registry = ModelRegistry()

  models = registry.list_models()
  active_version = registry.get_active_version()

  return {
    "audited_count": len(audited_records),
    "ready_for_training": len(audited_records) >= 10,
    "models": models,
    "active_version": active_version,
    "has_active_model": active_version is not None,
  }


if __name__ == "__main__":
  import uvicorn
  uvicorn.run(app, host="0.0.0.0", port=5055)
