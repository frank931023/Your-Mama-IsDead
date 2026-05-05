"""
03_train_lora.py — train a SDXL LoRA for the deceased's likeness.

  python pipelines/03_train_lora.py --token-id 42 --config configs/lora_person.yaml

Prototype mode is a STUB that produces a properly-formatted ``lora.safetensors``
of trivial size so the rest of the pipeline (packaging / upload) can be exercised
on a CPU-only laptop. Replace with real training for a useful artifact.

Real implementation: kohya-ss/sd-scripts (`train_network.py --network_module
networks.lora ...`) or diffusers + peft.LoraConfig. See the TODO inside.

Outputs:
  workspace/<id>/lora/lora.safetensors
  workspace/<id>/lora/config_snapshot.yaml
  workspace/<id>/lora/run.log
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import yaml
from safetensors.numpy import save_file as save_safetensors
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import get_logger, load_env, workspace_dir  # noqa: E402


def _load_config(config_path: Path) -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _stub_train(
    images_dir: Path,
    captions_dir: Path,
    out_path: Path,
    *,
    rank: int,
    base: str,
    steps: int,
    resolution: int,
    logger,
) -> None:
    """Produce a syntactically-valid (but zero-init) LoRA safetensors file.

    The shapes mirror what diffusers + peft would emit for a single attention
    block, so any downstream loader that just inspects keys / shapes will not
    blow up. The numbers themselves are zero — inference with this file will
    be a no-op on the base model, which is exactly what we want for a stub.
    """
    n_images = sum(1 for p in images_dir.glob("*") if p.is_file())
    n_captions = sum(1 for p in captions_dir.glob("*.txt"))
    logger.info("training inputs: %d images / %d captions", n_images, n_captions)
    logger.info("training params: base=%s rank=%d steps=%d res=%d", base, rank, steps, resolution)

    # Pretend to iterate so logs/progress look real and timing isn't instantaneous.
    pbar = tqdm(range(min(steps, 200)), desc="lora-stub", unit="step")
    for _ in pbar:
        time.sleep(0)

    # Minimal LoRA tensor pair — keys imitate diffusers/peft naming.
    inner_dim = 768
    tensors = {
        "lora_unet_down_blocks_0_attentions_0_proj.lora_down.weight":
            np.zeros((rank, inner_dim), dtype=np.float16),
        "lora_unet_down_blocks_0_attentions_0_proj.lora_up.weight":
            np.zeros((inner_dim, rank), dtype=np.float16),
        "lora_unet_down_blocks_0_attentions_0_proj.alpha":
            np.array([float(rank)], dtype=np.float32),
    }
    metadata = {
        "ss_network_module": "networks.lora",
        "ss_network_dim": str(rank),
        "ss_network_alpha": str(rank),
        "ss_base_model_version": base,
        "ss_resolution": str(resolution),
        "ss_steps": str(steps),
        "ss_num_train_images": str(n_images),
        "dsas_stub": "true",
    }
    save_safetensors(tensors, str(out_path), metadata=metadata)
    logger.info("wrote stub LoRA → %s (%d bytes)", out_path, out_path.stat().st_size)


def _real_train(*args, **kwargs) -> None:
    # TODO: replace stub with real training
    # Recommended: invoke kohya-ss/sd-scripts as a subprocess or use diffusers + peft:
    #
    #   from diffusers import StableDiffusionXLPipeline
    #   from peft import LoraConfig, get_peft_model
    #   import torch
    #   pipe = StableDiffusionXLPipeline.from_pretrained(BASE_MODEL, torch_dtype=torch.float16).to("cuda")
    #   lora_cfg = LoraConfig(r=rank, lora_alpha=rank, target_modules=["to_q","to_k","to_v","to_out.0"])
    #   pipe.unet = get_peft_model(pipe.unet, lora_cfg)
    #   # build dataset from (images_dir, captions_dir/captions.jsonl), call training loop,
    #   # then pipe.unet.save_pretrained(out_dir) and convert to safetensors.
    #
    # GPU/VRAM: SDXL LoRA @ 1024 px, rank 16, batch 1 ≈ 24 GB VRAM, ~1 hour on RTX 4090.
    raise NotImplementedError("Real LoRA training not implemented in prototype.")


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Train a LoRA for the tablet.")
    parser.add_argument("--token-id", required=True, type=int)
    parser.add_argument("--config", default="configs/lora_person.yaml")
    parser.add_argument("--base", default=None, help="override base model from config")
    parser.add_argument("--rank", type=int, default=None)
    parser.add_argument("--steps", type=int, default=None)
    parser.add_argument("--resolution", type=int, default=None)
    parser.add_argument("--real", action="store_true", help="run the real training path (requires GPU)")
    parser.add_argument("--force", action="store_true", help="overwrite existing weights")
    args = parser.parse_args(argv)

    ws = workspace_dir(args.token_id)
    out_dir = ws / "lora"
    out_dir.mkdir(parents=True, exist_ok=True)
    logger = get_logger("03_train_lora", out_dir / "run.log")
    logger.info("=== train_lora tokenId=%s ===", args.token_id)

    # Locate config — first as given, then relative to training/.
    cfg_path = Path(args.config)
    if not cfg_path.is_absolute() and not cfg_path.exists():
        alt = Path(__file__).resolve().parents[1] / args.config
        if alt.exists():
            cfg_path = alt
    if not cfg_path.exists():
        raise SystemExit(f"config not found: {args.config}")
    cfg = _load_config(cfg_path)

    base = args.base or cfg.get("base", "sdxl-1.0")
    rank = args.rank or int(cfg.get("rank", 16))
    steps = args.steps or int(cfg.get("steps", 2000))
    resolution = args.resolution or int(cfg.get("resolution", 1024))

    # Snapshot the config so future-us can reproduce.
    snapshot_path = out_dir / "config_snapshot.yaml"
    effective = {**cfg, "base": base, "rank": rank, "steps": steps, "resolution": resolution}
    with open(snapshot_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(effective, f, allow_unicode=True, sort_keys=False)
    logger.info("config snapshot → %s", snapshot_path)

    out_path = out_dir / "lora.safetensors"
    if out_path.exists() and not args.force:
        logger.info("lora.safetensors exists; pass --force to retrain. Done.")
        return 0

    images_dir = ws / "raw" / "photos"
    captions_dir = ws / "captions"
    if not images_dir.exists() or not any(images_dir.iterdir()):
        logger.warning("no images under %s — stub will still emit weights", images_dir)
    if not captions_dir.exists():
        logger.warning("no captions under %s — run 02_caption_images.py first for real training",
                       captions_dir)

    if args.real:
        _real_train()  # raises NotImplementedError in prototype
    else:
        _stub_train(
            images_dir, captions_dir, out_path,
            rank=rank, base=base, steps=steps, resolution=resolution,
            logger=logger,
        )

    # Also copy the config snapshot into out_dir so packaging picks it up next to weights.
    shutil.copyfile(snapshot_path, out_dir / "config_snapshot.yaml")
    logger.info("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
