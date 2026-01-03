#!/usr/bin/env python3
"""
Lightweight, regex-first extractor for the Slack warehouse channel export.

- Reads the XLSX at training/peft/data/slack_messages_C026VATTHDE.xlsx
- Groups consecutive messages from the same user (default 30m window)
- Classifies direction (inbound, outbound, both, unknown)
- Extracts rescue/drop-off locations with heuristics
- Parses item lines/numbers with regex (no LLM)
- Writes JSONL and prints quick summary stats
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
import xml.etree.ElementTree as ET


@dataclass
class MessageRow:
  ts: str
  dt: Optional[datetime]
  user: str
  text: str
  msg_type: str
  subtype: str
  thread_ts: str
  reply_count: str


@dataclass
class ParsedItem:
  name: str
  quantity: Optional[float]
  unit: Optional[str]
  estimated_lbs: Optional[float]
  subcategory: str


NUMBER_WORDS: Dict[str, float] = {
  "zero": 0,
  "one": 1,
  "two": 2,
  "three": 3,
  "four": 4,
  "five": 5,
  "six": 6,
  "seven": 7,
  "eight": 8,
  "nine": 9,
  "ten": 10,
  "eleven": 11,
  "twelve": 12,
  "half": 0.5,
}

ITEM_UNIT_MAP: Dict[str, str] = {
  "cs": "case",
  "case": "case",
  "cases": "case",
  "box": "box",
  "boxes": "box",
  "bin": "bin",
  "bins": "bin",
  "bag": "bag",
  "bags": "bag",
  "shopping bag": "bag",
  "shopping bags": "bag",
  "tote": "tote",
  "totes": "tote",
  "crate": "crate",
  "crates": "crate",
  "flat": "flat",
  "flats": "flat",
  "pkg": "package",
  "pkgs": "package",
  "package": "package",
  "packages": "package",
  "pallet": "pallet",
  "pallets": "pallet",
  "lb": "lb",
  "lbs": "lb",
  "pound": "lb",
  "pounds": "lb",
  "gal": "gallon",
  "gals": "gallon",
  "gallon": "gallon",
  "gallons": "gallon",
  "dozen": "dozen",
  "dz": "dozen",
  "bottle": "bottle",
  "bottles": "bottle",
  "can": "can",
  "cans": "can",
  "loaf": "loaf",
  "loaves": "loaf",
  "bunch": "bunch",
  "bunches": "bunch",
  "tray": "tray",
  "trays": "tray",
  "jar": "jar",
  "jars": "jar",
  "clamshell": "clamshell",
  "clamshells": "clamshell",
}
WEIGHT_CONFIG_PATH = Path(__file__).parent / "weight_config.json"
def load_weight_config() -> Dict[str, Any]:
  try:
    with WEIGHT_CONFIG_PATH.open() as f:
      return json.load(f)
  except Exception:
    return {}

WEIGHT_CONFIG = load_weight_config()

ITEM_PATTERN = re.compile(
  r"""
  ^\s*                            # start of segment
  [-*•\[]*\s*                     # optional bullet-ish markers
  ~?\s*                           # optional tilde for approximate quantities
  (?P<qty>\d+(?:\.\d+)?)          # quantity
  \s*
  (?:                             # optional size adjectives before unit
    (?:small|sm|large|lrg|big)\s+
  )?
  (?P<unit>                       # optional unit
    cs|cases?|boxes?|box|bins?|bags?|shopping\s+bags?|totes?|crates?|flats?|pkgs?|packages?|pallets?|pallet|
    lbs?|pounds?|gals?|gallons?|gal|
    dozen|dz|
    bottle?s?|cans?|loaves?|loaf|bunch(?:es)?|trays?|jars?|clamshells?|
    pkg|bag|crate|flat|bin|tote|box
  )?
  \s*
  (?:of\s+)?                      # optional "of"
  (?P<name>[A-Za-z][^,;|\n]*)     # item name
  (?=$|[,;|]|(?:\s+(?:and|&)\s+~?\d)|\n)
  """,
  re.IGNORECASE | re.VERBOSE,
)

LINE_SPLIT_RE = re.compile(r"[|;/,]+|\n+")
AND_SPLIT_RE = re.compile(r"\b(?:and|&)\b")


def parse_iso(ts: str) -> Optional[datetime]:
  if not ts:
    return None
  try:
    clean = ts.replace("Z", "+00:00")
    return datetime.fromisoformat(clean)
  except Exception:
    return None


def col_idx(cell_ref: str) -> int:
  match = re.match(r"([A-Z]+)(\d+)", cell_ref or "")
  if not match:
    return 0
  letters = match.group(1)
  idx = 0
  for ch in letters:
    idx = idx * 26 + (ord(ch) - ord("A") + 1)
  return idx - 1


def read_xlsx_messages(path: str) -> List[MessageRow]:
  with zipfile.ZipFile(path) as zf:
    sheet = ET.parse(zf.open("xl/worksheets/sheet1.xml")).getroot()

  ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
  rows: List[MessageRow] = []
  header: List[str] = []
  for row in sheet.findall(f".//{ns}row"):
    cells: Dict[int, str] = {}
    for c in row.findall(f"{ns}c"):
      ref = c.get("r") or ""
      idx = col_idx(ref)
      text = ""
      if c.get("t") == "inlineStr":
        is_elem = c.find(f"{ns}is")
        if is_elem is not None:
          t_elem = is_elem.find(f"{ns}t")
          if t_elem is not None:
            text = "".join(t_elem.itertext())
      else:
        v = c.find(f"{ns}v")
        if v is not None:
          text = v.text or ""
      cells[idx] = text

    if not cells:
      continue
    max_idx = max(cells)
    row_vals = [""] * (max_idx + 1)
    for idx, val in cells.items():
      row_vals[idx] = val

    if not header:
      header = row_vals
      continue

    data = {header[i]: row_vals[i] if i < len(row_vals) else "" for i in range(len(header))}
    rows.append(
      MessageRow(
        ts=data.get("Timestamp", ""),
        dt=parse_iso(data.get("Timestamp", "")),
        user=data.get("User", ""),
        text=data.get("Message", "") or "",
        msg_type=data.get("Type", ""),
        subtype=data.get("Subtype", ""),
        thread_ts=data.get("ThreadTS", ""),
        reply_count=data.get("ReplyCount", ""),
      ),
    )
  return rows


def normalize_text(text: str) -> str:
  # Slack pastes often contain repeated whitespace or NBSPs
  return (
    text.replace("\u00a0", " ")
    .replace("\r\n", "\n")
    .replace("\r", "\n")
    .strip()
  )


def numberize_words(text: str) -> str:
  def repl(match: re.Match[str]) -> str:
    word = match.group(0).lower()
    return str(NUMBER_WORDS.get(word, match.group(0)))

  return re.sub(r"\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half)\b", repl, text, flags=re.IGNORECASE)


def clean_location(value: str) -> str:
  cleaned = re.sub(r"[;,.]+$", "", value or "")
  cleaned = re.sub(r"\s+", " ", cleaned).strip()
  return cleaned


def extract_rescue_location(text: str) -> str:
  drop_match = re.search(r"(?:dropped\s+off\s+from|dropped\s+from|drop\s+off\s+from)\s+(.+)", text, flags=re.IGNORECASE)
  if drop_match:
    remainder = drop_match.group(1).split("\n")[0]
    remainder = remainder.split(":")[0]
    dash = re.search(r"\s[-–—]\s", remainder)
    if dash:
      remainder = remainder[: dash.start()]
    return clean_location(remainder)

  match = re.search(
    r"(?:picked\s+up\s+(?:some\s+)?(?:produce\s+)?from|rescued\s+from|rescue\s+from|pickup(?:ed)?\s+from|earlier\s+today\s+from|today\s+from|scooped\s+(?:this\s+)?from)\s+(.+)",
    text,
    flags=re.IGNORECASE,
  )
  if match:
    remainder = match.group(1).split("\n")[0]
    # Handle "in Englewood" and similar suffixes
    remainder = re.sub(r'\s+in\s+\w+$', '', remainder, flags=re.IGNORECASE)
    remainder = remainder.split(":")[0]
    dash_match = re.search(r"\s[-–—]\s", remainder)
    if dash_match:
      remainder = remainder[: dash_match.start()]
    return clean_location(remainder)

  # Try simple "from X" pattern at start of message
  simple_from = re.search(r"^(?:from|From)\s+([A-Z][A-Za-z0-9 &''-]{2,})", text)
  if simple_from:
    return clean_location(simple_from.group(1))

  return ""


def extract_dropoff_location(text: str) -> str:
  patterns = [
    r"(?:dropped\s+off|dropped)\s+(?:at|to|surplus\s+at)\s+(.+)",
    r"(?:delivered|deliver|delivering)\s+(?:to|at)\s+(.+)",
    r"(?:brought|bringing|took|taking|sent|sending)\s+(?:to|at)\s+(.+)",
    r"(?:taken\s+to|going\s+to)\s+(.+)",
    r"\bfor\s+([A-Z][A-Za-z0-9 &'-]{2,})",  # e.g., "grabbed X for LSRSN"
    r"^([A-Za-z0-9 &'-]{2,})\s+(?:took|grabbed|picked\s+up)\b",  # e.g., "NA4J took ..."
    r"(?:claimed|labeled)\s+for\s+([A-Z][A-Za-z0-9 &'-]{2,})",  # e.g., "claimed for WSMA"
  ]
  for pat in patterns:
    match = re.search(pat, text, flags=re.IGNORECASE)
    if match:
      remainder = match.group(1).split("\n")[0]
      remainder = remainder.split(";")[0]
      remainder = remainder.split(",")[0]
      # Remove trailing "and X" patterns
      remainder = re.sub(r'\s+and\s+.*$', '', remainder)
      return clean_location(remainder)
  if "taken to" in text.lower() and "fridge" in text.lower():
    return "Love Fridge"
  return ""


def parse_sections(text: str) -> List[Dict[str, Any]]:
  lines = normalize_text(text).split("\n")
  sections: List[Tuple[str, List[str]]] = []
  current_loc = None
  buffer: List[str] = []

  heading_re = re.compile(r"^([A-Za-z0-9 /&'’.-]+):\s*$")

  for line in lines:
    heading = heading_re.match(line)
    if heading:
      # flush previous
      if current_loc and buffer:
        sections.append((current_loc, "\n".join(buffer)))
      current_loc = heading.group(1).strip()
      buffer = []
      continue
    if current_loc:
      buffer.append(line)

  if current_loc and buffer:
    sections.append((current_loc, "\n".join(buffer)))

  parsed_sections = []
  for loc, chunk in sections:
    chunk_items = parse_items(chunk)
    if not chunk_items:
      continue
    parsed_sections.append({
      "location": clean_location(loc),
      "items": [item.__dict__ if isinstance(item, ParsedItem) else item for item in chunk_items],
    })
  return parsed_sections


def detect_direction(text: str, rescue_loc: str = "", drop_loc: str = "") -> str:
  if rescue_loc and drop_loc:
    return "both"
  if rescue_loc:
    return "inbound"
  if drop_loc:
    return "outbound"

  lower = text.lower()
  inbound = any(
    phrase in lower
    for phrase in [
      "rescued from",
      "rescue from",
      "picked up from",
      "pickup from",
      "picked up at",
      "today from",
      "earlier today from",
      "drop off at uc",  # dropped at warehouse counts as inbound to storage
      "dropped off at uc",
      "dropped at uc",
      "left at uc",
      "left in the warehouse",
      "dropped at warehouse",
      "dropped ",
      "left in",
      "left at",
      "drop off",
    ]
  )
  outbound = any(
    phrase in lower
    for phrase in [
      "dropped off",
      "drop off",
      "delivered to",
      "deliver to",
      "brought to",
      "took to",
      "taking to",
      "grabbed",
      "grabbed for",
      "took",
      "took ",
      "picked up for",
      "for distro",
      "headed to",
      "delivered",
      "delivery to",
      "for love fridge",
      "for lf",
      "stocked",
    ]
  )
  if inbound and outbound:
    return "both"
  if inbound:
    return "inbound"
  if outbound:
    return "outbound"
  return "unknown"


def split_item_segments(text: str) -> List[str]:
  text = text.replace("•", "\n")
  text = LINE_SPLIT_RE.sub("\n", text)
  segments: List[str] = []
  for block in text.split("\n"):
    block = block.strip(" -•\t")
    if not block:
      continue
    for part in AND_SPLIT_RE.split(block):
      part = part.strip(" -•\t")
      if part:
        segments.append(part)
  return segments


def categorize_item(name: str) -> str:
  lower = name.lower()
  def has_any(tokens: Iterable[str]) -> bool:
    return any(token in lower for token in tokens)

  if has_any(["water", "juice", "soda", "coffee", "tea", "latte", "drink", "beverage", "milk", "kombucha", "sparkling", "sports drink", "coconut water"]):
    return "drinks"
  if has_any(["snack", "chips", "cracker", "pretzel", "cookie", "popcorn", "granola", "trail mix", "protein bar", "granola bar", "candy", "nuts", "almond", "peanut", "cashew", "pistachio"]):
    return "snacks"
  if has_any(["apple", "orange", "banana", "little banana", "berry", "grape", "melon", "clementine", "fruit", "green", "greens", "lettuce", "cabbage", "potato", "onion", "pepper", "tomato", "carrot", "spinach", "produce", "vegetable", "brussel", "brussels", "pear", "lemon", "grapefruit", "guava", "cuke", "cucumber", "bean", "split pea", "broccoli", "brocolli"]):
    return "produce"
  if has_any(["bread", "loaf", "loaves", "rice", "pasta", "grain", "tortilla", "dessert", "cake", "bun"]):
    return "grain"
  if has_any(["chicken", "beef", "pork", "turkey", "meat", "steak", "sausage", "ribs"]):
    return "meat"
  if has_any(["canned", "dry goods", "pantry", "shelf stable", "flour", "sugar", "salt", "spice", "seasoning", "oil", "vinegar", "beans", "lentil", "lentils", "chickpea", "oat", "oats", "oatmeal", "cereal", "broth", "stock", "sauce", "condiment"]):
    return "dry goods"
  if has_any(["milk", "cheese", "yogurt", "butter", "cream", "half and half", "cottage cheese", "sour cream", "kefir"]):
    return "dairy"
  if has_any(["scallop", "scallops", "fish", "shrimp", "salmon", "tuna"]):
    return "seafood"
  return ""


def estimate_weight(qty: Optional[float], unit: Optional[str], name: str) -> Optional[float]:
  if qty is None or qty <= 0:
    return None
  unit_norm = (unit or "").lower()
  name_norm = name.lower()

  if unit_norm in {"lb", "lbs", "pound", "pounds"}:
    return round(qty, 2)

  base_cfg = WEIGHT_CONFIG.get("base", {})
  per_unit = base_cfg.get("default", 5)

  # Check for item-specific weight overrides first
  item_specific = WEIGHT_CONFIG.get("item_specific", {})
  for item_keyword, unit_weights in item_specific.items():
    if item_keyword in name_norm:
      if unit_norm in unit_weights:
        per_unit = unit_weights[unit_norm]
        estimate = round(per_unit * qty, 2)
        return estimate if estimate >= 0 else None

  food_map = WEIGHT_CONFIG.get("food_weights", {})
  if any(tok in name_norm for tok in food_map.get("produce_heavy", [])):
    per_unit = base_cfg.get("produce_heavy", per_unit)
  elif any(tok in name_norm for tok in food_map.get("produce_light", [])):
    per_unit = base_cfg.get("produce_light", per_unit)
  elif any(tok in name_norm for tok in food_map.get("meat", [])):
    per_unit = base_cfg.get("meat", per_unit)
  elif any(tok in name_norm for tok in food_map.get("dairy", [])):
    per_unit = base_cfg.get("dairy", per_unit)
  elif any(tok in name_norm for tok in food_map.get("seafood", [])):
    per_unit = base_cfg.get("meat", per_unit)

  unit_overrides = WEIGHT_CONFIG.get("unit_overrides", {})
  if unit_norm in unit_overrides:
    per_unit = max(per_unit, unit_overrides.get(unit_norm, per_unit))
  elif " " in unit_norm:
    # allow multi-word unit keys like "shopping bag"
    if unit_overrides.get(unit_norm):
      per_unit = max(per_unit, unit_overrides[unit_norm])
  else:
    # fallback heuristics if not explicitly in config
    if "bag" in unit_norm:
      per_unit = max(per_unit, 8)
    elif "bin" in unit_norm or "tote" in unit_norm or "crate" in unit_norm:
      per_unit = max(per_unit, 25)
    elif "box" in unit_norm or "case" in unit_norm or "cs" in unit_norm or "pkg" in unit_norm or "package" in unit_norm:
      per_unit = max(per_unit, 15)
    elif "flat" in unit_norm:
      per_unit = max(per_unit, 12)
    elif "gallon" in unit_norm or "gal" in unit_norm:
      per_unit = max(per_unit, 8)
    elif unit_norm in {"lb", "pound", "pounds"}:
      per_unit = 1
    elif "dozen" in unit_norm or unit_norm == "dz":
      per_unit = max(per_unit, 4)
    elif "loaf" in unit_norm:
      per_unit = max(per_unit, 0.5)
    elif "bottle" in unit_norm or "can" in unit_norm or "jar" in unit_norm:
      per_unit = max(per_unit, 2)
    elif "tray" in unit_norm or "clamshell" in unit_norm:
      per_unit = max(per_unit, 3)
    elif "bunch" in unit_norm:
      per_unit = max(per_unit, 5)
    elif "each" in unit_norm:
      per_unit = max(per_unit, 2)
    elif "bread" in name_norm or "dessert" in name_norm:
      per_unit = max(per_unit, 2.5)

  estimate = round(per_unit * qty, 2)
  return estimate if estimate >= 0 else None


def parse_items(text: str) -> List[ParsedItem]:
  normalized = numberize_words(normalize_text(text))
  items: List[ParsedItem] = []
  for segment in split_item_segments(normalized):
    if not segment:
      continue
    lower = segment.lower()
    if lower.startswith(("http", "<http", "https")) or "google.com/maps" in lower:
      continue
    if "<@" in segment:
      continue

    # Drop leading words before the first digit or tilde (e.g., "grabbed 2 boxes...")
    segment = re.sub(r"^[^0-9~]*", "", segment)
    segment = segment.strip()
    if not segment:
      continue

    match = ITEM_PATTERN.match(segment)
    if not match:
      continue
    qty_raw = match.group("qty")
    try:
      qty = float(qty_raw)
    except Exception:
      qty = None
    unit_raw = match.group("unit") or ""
    unit_norm = ITEM_UNIT_MAP.get(unit_raw.lower().strip(), unit_raw.lower().strip() or None)
    name = match.group("name").strip(" .;-").strip()
    if not name:
      continue
    name = re.sub(r"\(([^)]{1,80})\)\s*$", "", name).strip()
    name = re.sub(r"\b(?:in|on|inside)\s+(?:the\s+)?(?:cooler|freezer|fridge|fridges?)\b", "", name, flags=re.IGNORECASE).strip()

    if not unit_norm:
      trailing_unit = re.match(r"^(?P<item>.+?)\s+(?P<unit>boxes?|box|cases?|case|crates?|totes?|bins?|bags?)$", name, flags=re.IGNORECASE)
      if trailing_unit:
        unit_guess = trailing_unit.group("unit").lower()
        unit_norm = ITEM_UNIT_MAP.get(unit_guess, unit_guess)
        name = trailing_unit.group("item").strip()

    lower_name = name.lower()
    if not unit_norm:
      bag_match = re.match(r"^(?:big|large|lrg)?\s*bags?\b\s+(.*)$", name, flags=re.IGNORECASE)
      if bag_match:
        unit_norm = "bag"
        name = bag_match.group(1).strip()
    if unit_norm in {"bag", "bags"} and (lower_name.startswith("big") or lower_name.startswith("large") or lower_name.startswith("lrg")):
      name = re.sub(r"^(?:big|large|lrg)\s+", "", name, flags=re.IGNORECASE).strip()
    if name.lower().startswith("big bags"):
      name = re.sub(r"\bbig\s+bags?\s+", "", name, flags=re.IGNORECASE).strip()
    name = re.sub(r"\bbags?\b", "", name, flags=re.IGNORECASE).strip()
    name = re.sub(r"^(?:big|large|small|lrg)\s+(split\s+peas?)", r"\1", name, flags=re.IGNORECASE)
    name = re.sub(r"\s{2,}", " ", name).strip()
    name = name.lower().strip()
    typo_map = {
      "brocolli": "broccoli",
      "brussel sprouts": "brussels sprouts",
    }
    name = typo_map.get(name, name)
    alpha_len = len(re.sub(r"[^a-z]", "", name.lower()))
    if alpha_len < 3:
      continue
    if "<@" in name or "http" in name.lower():
      continue
    if qty is not None and qty > 500:
      continue
    if qty is not None and qty > 150 and not unit_norm:
      continue
    subcategory = categorize_item(name)
    name_lower = name.lower()
    if any(token in name_lower for token in ["google", "docs.google", "guide", "meeting", "channel", "thermometer", "dumpster", "door", "code", "recycling", "compost", "cardboard", "loading", "schedule"]):
      continue
    if not unit_norm and re.search(r"\b(am|pm)\b", name_lower):
      continue
    if "!" in name:
      continue
    if not unit_norm and subcategory == "" and len(name.split()) <= 1 and (qty is None or qty <= 2):
      continue
    if not unit_norm and not subcategory:
      continue
    estimated_lbs = estimate_weight(qty, unit_norm, name)
    items.append(ParsedItem(name=name, quantity=qty, unit=unit_norm, estimated_lbs=estimated_lbs, subcategory=subcategory))
  return items


def group_messages(rows: List[MessageRow], window_minutes: int) -> List[Dict]:
  usable = [r for r in rows if r.msg_type == "message" and r.subtype != "channel_join" and r.text.strip()]
  usable.sort(key=lambda r: (r.dt or datetime.min.replace(tzinfo=timezone.utc)))

  groups: List[Dict] = []
  current: Optional[Dict] = None
  delta = timedelta(minutes=window_minutes)

  for row in usable:
    if current and row.user == current["user"] and row.dt and current["last_dt"] and row.dt - current["last_dt"] <= delta:
      current["messages"].append(row.text)
      current["timestamps"].append(row.ts)
      current["last_dt"] = row.dt
    else:
      if current:
        groups.append(current)
      current = {
        "user": row.user,
        "start_ts": row.ts,
        "end_ts": row.ts,
        "start_dt": row.dt,
        "last_dt": row.dt,
        "messages": [row.text],
        "timestamps": [row.ts],
      }
  if current:
    groups.append(current)
  return groups


def summarize(records: List[Dict]) -> None:
  direction_counter = Counter(r["direction"] for r in records)
  item_hits = sum(1 for r in records if r["items"])
  rescue_counter = Counter(r["rescue_location"] for r in records if r["rescue_location"])
  drop_counter = Counter(r["drop_off_location"] for r in records if r["drop_off_location"])
  item_counter = Counter()
  for r in records:
    for item in r["items"]:
      item_counter[item["name"].lower()] += item.get("quantity") or 1

  print("\nSummary:")
  print(f"- grouped messages: {len(records)}")
  print(f"- with parsed items: {item_hits} ({item_hits / max(len(records), 1):.1%})")
  print("- direction counts:")
  for key, val in direction_counter.most_common():
    print(f"  {key}: {val}")
  if rescue_counter:
    print("- top rescue locations:")
    for loc, count in rescue_counter.most_common(10):
      print(f"  {loc}: {count}")
  if drop_counter:
    print("- top drop-off locations:")
    for loc, count in drop_counter.most_common(10):
      print(f"  {loc}: {count}")
  if item_counter:
    print("- top items (by mentions/quantity sum):")
    for name, count in item_counter.most_common(10):
      print(f"  {name}: {count}")


def main() -> None:
  parser = argparse.ArgumentParser(description="Regex-based Slack message extractor (no LLM).")
  parser.add_argument(
    "--input",
    default="training/peft/data/slack_messages_C026VATTHDE.xlsx",
    help="Path to Slack XLSX export",
  )
  parser.add_argument(
    "--output",
    default="training/peft/data/slack_messages_parsed.jsonl",
    help="Where to write JSONL results",
  )
  parser.add_argument(
    "--group-minutes",
    type=int,
    default=30,
    help="Window to merge consecutive messages from the same user",
  )
  args = parser.parse_args()

  rows = read_xlsx_messages(args.input)
  groups = group_messages(rows, window_minutes=args.group_minutes)

  records: List[Dict] = []
  for idx, group in enumerate(groups):
    combined_text = "\n".join(group["messages"])
    rescue_loc = extract_rescue_location(combined_text)
    drop_loc = extract_dropoff_location(combined_text)
    direction = detect_direction(combined_text, rescue_loc=rescue_loc, drop_loc=drop_loc)
    sections = parse_sections(combined_text)
    if sections:
      flat_items = []
      for sec in sections:
        flat_items.extend(sec.get("items", []))
      items = flat_items
      if not rescue_loc and sections[0].get("location"):
        rescue_loc = sections[0]["location"]
      if drop_loc:
        existing = {sec.get("location") for sec in sections}
        if drop_loc not in existing:
          sections.append({"location": drop_loc, "items": flat_items})
    else:
      items = [
        {
          "name": item.name,
          "quantity": item.quantity,
          "unit": item.unit,
          "estimated_lbs": item.estimated_lbs,
          "subcategory": item.subcategory,
        }
        for item in parse_items(combined_text)
      ]
      if rescue_loc or drop_loc:
        sections = [{
          "location": rescue_loc or drop_loc or "",
          "items": items,
        }]

    records.append(
      {
        "id": idx + 1,
        "user": group["user"],
        "start_ts": group["start_ts"],
        "end_ts": group["timestamps"][-1] if group["timestamps"] else group["start_ts"],
        "direction": direction,
        "rescue_location": rescue_loc,
        "drop_off_location": drop_loc,
        "items": items,
        "sections": sections,
        "raw_messages": group["messages"],
      },
    )

  with open(args.output, "w", encoding="utf-8") as f:
    for rec in records:
      f.write(json.dumps(rec, ensure_ascii=False) + "\n")

  print(f"Wrote {len(records)} rows to {args.output}")
  summarize(records)


if __name__ == "__main__":
  sys.exit(main())
