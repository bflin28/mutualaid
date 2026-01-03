#!/usr/bin/env python3
"""
Export audited Slack regex records into the PEFT JSONL format used by train.py.

Input: training/peft/data/slack_messages_audited.jsonl
Output: training/peft/data/slack_audited_training.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


BASE = Path(__file__).resolve().parent
DEFAULT_INPUT = BASE / "data" / "slack_messages_audited.jsonl"
DEFAULT_OUTPUT = BASE / "data" / "slack_audited_training.jsonl"
ALIASES_PATH = BASE / "data" / "location_aliases.json"

DEFAULT_PROMPT_TEMPLATE = (
    "You are a Slack warehouse log extractor. Return JSON only with fields:\n"
    "- direction (string|null) [inbound, outbound, both, unknown]\n"
    "- rescue_location (string|null)\n"
    "- drop_off_location (string|null)\n"
    "- sections (array of { location, items })\n"
    "- items (array of rows with name, quantity, unit, estimated_lbs, subcategory)\n\n"
    "Message:\n{input_text}\n\n"
    "JSON:"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export audited Slack records to PEFT JSONL.")
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT),
        help="Path to slack_messages_audited.jsonl",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Where to write the PEFT JSONL dataset",
    )
    parser.add_argument(
        "--include-empty",
        action="store_true",
        help="Keep records with no parsed items",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=None,
        help="Optional cap on exported records",
    )
    parser.add_argument(
        "--prompt-template",
        default=DEFAULT_PROMPT_TEMPLATE,
        help="Custom prompt with {input_text} placeholder",
    )
    parser.add_argument(
        "--aliases",
        default=str(ALIASES_PATH),
        help="Path to location_aliases.json (used to canonicalize locations)",
    )
    parser.add_argument(
        "--no-canonical",
        action="store_true",
        help="Use raw location fields instead of *_canonical when present",
    )
    return parser.parse_args()


def string_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def normalize_location_key(value: Any) -> str:
    clean = re.sub(r"[^a-z0-9 ]+", " ", str(value or "").lower()).strip()
    clean = re.sub(r"\s+", " ", clean)
    return clean


def load_location_aliases(path: Path) -> Dict[str, str]:
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    lookup: Dict[str, str] = {}
    for canonical, aliases in (data or {}).items():
        canon = string_or_none(canonical)
        if not canon:
            continue
        canon_key = normalize_location_key(canon)
        if canon_key:
            lookup[canon_key] = canon
        if isinstance(aliases, list):
            for alias in aliases:
                alias_key = normalize_location_key(alias)
                if alias_key:
                    lookup[alias_key] = canon
    return lookup


def strip_location_lead_ins(value: Any) -> str:
    cleaned = string_or_none(value) or ""
    if not cleaned:
        return ""
    patterns = [
        r"^[A-Za-z0-9 /&'.-]+\s+picked\s+up\s+(?:this\s+morning|earlier\s+today|today)?\s+at\s+(.+)$",
        r"^[A-Za-z0-9 /&'.-]+\s+picked\s+up\s+at\s+(.+)$",
        r"^[A-Za-z0-9 /&'.-]+\s+picked\s+up\s+from\s+(.+)$",
        r"^[A-Za-z0-9 /&'.-]+\s+took\s+(?:directly\s+)?from\s+(.+)$",
    ]
    for pat in patterns:
        match = re.match(pat, cleaned, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip().lstrip("-:").strip()
    return cleaned


def canonicalize_location(value: Any, alias_lookup: Dict[str, str]) -> Optional[str]:
    cleaned = strip_location_lead_ins(value)
    if not cleaned:
        return None

    lower_clean = cleaned.lower()
    if " mariano" in lower_clean and " at " in lower_clean:
        before, after = cleaned.rsplit(" at ", 1)
        if after.strip():
            cleaned = after.strip(" :-")

    trimmed = cleaned
    trimmed = re.sub(r"^\s*from\s+", "", trimmed, flags=re.IGNORECASE)
    trimmed = trimmed.split("\n")[0]
    trimmed = trimmed.split("(")[0]
    trimmed = re.sub(r"\s*[:;,-]+\s*$", "", trimmed)
    trimmed = re.sub(r"\btook\b\s*$", "", trimmed, flags=re.IGNORECASE).strip()
    if not trimmed:
        return None

    key = normalize_location_key(trimmed)
    if alias_lookup and key:
        alias = alias_lookup.get(key)
        if alias:
            return alias
        for alias_key, canonical in alias_lookup.items():
            if alias_key and alias_key in key:
                return canonical
    return trimmed


def number_or_none(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    fraction_match = re.match(r"^(?P<whole>\d+)\s+(?P<num>\d+)/(?P<den>\d+)$", text)
    if fraction_match:
        whole = float(fraction_match.group("whole"))
        num = float(fraction_match.group("num"))
        den = float(fraction_match.group("den"))
        if den:
            return whole + (num / den)
        return None
    simple_fraction = re.match(r"^(?P<num>\d+)/(?P<den>\d+)$", text)
    if simple_fraction:
        num = float(simple_fraction.group("num"))
        den = float(simple_fraction.group("den"))
        return num / den if den else None
    try:
        return float(text)
    except ValueError:
        return None


def normalize_item(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    name = string_or_none(item.get("name") or item.get("item_name"))
    if not name:
        return None
    quantity = number_or_none(item.get("quantity") if "quantity" in item else item.get("qty"))
    unit = string_or_none(item.get("unit") or item.get("container"))
    estimated_lbs = number_or_none(
        item.get("estimated_lbs") if "estimated_lbs" in item else item.get("pounds")
    )
    subcategory = string_or_none(item.get("subcategory") or item.get("category"))
    return {
        "name": name,
        "quantity": quantity,
        "unit": unit,
        "estimated_lbs": estimated_lbs,
        "subcategory": subcategory,
    }


def normalize_items(raw_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in raw_items:
        norm = normalize_item(item)
        if norm:
            normalized.append(norm)
    return normalized


def normalize_sections(
    raw_sections: Any,
    use_canonical: bool,
    alias_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    if not isinstance(raw_sections, list):
        return []
    sections: List[Dict[str, Any]] = []
    for section in raw_sections:
        if not isinstance(section, dict):
            continue
        location_value = None
        if use_canonical:
            location_value = section.get("location_canonical")
        location_value = location_value or section.get("location")
        location = canonicalize_location(location_value, alias_lookup)
        items = normalize_items(section.get("items"))
        if not items and not location:
            continue
        sections.append({"location": location, "items": items})
    return sections


def get_input_text(record: Dict[str, Any]) -> str:
    raw_messages = record.get("raw_messages")
    if isinstance(raw_messages, list):
        parts = [str(msg).strip() for msg in raw_messages if str(msg).strip()]
        return "\n\n".join(parts).strip()
    if raw_messages:
        return str(raw_messages).strip()
    raw_text = record.get("raw_text") or record.get("raw_message") or ""
    return str(raw_text).strip()


def select_location(
    record: Dict[str, Any],
    key: str,
    use_canonical: bool,
    alias_lookup: Dict[str, str],
) -> Optional[str]:
    value = None
    if use_canonical:
        value = record.get(f"{key}_canonical")
    value = value or record.get(key)
    return canonicalize_location(value, alias_lookup)


def iter_records(path: Path) -> Iterable[Dict[str, Any]]:
    with path.open() as f:
        for line in f:
            clean = line.strip()
            if not clean:
                continue
            try:
                yield json.loads(clean)
            except json.JSONDecodeError:
                continue


def build_row(
    record: Dict[str, Any],
    prompt_template: str,
    use_canonical: bool,
    alias_lookup: Dict[str, str],
) -> Optional[Dict[str, Any]]:
    input_text = get_input_text(record)
    if not input_text:
        return None

    sections = normalize_sections(record.get("sections"), use_canonical=use_canonical, alias_lookup=alias_lookup)
    if not sections:
        items = normalize_items(record.get("items"))
        if items:
            location = select_location(record, "drop_off_location", use_canonical, alias_lookup) or select_location(
                record, "rescue_location", use_canonical, alias_lookup
            )
            sections = [{"location": location, "items": items}]
        else:
            sections = []

    flat_items: List[Dict[str, Any]] = []
    for section in sections:
        flat_items.extend(section.get("items") or [])

    direction = string_or_none(record.get("direction"))
    rescue_location = select_location(record, "rescue_location", use_canonical, alias_lookup)
    drop_off_location = select_location(record, "drop_off_location", use_canonical, alias_lookup)

    target = {
        "direction": direction,
        "rescue_location": rescue_location,
        "drop_off_location": drop_off_location,
        "sections": sections,
        "items": flat_items,
    }

    prompt = prompt_template.format(input_text=input_text.strip())
    row_id = record.get("id") or record.get("message_key") or record.get("slack_ts")
    created_at = record.get("audited_at") or record.get("start_ts") or record.get("end_ts")

    return {
        "id": row_id,
        "created_at": created_at,
        "input_text": input_text,
        "prompt": prompt,
        "response": json.dumps(target, ensure_ascii=False),
        "target": target,
        "meta": {
            "source": "slack_audited",
            "audited_at": record.get("audited_at"),
            "record_id": record.get("id"),
        },
    }


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    alias_path = Path(args.aliases) if args.aliases else None

    if "{input_text}" not in args.prompt_template:
        raise SystemExit("Prompt template must include {input_text} placeholder.")

    if not input_path.exists():
        raise SystemExit(f"Missing input file: {input_path}")

    exported = 0
    skipped_empty = 0
    skipped_text = 0
    rows: List[str] = []

    use_canonical = not args.no_canonical
    alias_lookup: Dict[str, str] = {}
    if alias_path:
        alias_lookup = load_location_aliases(alias_path)

    for record in iter_records(input_path):
        row = build_row(
            record,
            args.prompt_template,
            use_canonical=use_canonical,
            alias_lookup=alias_lookup,
        )
        if not row:
            skipped_text += 1
            continue
        has_items = bool(row["items"])
        if not has_items and not args.include_empty:
            skipped_empty += 1
            continue
        rows.append(json.dumps(row, ensure_ascii=False))
        exported += 1
        if args.max_records and exported >= args.max_records:
            break

    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = "\n".join(rows)
    output_path.write_text(f"{payload}\n" if payload else "", encoding="utf-8")

    print(
        f"Exported {exported} rows to {output_path} "
        f"(skipped {skipped_empty} empty, {skipped_text} without text)"
    )


if __name__ == "__main__":
    main()
