# Lambda Labs Setup Guide

This guide walks through setting up Lambda Labs for automated GPU training.

## Overview

Lambda Labs provides on-demand GPU instances perfect for training ML models. Our automated training pipeline provisions instances, trains your model, and cleans up automatically.

**Benefits:**
- Pay-per-second billing (~$0.50/hr for RTX 6000)
- No upfront commitment
- Automatic provisioning and cleanup
- Training completes in 15-30 minutes

## Step 1: Create Lambda Labs Account

1. Go to https://cloud.lambdalabs.com
2. Click "Sign Up" and create an account
3. Verify your email address
4. Add a payment method (credit card required)

**Note:** Lambda Labs may require identity verification for new accounts.

## Step 2: Add Credits

1. Log in to Lambda Labs dashboard
2. Go to "Billing" or "Credits"
3. Add at least $5-10 to start
   - First training run costs ~$0.25-0.50
   - Credits don't expire

## Step 3: Generate API Key

1. Navigate to **API Keys** section:
   - URL: https://cloud.lambdalabs.com/api-keys
   - Or: Dashboard → Settings → API Keys

2. Click **"Generate API Key"**

3. **Copy the key immediately** - you won't be able to see it again!

4. Store it securely:
   ```bash
   # Add to your shell config (~/.bashrc or ~/.zshrc)
   export LAMBDA_LABS_API_KEY='your_api_key_here'

   # Or create a .env file (don't commit to git!)
   echo 'LAMBDA_LABS_API_KEY=your_api_key_here' >> ~/.env
   ```

5. Reload your shell:
   ```bash
   source ~/.bashrc  # or source ~/.zshrc
   ```

6. Verify it's set:
   ```bash
   echo $LAMBDA_LABS_API_KEY
   ```

## Step 4: Configure SSH Keys

Lambda Labs requires SSH keys for instance access.

### Option A: Use Existing SSH Key

If you already have `~/.ssh/id_rsa.pub`:

1. Go to https://cloud.lambdalabs.com/ssh-keys
2. Click **"Add SSH Key"**
3. Paste the contents of your public key:
   ```bash
   cat ~/.ssh/id_rsa.pub
   ```
4. Give it a name (e.g., "My Laptop")
5. Click "Add"

### Option B: Generate New SSH Key

```bash
# Generate new key pair
ssh-keygen -t ed25519 -f ~/.ssh/lambda_training -C "lambda-training"

# Press Enter to accept defaults (no passphrase recommended for automation)

# Display the public key
cat ~/.ssh/lambda_training.pub
```

Then add it to Lambda Labs dashboard (see Option A, step 1-5).

### Configure the Training Script

If using a non-default key path:

```bash
export SSH_PRIVATE_KEY=~/.ssh/lambda_training
```

## Step 5: Test Your Setup

Verify everything works before running a real training job:

```bash
cd training/peft

# Dry run (doesn't actually provision GPU or charge you)
python lambda_train.py --version test --dry-run
```

You should see:
```
DRY RUN: Would provision instance
DRY RUN: Would wait for SSH
DRY RUN: Would upload code and data
DRY RUN: Would run training remotely
DRY RUN: Would download adapter
DRY RUN: Would terminate instance
```

## Step 6: Run Your First Training

Once dry-run succeeds:

```bash
# Generate training data from audited messages
./generate_training_data.sh

# Run full training pipeline
./train_on_gpu.sh v1
```

Watch the output for:
- ✅ Instance provisioning
- ✅ SSH connection established
- ✅ Code upload
- ✅ Training progress
- ✅ Adapter download
- ✅ Instance termination

## Understanding Costs

### Instance Pricing (as of 2026)

| GPU Type | VRAM | Cost/Hour | Training Time | Total Cost |
|----------|------|-----------|---------------|------------|
| RTX 6000 | 24GB | ~$0.50 | 15-30 min | $0.13-$0.25 |
| A10 | 24GB | ~$0.60 | 15-30 min | $0.15-$0.30 |
| A6000 | 48GB | ~$0.80 | 15-30 min | $0.20-$0.40 |

**Our script automatically selects the cheapest available GPU.**

### What You're Charged For

✅ **Instance runtime:** Charged per second
✅ **Storage:** Minimal (few GB for duration of training)
✅ **Network:** Egress for downloading adapter (~100MB)

❌ **Not charged for:**
- Provisioning time (until instance is "active")
- Failed launches
- Dry-runs

### Cost Optimization Tips

1. **Train during off-peak:** Instances more available, potentially cheaper
2. **Batch audits:** Accumulate 20-30 audits before retraining
3. **Monitor runs:** Check logs to optimize hyperparameters (fewer epochs = faster training)
4. **Use dry-run:** Test changes without spending money

## Troubleshooting

### "No GPU instances available"

**Problem:** All preferred instance types are at capacity.

**Solutions:**
1. Wait 10-30 minutes and retry
2. Edit `lambda_train.py` to add more instance types to `preferred_types`
3. Try during off-peak hours (weekends, late night)

### "API key invalid" error

**Problem:** API key not set correctly or expired.

**Solutions:**
```bash
# Check if it's set
echo $LAMBDA_LABS_API_KEY

# Regenerate key on Lambda Labs dashboard if expired
# Update environment variable with new key
export LAMBDA_LABS_API_KEY='new_key_here'
```

### SSH connection fails

**Problem:** SSH key not recognized or network issues.

**Causes:**
- SSH key not added to Lambda Labs dashboard
- Wrong private key path
- Firewall blocking SSH

**Solutions:**
1. Verify SSH key is added: https://cloud.lambdalabs.com/ssh-keys
2. Check key path:
   ```bash
   ls -la ~/.ssh/id_rsa
   # or
   ls -la ~/.ssh/lambda_training
   ```
3. Set correct path:
   ```bash
   export SSH_PRIVATE_KEY=~/.ssh/your_key_name
   ```
4. Test SSH manually (get IP from Lambda dashboard):
   ```bash
   ssh -i ~/.ssh/id_rsa ubuntu@instance-ip
   ```

### Training times out

**Problem:** Training takes >2 hours (our safety limit).

**Causes:**
- Too much training data
- Too many epochs
- Slow instance

**Solutions:**
1. Check training logs: `training/peft/logs/{version}/training_output.log`
2. Reduce epochs in `train_on_gpu.sh` (default: 3)
3. Reduce dataset size temporarily
4. Increase timeout in `lambda_train.py` (line ~180)

### Instance doesn't terminate

**Problem:** Training completes but instance still running.

**Solutions:**
1. Check Lambda Labs dashboard: https://cloud.lambdalabs.com/instances
2. Manually terminate instance to stop charges
3. Check cleanup logs at `training/peft/logs/{version}/training.log`

**Prevention:** The script has error handling, but if it crashes, instance may remain. Always check dashboard after runs.

## Security Best Practices

### API Key Security

✅ **DO:**
- Store in environment variables or secure vaults
- Add to `.gitignore` if storing in files
- Rotate keys periodically

❌ **DON'T:**
- Commit keys to git
- Share keys in Slack or email
- Use the same key across multiple projects

### SSH Key Security

✅ **DO:**
- Use different keys for different purposes
- Set file permissions: `chmod 600 ~/.ssh/lambda_training`
- Use passphrase for highly sensitive work

❌ **DON'T:**
- Share private keys
- Commit private keys to git
- Use the same key for production servers

## Advanced Configuration

### Custom Instance Selection

Edit `lambda_train.py`, line ~65:

```python
preferred_types = [
    "gpu_1x_rtx6000",  # Cheapest
    "gpu_1x_a10",
    "gpu_1x_a6000",
    "gpu_2x_a6000",    # Add more powerful options
]
```

### Custom Training Parameters

Edit `lambda_train.py`, line ~230:

```python
python train.py \
  --dataset data/slack_audited_training.jsonl \
  --model-id meta-llama/Llama-3.2-1B-Instruct \
  --output-dir checkpoints/slack-lora-{version} \
  --use-4bit \
  --batch-size 2 \            # Increase for faster training (needs more VRAM)
  --gradient-accumulation 8 \  # Decrease to use less memory
  --num-epochs 3 \             # More epochs = better fit (but longer)
  --learning-rate 2e-4 \
  --max-length 1024
```

### Alternative: Local GPU Training

If you have a local GPU:

```bash
cd training/peft

# Generate training data
./generate_training_data.sh

# Run training locally
python train.py \
  --dataset data/slack_audited_training.jsonl \
  --model-id meta-llama/Llama-3.2-1B-Instruct \
  --output-dir checkpoints/slack-lora-v1 \
  --use-4bit \
  --num-epochs 3

# Validate
python validate_adapter.py --version v1
```

## Monitoring and Logs

### Real-time Monitoring

While training runs, check:

```bash
# Main pipeline log
tail -f training/peft/logs/{version}/training.log

# Training output from GPU
tail -f training/peft/logs/{version}/training_output.log
```

### Post-Training Analysis

```bash
# View metadata
cat training/peft/logs/{version}/metadata.json

# Check final model registry
cat training/peft/model_registry.json
```

### Dashboard Monitoring

Lambda Labs dashboard shows:
- Instance status and uptime
- GPU utilization
- Network traffic
- Current charges

## FAQ

**Q: Do I need a Lambda Labs account if I have my own GPU?**
A: No! You can run `train.py` directly on any machine with a GPU. Lambda Labs is just for convenience.

**Q: What if I run out of credits mid-training?**
A: Instance terminates immediately. Partially trained model is lost. Always maintain buffer credits.

**Q: Can I SSH into the instance to debug?**
A: Yes, but only while it's running. Get the IP from Lambda dashboard and use your SSH key.

**Q: How do I change which model to train (e.g., use 3B instead of 1B)?**
A: Edit the `--model-id` parameter in `train.py` or `lambda_train.py`. Note: Larger models cost more and train slower.

**Q: Can I run multiple training jobs in parallel?**
A: Yes, but each provisions a separate instance. Be mindful of costs.

## Next Steps

- Read [USER_GUIDE.md](./USER_GUIDE.md) for complete workflow
- Review [README.md](./README.md) for technical details
- Check your first trained model with `python manage_models.py list`

## Support Resources

- Lambda Labs Documentation: https://docs.lambdalabs.com
- Lambda Labs Support: support@lambdalabs.com
- Instance Status Page: https://lambdalabs.com/service/gpu-cloud/status
- Pricing: https://lambdalabs.com/service/gpu-cloud#pricing
