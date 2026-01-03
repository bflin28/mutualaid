#!/bin/bash
# One-command training pipeline: Generate data → Train on GPU → Validate
# Usage: ./train_on_gpu.sh [version_name]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Generate version name (default to timestamp)
VERSION=${1:-$(date +%Y%m%d-%H%M%S)}

echo "============================================"
echo "  PEFT Training Pipeline v${VERSION}"
echo "============================================"
echo

# Step 1: Generate training data
echo "[1/3] Generating training data from audited messages..."
./generate_training_data.sh
echo

# Step 2: Train on Lambda Labs GPU
echo "[2/3] Training on Lambda Labs GPU..."
echo "This will:"
echo "  - Provision a GPU instance (~$0.50/hr)"
echo "  - Upload code and training data"
echo "  - Train Llama 3.2 1B with LoRA (~15-30 min)"
echo "  - Download trained adapter"
echo "  - Clean up instance"
echo

# Check for Lambda Labs API key
if [ -z "$LAMBDA_LABS_API_KEY" ]; then
    echo "Error: LAMBDA_LABS_API_KEY environment variable not set"
    echo
    echo "Please set your Lambda Labs API key:"
    echo "  export LAMBDA_LABS_API_KEY='your_api_key_here'"
    echo
    echo "Get your API key from: https://cloud.lambdalabs.com/api-keys"
    exit 1
fi

python lambda_train.py --version "$VERSION"
echo

# Step 3: Validate adapter
echo "[3/3] Validating trained adapter..."
if python validate_adapter.py --version "$VERSION"; then
    echo
    echo "============================================"
    echo "  ✓ Training Complete!"
    echo "============================================"
    echo "Version: $VERSION"
    echo "Adapter: training/peft/checkpoints/slack-lora-${VERSION}/"
    echo "Logs: training/peft/logs/${VERSION}/"
    echo
    echo "Next steps:"
    echo "  1. Start the Slack browser: uvicorn training.peft.slack_api:app --reload --port 5055"
    echo "  2. Open the UI and switch to 'Model' extraction mode"
    echo "  3. Compare model predictions with regex extractions"
    echo
else
    echo
    echo "============================================"
    echo "  ⚠ Validation Failed"
    echo "============================================"
    echo "The adapter was trained but validation failed."
    echo "Check logs at: training/peft/logs/${VERSION}/"
    exit 1
fi
