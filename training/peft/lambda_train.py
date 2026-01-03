#!/usr/bin/env python3
"""
Automated Lambda Labs GPU training pipeline.

Usage:
    python training/peft/lambda_train.py --version v1
    python training/peft/lambda_train.py --version v1 --dry-run

Environment variables:
    LAMBDA_LABS_API_KEY: Required for Lambda Labs API authentication
    SSH_PRIVATE_KEY: Optional, defaults to ~/.ssh/id_rsa
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

import requests


class LambdaLabsTrainer:
    """Automated training on Lambda Labs GPU instances."""

    def __init__(self, version: str, dry_run: bool = False):
        self.version = version
        self.dry_run = dry_run
        self.base_url = "https://cloud.lambdalabs.com/api/v1"
        self.api_key = os.getenv("LAMBDA_LABS_API_KEY")

        if not self.api_key and not dry_run:
            raise ValueError(
                "LAMBDA_LABS_API_KEY environment variable is required. "
                "Get your API key from https://cloud.lambdalabs.com/api-keys"
            )

        self.ssh_key = os.getenv("SSH_PRIVATE_KEY", str(Path.home() / ".ssh" / "id_rsa"))
        self.instance_id: Optional[str] = None
        self.instance_ip: Optional[str] = None
        self.ssh_user = "ubuntu"

        # Paths
        self.project_root = Path(__file__).resolve().parent.parent.parent
        self.training_dir = Path(__file__).resolve().parent
        self.output_dir = self.training_dir / "checkpoints" / f"slack-lora-{version}"
        self.log_dir = self.training_dir / "logs" / version
        self.log_dir.mkdir(parents=True, exist_ok=True)

        # Metadata
        self.metadata: Dict[str, Any] = {
            "version": version,
            "started_at": datetime.utcnow().isoformat() + "Z",
            "status": "pending",
        }

    def log(self, message: str, level: str = "INFO") -> None:
        """Log message to console and file."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_msg = f"[{timestamp}] [{level}] {message}"
        print(log_msg)

        log_file = self.log_dir / "training.log"
        with open(log_file, "a") as f:
            f.write(log_msg + "\n")

    def api_request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Make authenticated API request with retry logic."""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {"Authorization": f"Bearer {self.api_key}"}

        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = requests.request(method, url, headers=headers, **kwargs)
                response.raise_for_status()
                return response
            except requests.exceptions.RequestException as e:
                self.log(f"API request failed (attempt {attempt + 1}/{max_retries}): {e}", "WARNING")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff
                else:
                    raise

    def list_instance_types(self) -> List[Dict]:
        """Get available GPU instance types."""
        self.log("Fetching available instance types...")
        response = self.api_request("GET", "/instance-types")
        data = response.json()
        return data.get("data", {})

    def provision_instance(self) -> Dict:
        """Launch the cheapest available GPU instance."""
        self.log("Provisioning Lambda Labs GPU instance...")

        if self.dry_run:
            self.log("DRY RUN: Would provision instance", "INFO")
            self.instance_id = "dry-run-instance-id"
            self.instance_ip = "203.0.113.1"
            return {"instance_id": self.instance_id, "ip": self.instance_ip}

        # Get available instance types
        instance_types_data = self.list_instance_types()

        # Prefer these instance types (cheapest to expensive)
        preferred_types = [
            "gpu_1x_rtx6000",  # ~$0.50/hr
            "gpu_1x_a10",      # ~$0.60/hr
            "gpu_1x_a6000",    # ~$0.80/hr
        ]

        # Find first available instance type
        selected_type = None
        selected_region = None

        for instance_type_name in preferred_types:
            for instance_type, details in instance_types_data.items():
                if instance_type == instance_type_name:
                    regions = details.get("regions_with_capacity_available", [])
                    if regions:
                        selected_type = instance_type
                        selected_region = regions[0]["name"]
                        price = details.get("instance_type", {}).get("price_cents_per_hour", 0) / 100
                        self.log(f"Found available instance: {selected_type} in {selected_region} (${price:.2f}/hr)")
                        break
            if selected_type:
                break

        if not selected_type:
            raise RuntimeError(
                "No GPU instances available. Preferred types: " + ", ".join(preferred_types)
            )

        # Launch instance
        payload = {
            "region_name": selected_region,
            "instance_type_name": selected_type,
            "ssh_key_names": [],  # Use default SSH keys from account
        }

        self.log(f"Launching {selected_type} in {selected_region}...")
        response = self.api_request("POST", "/instance-operations/launch", json=payload)
        result = response.json()

        instance_ids = result.get("data", {}).get("instance_ids", [])
        if not instance_ids:
            raise RuntimeError(f"Failed to launch instance: {result}")

        self.instance_id = instance_ids[0]
        self.metadata["instance_id"] = self.instance_id
        self.metadata["instance_type"] = selected_type
        self.metadata["region"] = selected_region

        self.log(f"Instance launched: {self.instance_id}")
        self.log("Waiting for instance to become active...")

        # Wait for instance to be active
        max_wait = 300  # 5 minutes
        start_time = time.time()

        while time.time() - start_time < max_wait:
            instance_info = self.get_instance_info()
            status = instance_info.get("status")

            if status == "active":
                self.instance_ip = instance_info.get("ip")
                self.log(f"Instance active! IP: {self.instance_ip}")
                self.metadata["instance_ip"] = self.instance_ip
                return instance_info

            self.log(f"Instance status: {status}, waiting...")
            time.sleep(10)

        raise TimeoutError(f"Instance did not become active within {max_wait} seconds")

    def get_instance_info(self) -> Dict:
        """Get current instance information."""
        response = self.api_request("GET", "/instances")
        instances = response.json().get("data", [])

        for instance in instances:
            if instance.get("id") == self.instance_id:
                return instance

        raise RuntimeError(f"Instance {self.instance_id} not found")

    def wait_for_ssh(self, timeout: int = 180) -> None:
        """Wait for SSH to become available."""
        self.log("Waiting for SSH to be ready...")

        if self.dry_run:
            self.log("DRY RUN: Would wait for SSH", "INFO")
            return

        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                result = subprocess.run(
                    [
                        "ssh",
                        "-i", self.ssh_key,
                        "-o", "StrictHostKeyChecking=no",
                        "-o", "ConnectTimeout=5",
                        f"{self.ssh_user}@{self.instance_ip}",
                        "echo", "SSH ready"
                    ],
                    capture_output=True,
                    timeout=10,
                )
                if result.returncode == 0:
                    self.log("SSH is ready!")
                    return
            except subprocess.TimeoutExpired:
                pass

            time.sleep(5)

        raise TimeoutError(f"SSH did not become available within {timeout} seconds")

    def upload_code_and_data(self) -> None:
        """Upload project code and training data to instance."""
        self.log("Uploading code and training data...")

        if self.dry_run:
            self.log("DRY RUN: Would upload code and data", "INFO")
            return

        # Create remote directory
        subprocess.run(
            [
                "ssh",
                "-i", self.ssh_key,
                "-o", "StrictHostKeyChecking=no",
                f"{self.ssh_user}@{self.instance_ip}",
                "mkdir", "-p", "mutualaid/training/peft"
            ],
            check=True,
        )

        # Upload training directory
        self.log("Uploading training/peft directory...")
        subprocess.run(
            [
                "rsync",
                "-avz",
                "-e", f"ssh -i {self.ssh_key} -o StrictHostKeyChecking=no",
                "--exclude", "checkpoints",
                "--exclude", "logs",
                "--exclude", "__pycache__",
                "--exclude", "*.pyc",
                f"{self.training_dir}/",
                f"{self.ssh_user}@{self.instance_ip}:mutualaid/training/peft/"
            ],
            check=True,
        )

        self.log("Code and data uploaded successfully!")

    def run_remote_training(self) -> None:
        """Execute training script on remote GPU instance."""
        self.log(f"Starting training on GPU (version: {self.version})...")

        if self.dry_run:
            self.log("DRY RUN: Would run training remotely", "INFO")
            return

        # Remote training command
        remote_script = f"""
set -e
cd mutualaid/training/peft

# Create venv and install dependencies
python3 -m venv .venv
source .venv/bin/activate

# Install PyTorch with CUDA 12.1 support
pip install --quiet torch==2.4.1 --index-url https://download.pytorch.org/whl/cu121

# Install other dependencies
pip install --quiet -r requirements.txt

# Run training
python train.py \\
  --dataset data/slack_audited_training.jsonl \\
  --model-id meta-llama/Llama-3.2-1B-Instruct \\
  --output-dir checkpoints/slack-lora-{self.version} \\
  --use-4bit \\
  --batch-size 2 \\
  --gradient-accumulation 8 \\
  --num-epochs 3 \\
  --learning-rate 2e-4 \\
  --max-length 1024 \\
  --eval-ratio 0.1

echo "Training complete!"
"""

        # Write script to temp file and execute
        self.log("Executing remote training script...")
        result = subprocess.run(
            [
                "ssh",
                "-i", self.ssh_key,
                "-o", "StrictHostKeyChecking=no",
                f"{self.ssh_user}@{self.instance_ip}",
                f"bash -c '{remote_script}'"
            ],
            capture_output=True,
            text=True,
            timeout=7200,  # 2-hour timeout
        )

        # Save training logs
        log_file = self.log_dir / "training_output.log"
        with open(log_file, "w") as f:
            f.write("=== STDOUT ===\n")
            f.write(result.stdout)
            f.write("\n\n=== STDERR ===\n")
            f.write(result.stderr)

        if result.returncode != 0:
            self.log(f"Training failed with exit code {result.returncode}", "ERROR")
            self.log(f"See logs at: {log_file}", "ERROR")
            raise RuntimeError("Remote training failed")

        self.log("Training completed successfully!")

    def download_adapter(self) -> None:
        """Download trained LoRA adapter from instance."""
        self.log("Downloading trained adapter...")

        if self.dry_run:
            self.log("DRY RUN: Would download adapter", "INFO")
            return

        # Create local output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Download adapter
        subprocess.run(
            [
                "rsync",
                "-avz",
                "-e", f"ssh -i {self.ssh_key} -o StrictHostKeyChecking=no",
                f"{self.ssh_user}@{self.instance_ip}:mutualaid/training/peft/checkpoints/slack-lora-{self.version}/",
                f"{self.output_dir}/"
            ],
            check=True,
        )

        self.log(f"Adapter downloaded to: {self.output_dir}")

        # Verify adapter files exist
        adapter_config = self.output_dir / "adapter_config.json"
        if not adapter_config.exists():
            raise RuntimeError("Downloaded adapter is missing adapter_config.json")

        self.metadata["adapter_path"] = str(self.output_dir.relative_to(self.training_dir))
        self.log("Adapter verified successfully!")

    def cleanup_instance(self) -> None:
        """Terminate Lambda Labs instance."""
        if not self.instance_id:
            return

        self.log(f"Terminating instance {self.instance_id}...")

        if self.dry_run:
            self.log("DRY RUN: Would terminate instance", "INFO")
            return

        try:
            payload = {"instance_ids": [self.instance_id]}
            self.api_request("POST", "/instance-operations/terminate", json=payload)
            self.log("Instance terminated successfully!")
        except Exception as e:
            self.log(f"Failed to terminate instance: {e}", "WARNING")
            self.log(f"Please manually terminate instance: {self.instance_id}", "WARNING")

    def save_metadata(self) -> None:
        """Save training metadata to registry."""
        self.metadata["completed_at"] = datetime.utcnow().isoformat() + "Z"

        metadata_file = self.log_dir / "metadata.json"
        with open(metadata_file, "w") as f:
            json.dump(self.metadata, f, indent=2)

        self.log(f"Metadata saved to: {metadata_file}")

        # Update model registry
        registry_file = self.training_dir / "model_registry.json"
        if registry_file.exists():
            with open(registry_file) as f:
                registry = json.load(f)
        else:
            registry = {"models": [], "active_version": None}

        # Add this model to registry
        model_entry = {
            "version": self.version,
            "created_at": self.metadata.get("started_at"),
            "training_records": self.metadata.get("training_records", 0),
            "epochs": 3,
            "adapter_path": self.metadata.get("adapter_path", ""),
            "metrics": self.metadata.get("metrics", {}),
        }

        # Update or append
        existing_idx = None
        for idx, model in enumerate(registry["models"]):
            if model.get("version") == self.version:
                existing_idx = idx
                break

        if existing_idx is not None:
            registry["models"][existing_idx] = model_entry
        else:
            registry["models"].append(model_entry)

        # Set as active if it's the only model or if not set
        if not registry["active_version"] or len(registry["models"]) == 1:
            registry["active_version"] = self.version

        with open(registry_file, "w") as f:
            json.dump(registry, f, indent=2)

        self.log(f"Model registry updated: {registry_file}")

    def run(self) -> bool:
        """Execute complete training pipeline."""
        try:
            self.log(f"=== Lambda Labs Training Pipeline (version: {self.version}) ===")

            # Step 1: Provision instance
            self.provision_instance()

            # Step 2: Wait for SSH
            self.wait_for_ssh()

            # Step 3: Upload code and data
            self.upload_code_and_data()

            # Step 4: Run training
            self.run_remote_training()

            # Step 5: Download adapter
            self.download_adapter()

            # Update metadata
            self.metadata["status"] = "completed"
            self.save_metadata()

            self.log("=== Training pipeline completed successfully! ===")
            return True

        except Exception as e:
            self.log(f"Training pipeline failed: {e}", "ERROR")
            self.metadata["status"] = "failed"
            self.metadata["error"] = str(e)
            self.save_metadata()
            return False

        finally:
            # Always cleanup instance
            if not self.dry_run:
                self.cleanup_instance()


def main():
    parser = argparse.ArgumentParser(description="Train PEFT model on Lambda Labs GPU")
    parser.add_argument(
        "--version",
        required=True,
        help="Model version identifier (e.g., v1, 20260101-143000)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate training without actually provisioning GPU",
    )
    args = parser.parse_args()

    trainer = LambdaLabsTrainer(version=args.version, dry_run=args.dry_run)
    success = trainer.run()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
