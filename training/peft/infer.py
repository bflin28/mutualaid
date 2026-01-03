#!/usr/bin/env python3
"""
Run PEFT model inference on Slack messages.

Usage:
    python training/peft/infer.py --message "Picked up 5 cases bananas from Aldi"
    python training/peft/infer.py --input-file messages.jsonl --output predictions.jsonl
    python training/peft/infer.py --version v2 --message "..."
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional

try:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
except ImportError as e:
    print(f"Error: Missing required package: {e}")
    print("Please install requirements: pip install -r requirements.txt")
    sys.exit(1)

from manage_models import ModelRegistry


class SlackMessageInferencer:
    """PEFT model inference engine for Slack warehouse messages."""

    def __init__(self, adapter_path: Path, use_quantization: bool = True, device: Optional[str] = None):
        self.adapter_path = adapter_path
        self.use_quantization = use_quantization
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.base_model_id = "meta-llama/Llama-3.2-1B-Instruct"

        self.model = None
        self.tokenizer = None

        print(f"Initializing inferencer with adapter: {adapter_path}")
        print(f"Device: {self.device}, Quantization: {use_quantization}")

    def load_model(self) -> None:
        """Load base model + LoRA adapter with optional quantization."""
        if self.model is not None:
            print("Model already loaded")
            return

        print(f"Loading base model: {self.base_model_id}...")

        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(self.base_model_id)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # Quantization config for CPU inference
        quantization_config = None
        if self.use_quantization and self.device == "cpu":
            try:
                quantization_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.bfloat16,
                    bnb_4bit_use_double_quant=True,
                    bnb_4bit_quant_type="nf4",
                )
            except Exception as e:
                print(f"Warning: Could not enable quantization: {e}")
                print("Falling back to full precision (will use more memory)")
                quantization_config = None

        # Load base model
        self.model = AutoModelForCausalLM.from_pretrained(
            self.base_model_id,
            quantization_config=quantization_config,
            torch_dtype=torch.bfloat16 if quantization_config is None else None,
            device_map="auto",
            low_cpu_mem_usage=True,
        )

        # Load LoRA adapter
        print(f"Loading adapter from: {self.adapter_path}...")
        self.model = PeftModel.from_pretrained(self.model, str(self.adapter_path))

        print("✓ Model and adapter loaded successfully")

    def build_prompt(self, message_text: str) -> str:
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

    def infer_single(self, message_text: str, max_tokens: int = 512) -> Dict[str, Any]:
        """Run inference on a single message."""
        if self.model is None:
            self.load_model()

        prompt = self.build_prompt(message_text)

        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                temperature=0.1,
                do_sample=True,
                pad_token_id=self.tokenizer.pad_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
            )

        # Decode output
        full_output = self.tokenizer.decode(outputs[0], skip_special_tokens=True)

        # Extract JSON (everything after "JSON:")
        if "JSON:" in full_output:
            json_str = full_output.split("JSON:")[-1].strip()
        else:
            json_str = full_output[len(prompt):].strip()

        # Parse JSON
        try:
            result = json.loads(json_str)
            result["_raw_output"] = json_str
            result["_valid_json"] = True
        except json.JSONDecodeError as e:
            result = {
                "_raw_output": json_str,
                "_valid_json": False,
                "_error": str(e),
                "direction": None,
                "rescue_location": None,
                "drop_off_location": None,
                "items": [],
            }

        return result

    def infer_batch(self, messages: List[str], batch_size: int = 4) -> List[Dict[str, Any]]:
        """Run inference on multiple messages with batching."""
        if self.model is None:
            self.load_model()

        results = []
        for i in range(0, len(messages), batch_size):
            batch = messages[i:i + batch_size]
            print(f"Processing batch {i // batch_size + 1} ({len(batch)} messages)...")

            for message in batch:
                result = self.infer_single(message)
                results.append(result)

        return results

    def compare_with_regex(self, model_result: Dict, regex_result: Dict) -> Dict[str, Any]:
        """Compare model output with regex extraction."""
        comparison = {
            "direction_match": model_result.get("direction") == regex_result.get("direction"),
            "rescue_location_match": model_result.get("rescue_location") == regex_result.get("rescue_location"),
            "drop_off_location_match": model_result.get("drop_off_location") == regex_result.get("drop_off_location"),
            "item_count_diff": len(model_result.get("items", [])) - len(regex_result.get("items", [])),
        }

        # Compare item names
        model_items = {item.get("name", "").lower() for item in model_result.get("items", [])}
        regex_items = {item.get("name", "").lower() for item in regex_result.get("items", [])}

        comparison["items_only_in_model"] = list(model_items - regex_items)
        comparison["items_only_in_regex"] = list(regex_items - model_items)
        comparison["items_in_both"] = list(model_items & regex_items)

        # Overall match score
        matches = sum([
            comparison["direction_match"],
            comparison["rescue_location_match"],
            comparison["drop_off_location_match"],
            abs(comparison["item_count_diff"]) == 0,
        ])
        comparison["match_score"] = matches / 4.0

        return comparison


def main():
    parser = argparse.ArgumentParser(description="Run PEFT inference on Slack messages")
    parser.add_argument(
        "--version",
        default="active",
        help="Model version to use (default: active)",
    )
    parser.add_argument(
        "--message",
        help="Single message to process",
    )
    parser.add_argument(
        "--input-file",
        help="JSONL file with messages (expects 'input_text' or 'raw_messages' field)",
    )
    parser.add_argument(
        "--output",
        help="Output file for predictions (JSONL)",
    )
    parser.add_argument(
        "--no-quantization",
        action="store_true",
        help="Disable 4-bit quantization (uses more memory)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="Batch size for processing multiple messages",
    )
    args = parser.parse_args()

    # Load model registry
    registry = ModelRegistry()
    adapter_path = registry.get_adapter_path(args.version)

    if not adapter_path:
        if args.version == "active":
            print("Error: No active model set", file=sys.stderr)
            print("Available models:", file=sys.stderr)
            for model in registry.list_models():
                print(f"  - {model.get('version')}", file=sys.stderr)
        else:
            print(f"Error: Model version '{args.version}' not found or adapter missing", file=sys.stderr)
        return 1

    # Initialize inferencer
    inferencer = SlackMessageInferencer(
        adapter_path=adapter_path,
        use_quantization=not args.no_quantization,
    )

    # Process single message
    if args.message:
        print(f"\nInput message:\n{args.message}\n")
        result = inferencer.infer_single(args.message)

        print("Model prediction:")
        print(json.dumps(result, indent=2))
        return 0

    # Process input file
    if args.input_file:
        input_path = Path(args.input_file)
        if not input_path.exists():
            print(f"Error: Input file not found: {input_path}", file=sys.stderr)
            return 1

        # Load messages
        messages = []
        with open(input_path) as f:
            for line in f:
                if not line.strip():
                    continue
                record = json.loads(line)
                if "input_text" in record:
                    messages.append(record["input_text"])
                elif "raw_messages" in record:
                    raw = record["raw_messages"]
                    if isinstance(raw, list):
                        messages.append("\n".join(raw))
                    else:
                        messages.append(str(raw))
                else:
                    print(f"Warning: Record missing input_text or raw_messages: {record.get('id')}", file=sys.stderr)

        print(f"Processing {len(messages)} messages from {input_path}...")

        # Run inference
        results = inferencer.infer_batch(messages, batch_size=args.batch_size)

        # Save results
        if args.output:
            output_path = Path(args.output)
            with open(output_path, "w") as f:
                for result in results:
                    f.write(json.dumps(result, ensure_ascii=False) + "\n")
            print(f"\n✓ Predictions saved to: {output_path}")
        else:
            for idx, result in enumerate(results, 1):
                print(f"\n=== Message {idx} ===")
                print(json.dumps(result, indent=2))

        return 0

    # No input provided
    print("Error: Provide either --message or --input-file", file=sys.stderr)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
