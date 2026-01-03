#!/usr/bin/env python3
"""
Model version management utilities.

Usage:
    python training/peft/manage_models.py list
    python training/peft/manage_models.py info v1
    python training/peft/manage_models.py set-active v2
    python training/peft/manage_models.py delete v1
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional


class ModelRegistry:
    """Manage model versions and metadata."""

    def __init__(self, registry_path: Optional[Path] = None):
        if registry_path is None:
            self.registry_path = Path(__file__).resolve().parent / "model_registry.json"
        else:
            self.registry_path = Path(registry_path)

        self.data = self.load()

    def load(self) -> Dict[str, Any]:
        """Load registry from disk."""
        if not self.registry_path.exists():
            return {"models": [], "active_version": None}

        try:
            with open(self.registry_path) as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"Warning: Corrupted registry file at {self.registry_path}", file=sys.stderr)
            return {"models": [], "active_version": None}

    def save(self) -> None:
        """Save registry to disk."""
        with open(self.registry_path, "w") as f:
            json.dump(self.data, f, indent=2)

    def list_models(self) -> List[Dict[str, Any]]:
        """Get all registered models."""
        return self.data.get("models", [])

    def get_model(self, version: str) -> Optional[Dict[str, Any]]:
        """Get model by version."""
        for model in self.list_models():
            if model.get("version") == version:
                return model
        return None

    def get_active_version(self) -> Optional[str]:
        """Get the currently active model version."""
        return self.data.get("active_version")

    def get_active_model(self) -> Optional[Dict[str, Any]]:
        """Get the currently active model."""
        active_version = self.get_active_version()
        if not active_version:
            return None
        return self.get_model(active_version)

    def set_active(self, version: str) -> bool:
        """Set active model version."""
        if not self.get_model(version):
            print(f"Error: Model version '{version}' not found in registry", file=sys.stderr)
            return False

        self.data["active_version"] = version
        self.save()
        return True

    def delete_model(self, version: str) -> bool:
        """Remove model from registry (does not delete files)."""
        models = self.list_models()
        updated_models = [m for m in models if m.get("version") != version]

        if len(updated_models) == len(models):
            print(f"Error: Model version '{version}' not found in registry", file=sys.stderr)
            return False

        self.data["models"] = updated_models

        # If deleting active model, clear active version
        if self.get_active_version() == version:
            self.data["active_version"] = None

        self.save()
        return True

    def get_adapter_path(self, version: Optional[str] = None) -> Optional[Path]:
        """Get adapter path for a specific version or active version."""
        if version == "active" or version is None:
            model = self.get_active_model()
        else:
            model = self.get_model(version)

        if not model:
            return None

        adapter_path_str = model.get("adapter_path", "")
        if not adapter_path_str:
            return None

        # Resolve relative to training/peft directory
        base_dir = Path(__file__).resolve().parent
        adapter_path = base_dir / adapter_path_str

        return adapter_path if adapter_path.exists() else None


def cmd_list(registry: ModelRegistry, args) -> int:
    """List all models."""
    models = registry.list_models()
    active_version = registry.get_active_version()

    if not models:
        print("No models registered yet.")
        return 0

    print(f"Registered models ({len(models)}):\n")

    for model in sorted(models, key=lambda m: m.get("created_at", ""), reverse=True):
        version = model.get("version", "unknown")
        created_at = model.get("created_at", "unknown")
        training_records = model.get("training_records", 0)
        adapter_path = model.get("adapter_path", "")
        metrics = model.get("metrics", {})

        is_active = version == active_version
        active_marker = " (active)" if is_active else ""

        print(f"  {version}{active_marker}")
        print(f"    Created: {created_at}")
        print(f"    Training records: {training_records}")
        print(f"    Adapter: {adapter_path}")

        if metrics:
            print(f"    Metrics: {json.dumps(metrics, indent=6)}")

        print()

    return 0


def cmd_info(registry: ModelRegistry, args) -> int:
    """Show detailed info for a model."""
    version = args.version
    model = registry.get_model(version)

    if not model:
        print(f"Error: Model version '{version}' not found", file=sys.stderr)
        return 1

    active_version = registry.get_active_version()
    is_active = version == active_version

    print(f"Model: {version}")
    if is_active:
        print("Status: Active")
    print()
    print(json.dumps(model, indent=2))
    print()

    # Check if adapter exists
    adapter_path = registry.get_adapter_path(version)
    if adapter_path:
        print(f"✓ Adapter found at: {adapter_path}")
    else:
        print(f"✗ Adapter not found (expected: {model.get('adapter_path', 'unknown')})")

    return 0


def cmd_set_active(registry: ModelRegistry, args) -> int:
    """Set active model version."""
    version = args.version

    if registry.set_active(version):
        print(f"✓ Active model set to: {version}")
        return 0
    else:
        return 1


def cmd_delete(registry: ModelRegistry, args) -> int:
    """Delete model from registry."""
    version = args.version

    if not args.force:
        response = input(f"Delete model '{version}' from registry? (y/N): ")
        if response.lower() != "y":
            print("Cancelled.")
            return 0

    if registry.delete_model(version):
        print(f"✓ Model '{version}' removed from registry")
        print("Note: Adapter files were not deleted. To remove files:")
        print(f"  rm -rf training/peft/checkpoints/slack-lora-{version}/")
        return 0
    else:
        return 1


def main():
    parser = argparse.ArgumentParser(description="Manage PEFT model versions")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # List command
    parser_list = subparsers.add_parser("list", help="List all models")

    # Info command
    parser_info = subparsers.add_parser("info", help="Show detailed model info")
    parser_info.add_argument("version", help="Model version")

    # Set-active command
    parser_active = subparsers.add_parser("set-active", help="Set active model version")
    parser_active.add_argument("version", help="Model version to activate")

    # Delete command
    parser_delete = subparsers.add_parser("delete", help="Remove model from registry")
    parser_delete.add_argument("version", help="Model version to delete")
    parser_delete.add_argument("--force", action="store_true", help="Skip confirmation prompt")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    registry = ModelRegistry()

    commands = {
        "list": cmd_list,
        "info": cmd_info,
        "set-active": cmd_set_active,
        "delete": cmd_delete,
    }

    cmd_func = commands.get(args.command)
    if cmd_func:
        return cmd_func(registry, args)
    else:
        print(f"Unknown command: {args.command}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
