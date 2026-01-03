# Warehouse PEFT pipeline

Orthogonal pipeline to export labeled warehouse logs from Supabase and fine-tune an open-source model with LoRA/PEFT for tabular extraction. It does not modify the running server.

## 1) Export a JSONL dataset
Requires Supabase service access (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY`). `.env.local` is loaded automatically.

```bash
node training/peft/export_warehouse_logs.js \
  --limit 1500 \
  --since 2024-01-01 \
  --output training/peft/data/warehouse_logs.jsonl
```

Each JSONL row:
```json
{
  "id": "uuid",
  "created_at": "2024-11-18T18:02:00.000Z",
  "input_text": "Earlier today from 1440 Kostner Aldi: • 3 boxes apples …",
  "prompt": "You are a warehouse intake extractor…\nMessage:\n…\n\nJSON:",
  "response": "{ \"location\": \"1440 Kostner Aldi\", \"items\": [ { \"item_name\": \"apples\", \"quantity\": 3, \"unit\": \"box\", \"pounds\": null, \"notes\": null, \"sources\": [\"text\"], \"confidence\": null } ] }",
  "target": {
    "location": "1440 Kostner Aldi",
    "items": [
      { "item_name": "apples", "quantity": 3, "unit": "box", "pounds": null, "notes": null, "sources": ["text"], "confidence": null }
    ]
  }
}
```

Flags: `--limit` (default 1000), `--since YYYY-MM-DD`, `--output <path>`, `--include-empty` to keep rows with no parsed items.

## 2) Train on a rented GPU (Lambda Labs or similar)
1. Copy this folder and the exported dataset to the GPU box (e.g. `rsync -av training/peft <host>:/home/ubuntu/mutualaid/`).
2. Create a venv and install dependencies:
   ```bash
   python -m venv .venv && source .venv/bin/activate
   # Pick the right torch wheel:
   # - Linux GPU (CUDA 12.1): pip install torch==2.4.1+cu121 -f https://download.pytorch.org/whl/cu121
   # - CPU / macOS:          pip install torch==2.4.1 --index-url https://download.pytorch.org/whl/cpu
   pip install -r training/peft/requirements.txt
   ```
   Notes:
   - `bitsandbytes` (for `--use-4bit/--use-8bit`) only installs on Linux GPU; it is skipped on macOS.
   - On CPU/mac, skip `--use-4bit/--use-8bit` and expect slow training.
   - `numpy` is included in requirements for torch; if pip aborts mid-way, rerun the install after fixing torch.
3. Run training (adjust model to any HF model you have access to, e.g. a Llama/Mistral derivative):
   ```bash
   python training/peft/train.py \
     --dataset training/peft/data/warehouse_logs.jsonl \
     --model-id meta-llama/Llama-3.2-1B-Instruct \
     --output-dir training/peft/checkpoints/warehouse-lora \
     --use-4bit \
     --batch-size 2 \
     --gradient-accumulation 8 \
     --num-epochs 2
   ```
   Environment variables: `HF_TOKEN` (if the base model is gated), `WANDB_PROJECT` if you enable Weights & Biases logging via `--wandb`.

Outputs: the LoRA adapter lives in `--output-dir`; the base model remains unchanged. You can merge the adapter later or load it on top of the base model for inference.

## 3) Inference with the adapter
```python
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

base = "meta-llama/Llama-3.2-1B-Instruct"
adapter = "training/peft/checkpoints/warehouse-lora"
tokenizer = AutoTokenizer.from_pretrained(base)
model = AutoModelForCausalLM.from_pretrained(base, torch_dtype="auto", device_map="auto")
model = PeftModel.from_pretrained(model, adapter)

prompt = "You are a warehouse intake extractor...\nMessage:\n<message>\n\nJSON:"
inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
out = model.generate(**inputs, max_new_tokens=256)
print(tokenizer.decode(out[0], skip_special_tokens=True))
```

Notes:
- Uses JSON as the tabular target (location, items[].item_name/quantity/unit/pounds/notes/sources/confidence).
- Training script accepts `--prompt-template` to tweak the instruction without touching the dataset.
- Everything lives under `training/peft`, so existing server and client workflows stay untouched.

## Slack audited stats training dataset (XLSX workflow)
Use the Slack regex browser + audit log to build a PEFT dataset from audited Slack messages.

1. Parse the XLSX and audit records (audited entries are saved to `training/peft/data/slack_messages_audited.jsonl`):
   ```bash
   python training/peft/extract_slack_regex.py
   uvicorn training.peft.slack_api:app --reload --port 5055
   ```
2. Export the audited dataset for training:
   ```bash
   python training/peft/export_slack_audited.py \
     --input training/peft/data/slack_messages_audited.jsonl \
     --output training/peft/data/slack_audited_training.jsonl
   ```
   The exporter uses `training/peft/data/location_aliases.json` to canonicalize locations. Add `--aliases <path>` to override.
   Add `--include-empty` if you want to keep audited records without items.
3. Train with the existing PEFT script:
   ```bash
   python training/peft/train.py \
     --dataset training/peft/data/slack_audited_training.jsonl \
     --model-id meta-llama/Llama-3.2-1B-Instruct \
     --output-dir training/peft/checkpoints/slack-audited-lora \
     --use-4bit \
     --batch-size 2 \
     --gradient-accumulation 8 \
     --num-epochs 2
   ```
