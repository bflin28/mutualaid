import argparse
import json
import os
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)

DEFAULT_PROMPT_TEMPLATE = (
    "You are a warehouse intake extractor. Return JSON only with fields:\n"
    "- location (string|null)\n"
    "- drop_off_location (string|null)\n"
    "- items: item_name, quantity, unit, pounds, notes, sources, confidence\n\n"
    "Message:\n{input_text}\n\n"
    "JSON:"
)


def parse_args():
    parser = argparse.ArgumentParser(description="Train a PEFT/LoRA adapter for warehouse tabular extraction.")
    parser.add_argument("--dataset", default="training/peft/data/warehouse_logs.jsonl", help="Path to JSONL from export_warehouse_logs.js")
    parser.add_argument("--model-id", default="meta-llama/Llama-3.2-1B-Instruct", help="Base HF model id or local path")
    parser.add_argument("--output-dir", default="training/peft/checkpoints/warehouse-lora", help="Where to store the adapter")
    parser.add_argument("--num-epochs", type=float, default=1.0, help="Training epochs (ignored if max-steps is set)")
    parser.add_argument("--max-steps", type=int, default=None, help="Override epochs with a fixed step count")
    parser.add_argument("--batch-size", type=int, default=2, help="Per-device batch size")
    parser.add_argument("--gradient-accumulation", type=int, default=4, help="Gradient accumulation steps")
    parser.add_argument("--learning-rate", type=float, default=2e-4, help="AdamW learning rate")
    parser.add_argument("--weight-decay", type=float, default=0.0, help="Weight decay")
    parser.add_argument("--warmup-steps", type=int, default=50, help="Warmup steps")
    parser.add_argument("--max-length", type=int, default=1024, help="Max sequence length")
    parser.add_argument("--eval-ratio", type=float, default=0.05, help="Portion of data to hold out for eval (0 disables)")
    parser.add_argument("--max-records", type=int, default=None, help="Optional cap on records for quick smoke tests")
    parser.add_argument("--lora-r", type=int, default=32, help="LoRA rank")
    parser.add_argument("--lora-alpha", type=int, default=64, help="LoRA alpha")
    parser.add_argument("--lora-dropout", type=float, default=0.05, help="LoRA dropout")
    parser.add_argument(
        "--lora-target-modules",
        type=str,
        default=None,
        help="Comma-separated module names (defaults to common Llama attention/MLP projections)",
    )
    parser.add_argument("--use-4bit", action="store_true", help="Load base model in 4-bit (requires bitsandbytes)")
    parser.add_argument("--use-8bit", action="store_true", help="Load base model in 8-bit (requires bitsandbytes)")
    parser.add_argument("--grad-checkpointing", action="store_true", help="Enable gradient checkpointing")
    parser.add_argument("--prompt-template", type=str, default=DEFAULT_PROMPT_TEMPLATE, help="Custom prompt with {input_text} placeholder")
    parser.add_argument("--wandb", action="store_true", help="Report metrics to Weights & Biases")
    return parser.parse_args()


def guess_lora_modules():
    return ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]


def make_formatter(tokenizer, template):
    def _format(example):
        prompt = example.get("prompt") or template.format(input_text=example["input_text"].strip())
        target_text = example.get("response") or json.dumps(example.get("target") or {}, ensure_ascii=False)
        text = prompt.rstrip() + "\n" + target_text + tokenizer.eos_token
        return {"text": text}

    return _format


def tokenize(tokenizer, max_length):
    def _tokenize(batch):
        return tokenizer(
            batch["text"],
            truncation=True,
            max_length=max_length,
        )

    return _tokenize


def get_quant_config(args):
    if not (args.use_4bit or args.use_8bit):
        return None
    return BitsAndBytesConfig(
        load_in_4bit=args.use_4bit,
        load_in_8bit=args.use_8bit,
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
    )


def main():
    args = parse_args()
    if args.use_4bit and args.use_8bit:
        raise SystemExit("Choose only one of --use-4bit or --use-8bit")

    Path(args.output_dir).mkdir(parents=True, exist_ok=True)

    torch.backends.cuda.matmul.allow_tf32 = True
    tokenizer = AutoTokenizer.from_pretrained(args.model_id, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    quant_config = get_quant_config(args)
    model_kwargs = {
        "device_map": "auto",
        "torch_dtype": torch.bfloat16 if not (args.use_4bit or args.use_8bit) else None,
        "quantization_config": quant_config,
    }

    model = AutoModelForCausalLM.from_pretrained(args.model_id, **model_kwargs)
    if quant_config:
        model = prepare_model_for_kbit_training(model)
    if args.grad_checkpointing:
        model.gradient_checkpointing_enable()
        model.config.use_cache = False

    target_modules = (
        [m.strip() for m in args.lora_target_modules.split(",") if m.strip()]
        if args.lora_target_modules
        else guess_lora_modules()
    )

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=target_modules,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    raw = load_dataset("json", data_files=args.dataset)["train"]
    if args.max_records:
        raw = raw.select(range(min(len(raw), args.max_records)))

    if args.eval_ratio and args.eval_ratio > 0:
        split = raw.train_test_split(test_size=args.eval_ratio, seed=42)
        train_ds, eval_ds = split["train"], split["test"]
    else:
        train_ds, eval_ds = raw, None

    formatter = make_formatter(tokenizer, args.prompt_template)
    train_ds = train_ds.map(formatter, remove_columns=train_ds.column_names)
    eval_ds = eval_ds.map(formatter, remove_columns=eval_ds.column_names) if eval_ds else None

    train_ds = train_ds.map(tokenize(tokenizer, args.max_length), batched=True, remove_columns=train_ds.column_names)
    eval_ds = (
        eval_ds.map(tokenize(tokenizer, args.max_length), batched=True, remove_columns=eval_ds.column_names)
        if eval_ds
        else None
    )

    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    logging_dir = os.path.join(args.output_dir, "logs")
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,
        num_train_epochs=None if args.max_steps else args.num_epochs,
        max_steps=args.max_steps or -1,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        warmup_steps=args.warmup_steps,
        lr_scheduler_type="cosine",
        logging_steps=10,
        save_strategy="epoch",
        evaluation_strategy="steps" if eval_ds is not None else "no",
        eval_steps=200 if eval_ds is not None else None,
        bf16=not (args.use_4bit or args.use_8bit),
        gradient_checkpointing=args.grad_checkpointing,
        report_to=["wandb"] if args.wandb else ["none"],
        logging_dir=logging_dir,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        data_collator=data_collator,
    )

    trainer.train()
    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)


if __name__ == "__main__":
    main()
