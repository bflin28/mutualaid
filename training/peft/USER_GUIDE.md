# PEFT Training Pipeline - User Guide

This guide explains how to use the PEFT (Parameter-Efficient Fine-Tuning) training pipeline to improve Slack message extraction using machine learning.

## Overview

The pipeline lets you:
1. **Audit** Slack messages to create training data
2. **Train** a custom ML model on Lambda Labs GPU with one command
3. **Use** the trained model to extract data from new messages
4. **Compare** model predictions with regex-based extraction
5. **Iterate** by auditing more messages and retraining

## Quick Start

### Prerequisites

- Python 3.12+ with virtual environment
- Lambda Labs account with API key
- Node.js for running the frontend

### Setup

1. **Install Python dependencies:**
   ```bash
   cd training/peft
   pip install -r requirements.txt
   ```

2. **Set Lambda Labs API key:**
   ```bash
   export LAMBDA_LABS_API_KEY='your_api_key_here'
   ```
   Get your API key from: https://cloud.lambdalabs.com/api-keys

3. **Start the Slack browser backend:**
   ```bash
   uvicorn training.peft.slack_api:app --reload --port 5055
   ```

4. **Start the React frontend:**
   ```bash
   npm run dev
   ```

## Workflow

### Step 1: Audit Slack Messages

1. Open the app in your browser
2. Navigate to the **Slack browser** tab
3. Review regex-parsed messages one by one
4. For accurate extractions, click **"Mark audited"**
5. For inaccurate ones, skip or fix the data first (editing not yet implemented)
6. **Goal:** Audit at least 10 messages before first training

**Tip:** Use the "Unaudited only" filter to work through the backlog efficiently.

### Step 2: Train Your Model

Once you have 10+ audited messages:

```bash
cd training/peft
./train_on_gpu.sh v1
```

This single command will:
- ✅ Generate training data from audited messages
- ✅ Provision a Lambda Labs GPU instance (~$0.50/hr)
- ✅ Upload code and data to the instance
- ✅ Train Llama 3.2 1B model with LoRA (~15-30 minutes)
- ✅ Download the trained adapter to your machine
- ✅ Clean up the GPU instance automatically

**Cost:** ~$0.25-0.50 per training run

**Output:**
- Trained adapter: `training/peft/checkpoints/slack-lora-v1/`
- Logs: `training/peft/logs/v1/`

### Step 3: Use the Trained Model

1. **Reload the Slack browser page** (the backend will detect the new model)
2. You'll now see **Extraction method** options:
   - **Regex parser** - Original regex-based extraction
   - **PEFT model** - Your trained model's predictions
   - **Compare both** - Side-by-side comparison

3. Switch to "PEFT model" or "Compare both" to see predictions

**Note:** Model inference runs on CPU and takes 2-5 seconds per message.

### Step 4: Iterate

1. Continue auditing more messages (especially where the model fails)
2. When you have enough new audits, retrain:
   ```bash
   ./train_on_gpu.sh v2
   ```
3. The new model replaces the old one automatically
4. Compare performance improvements

## Commands Reference

### Training

```bash
# Train with auto-generated version name
./train_on_gpu.sh

# Train with specific version
./train_on_gpu.sh v1

# Generate training data only (no GPU training)
./generate_training_data.sh
```

### Model Management

```bash
# List all trained models
python manage_models.py list

# Show details for a specific model
python manage_models.py info v1

# Switch active model version
python manage_models.py set-active v2

# Remove model from registry (files remain)
python manage_models.py delete v1
```

### Inference

```bash
# Run inference on a single message
python infer.py --message "Picked up 5 cases bananas from Aldi"

# Run inference on a batch of messages
python infer.py --input-file messages.jsonl --output predictions.jsonl

# Use specific model version
python infer.py --version v2 --message "..."
```

### Validation

```bash
# Validate a trained adapter
python validate_adapter.py --version v1

# Validate with custom sample messages
python validate_adapter.py --version v1 --samples test_messages.jsonl
```

## Understanding the UI

### Slack Browser Tab

- **Message counter:** Shows current position (e.g., "Message 5 / 234")
- **Audit filter:**
  - "Unaudited only" - Work through pending messages
  - "All messages" - Browse everything
  - "Audited only" - Review confirmed extractions
- **Extraction method** (appears when model is trained):
  - Choose how to extract data from current message
  - Switch modes to compare regex vs model

### Audited Stats Tab

- **Summary blocks:** Total audited, items count, total pounds
- **By Location:** Pounds rescued per location
- **By Subcategory:** Pounds per food category
- **Training readiness:** Shows if you have enough data (10+ messages)

## Troubleshooting

### "No active model" error

**Problem:** Extraction method selector shows but inference fails.

**Solution:**
```bash
python manage_models.py list
python manage_models.py set-active v1
```

### Training fails with "LAMBDA_LABS_API_KEY not set"

**Problem:** Environment variable not configured.

**Solution:**
```bash
export LAMBDA_LABS_API_KEY='your_key_here'
# Add to ~/.bashrc or ~/.zshrc for persistence
```

### Model inference is very slow

**Expected:** 2-5 seconds per message on M1/M2 Mac with 4-bit quantization.

**To speed up:**
- Pre-compute predictions as background job (feature not yet implemented)
- Use smaller model variant (requires code changes)
- Deploy inference service on GPU (advanced)

### Training hangs or times out

**Problem:** SSH connection issues or GPU instance not accessible.

**Solutions:**
1. Check SSH key configuration
2. Verify Lambda Labs account has credits
3. Check firewall/network settings
4. View logs at `training/peft/logs/{version}/training.log`

### "Not enough audited records" message

**Problem:** Trying to train with fewer than 10 audited messages.

**Solution:** Audit more messages first. While you can train with fewer, 10+ is recommended for basic quality.

## Best Practices

### Auditing Strategy

1. **Start with clear examples:** Audit messages with obvious, clean extractions first
2. **Cover diverse patterns:** Include messages with different formats, locations, and item types
3. **Mark accurate ones:** Only audit correct extractions - this teaches the model
4. **Quantity matters:** More audited data = better model performance

### Training Strategy

1. **Initial training:** Wait until 10-20 audited messages
2. **Regular retraining:** Retrain every 20-30 new audits
3. **Version naming:** Use descriptive versions like `baseline`, `v2-morelocations`, etc.
4. **Track progress:** Compare accuracy across versions using the compare mode

### Cost Management

- Training cost: ~$0.25-0.50 per run (15-30 min on RTX 6000)
- Lambda Labs charges by the second
- Instance auto-terminates after training
- Check `training/peft/logs/{version}/metadata.json` for exact runtime

## FAQ

**Q: Can I edit extracted data before auditing?**
A: Not yet - editing UI is not implemented. Only audit messages that are already correct.

**Q: What happens to old model versions?**
A: They remain in `checkpoints/slack-lora-{version}/`. Use `manage_models.py` to switch between them or delete old ones.

**Q: Can I use my own GPU instead of Lambda Labs?**
A: Yes! The training script `train.py` works on any machine with a GPU. Just skip `lambda_train.py` and run it directly.

**Q: How do I know if the model is better than regex?**
A: Use "Compare both" mode to see differences. Track metrics in `model_registry.json`.

**Q: Can I train on CPU?**
A: Not recommended. Training would take hours. Use Lambda Labs for $0.50 per run.

## Next Steps

- Read [LAMBDA_SETUP.md](./LAMBDA_SETUP.md) for detailed Lambda Labs configuration
- See [README.md](./README.md) for technical details about the training script
- Check the plan file at `~/.claude/plans/` for implementation details

## Support

For issues or questions:
1. Check logs at `training/peft/logs/{version}/`
2. Validate your setup with `python validate_adapter.py`
3. Review the plan document for architecture details
