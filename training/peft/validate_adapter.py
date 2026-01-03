#!/usr/bin/env python3
"""
Validate a trained LoRA adapter by running inference on sample messages.

Usage:
    python training/peft/validate_adapter.py --version v1
    python training/peft/validate_adapter.py --version v1 --samples samples.jsonl
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict, Any

try:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer
except ImportError as e:
    print(f"Error: Missing required package: {e}")
    print("Please install requirements: pip install -r requirements.txt")
    sys.exit(1)


DEFAULT_SAMPLES = [
    "Picked up 5 cases bananas and 3 boxes lettuce from Aldi Wicker Park",
    "NA4J took 2 crates milk to Love Fridge",
    "SWC picked up 10 lbs apples, 8 boxes frozen chicken, and 6 cases bread from Mariano's",
]


def load_model_and_tokenizer(adapter_path: Path):
    """Load base model with LoRA adapter."""
    print(f"Loading model from {adapter_path}...")

    base_model_id = "meta-llama/Llama-3.2-1B-Instruct"

    try:
        # Load tokenizer
        tokenizer = AutoTokenizer.from_pretrained(base_model_id)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        # Load base model
        model = AutoModelForCausalLM.from_pretrained(
            base_model_id,
            torch_dtype=torch.bfloat16,
            device_map="auto",
            low_cpu_mem_usage=True,
        )

        # Load adapter
        model = PeftModel.from_pretrained(model, str(adapter_path))

        print("✓ Model and adapter loaded successfully")
        return model, tokenizer

    except Exception as e:
        print(f"✗ Failed to load model: {e}")
        raise


def build_prompt(message_text: str) -> str:
    """Build prompt for extraction task."""
    return (
        "You are a Slack warehouse log extractor. Return JSON only with fields:\n"
        "- direction (string|null) [inbound, outbound, both, unknown]\n"
        "- rescue_location (string|null)\n"
        "- drop_off_location (string|null)\n"
        "- sections (array of { location, items })\n"
        "- items (array of rows with name, quantity, unit, estimated_lbs, subcategory)\n\n"
        f"Message:\n{message_text}\n\n"
        "JSON:"
    )


def run_inference(model, tokenizer, message: str) -> str:
    """Run inference on a single message."""
    prompt = build_prompt(message)

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=512,
            temperature=0.1,
            do_sample=True,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )

    # Decode and extract JSON (everything after the prompt)
    full_output = tokenizer.decode(outputs[0], skip_special_tokens=True)
    if "JSON:" in full_output:
        json_output = full_output.split("JSON:")[-1].strip()
    else:
        json_output = full_output[len(prompt):].strip()

    return json_output


def validate_json_output(output: str) -> tuple[bool, Dict[str, Any] | None, str]:
    """Validate that output is valid JSON with expected fields."""
    try:
        data = json.loads(output)

        # Check for expected fields
        expected_fields = ["direction", "rescue_location", "drop_off_location", "items"]
        missing_fields = [f for f in expected_fields if f not in data]

        if missing_fields:
            return False, data, f"Missing fields: {missing_fields}"

        # Validate items structure
        if not isinstance(data.get("items"), list):
            return False, data, "items must be an array"

        for item in data.get("items", []):
            if not isinstance(item, dict):
                return False, data, "Each item must be an object"
            if "name" not in item:
                return False, data, "Each item must have a 'name' field"

        return True, data, "Valid"

    except json.JSONDecodeError as e:
        return False, None, f"Invalid JSON: {e}"


def main():
    parser = argparse.ArgumentParser(description="Validate trained LoRA adapter")
    parser.add_argument(
        "--version",
        required=True,
        help="Model version identifier (e.g., v1, 20260101-143000)",
    )
    parser.add_argument(
        "--samples",
        default=None,
        help="Optional JSONL file with sample messages (uses defaults if not provided)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print full inference outputs",
    )
    args = parser.parse_args()

    # Find adapter path
    base_dir = Path(__file__).resolve().parent
    adapter_path = base_dir / "checkpoints" / f"slack-lora-{args.version}"

    if not adapter_path.exists():
        print(f"Error: Adapter not found at {adapter_path}")
        print(f"Expected path: {adapter_path}")
        return False

    # Check for required files
    adapter_config = adapter_path / "adapter_config.json"
    if not adapter_config.exists():
        print(f"Error: adapter_config.json not found in {adapter_path}")
        return False

    # Load sample messages
    if args.samples:
        samples_path = Path(args.samples)
        if not samples_path.exists():
            print(f"Error: Samples file not found: {samples_path}")
            return False
        with open(samples_path) as f:
            samples = [json.loads(line)["input_text"] for line in f if line.strip()]
    else:
        samples = DEFAULT_SAMPLES

    print(f"\n=== Validating Adapter: {args.version} ===\n")

    # Load model
    try:
        model, tokenizer = load_model_and_tokenizer(adapter_path)
    except Exception:
        return False

    # Run inference on samples
    print(f"\nRunning inference on {len(samples)} sample messages...\n")

    all_valid = True
    for idx, message in enumerate(samples, 1):
        print(f"Sample {idx}: {message[:80]}{'...' if len(message) > 80 else ''}")

        try:
            output = run_inference(model, tokenizer, message)

            if args.verbose:
                print(f"  Output: {output}")

            is_valid, data, msg = validate_json_output(output)

            if is_valid:
                print(f"  ✓ Valid JSON with {len(data.get('items', []))} items extracted")
                if data.get("rescue_location"):
                    print(f"    Location: {data['rescue_location']}")
            else:
                print(f"  ✗ Validation failed: {msg}")
                if args.verbose and data:
                    print(f"    Parsed data: {json.dumps(data, indent=2)}")
                all_valid = False

        except Exception as e:
            print(f"  ✗ Inference failed: {e}")
            all_valid = False

        print()

    # Summary
    print("=" * 50)
    if all_valid:
        print("✓ All samples validated successfully!")
        print(f"\nAdapter is ready to use:")
        print(f"  Path: {adapter_path}")
        print(f"\nTo use in inference:")
        print(f"  python training/peft/infer.py --version {args.version}")
        return True
    else:
        print("✗ Some samples failed validation")
        print("\nThe adapter may need retraining or the model needs adjustment.")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
