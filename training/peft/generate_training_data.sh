#!/bin/bash
# Generate training data from audited Slack messages
# Usage: ./generate_training_data.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

INPUT_FILE="data/slack_messages_audited.jsonl"
OUTPUT_FILE="data/slack_audited_training.jsonl"
ALIASES_FILE="data/location_aliases.json"

echo "=== Generating PEFT Training Data ==="
echo "Input: $INPUT_FILE"
echo "Output: $OUTPUT_FILE"
echo

# Check if input file exists
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file not found: $INPUT_FILE"
    echo "Please audit some Slack messages first using the web UI."
    exit 1
fi

# Run the export script
python export_slack_audited.py \
  --input "$INPUT_FILE" \
  --output "$OUTPUT_FILE" \
  --aliases "$ALIASES_FILE"

# Display statistics
if [ -f "$OUTPUT_FILE" ]; then
    RECORD_COUNT=$(wc -l < "$OUTPUT_FILE" | tr -d ' ')
    echo
    echo "✓ Training data generated successfully!"
    echo "  Records: $RECORD_COUNT"
    echo "  File: $OUTPUT_FILE"
else
    echo "Error: Output file was not created"
    exit 1
fi
