"""
02_caption_images.py — auto-caption photos for LoRA training.

  python pipelines/02_caption_images.py --token-id 42 --captioner stub

Backends:
  - stub  : no GPU, generates "a photo of <NAME>, person, <attribute>" from
            metadata + filename (default — runs on a laptop)
  - blip2 : real BLIP-2 captioning via transformers (~16 GB VRAM)
  - llava : real LLaVA captioning (~24 GB VRAM)

Outputs:
  workspace/<id>/captions/<photo_basename>.txt   (kohya-style sidecar)
  workspace/<id>/captions/captions.jsonl         (jsonl record per image)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import get_logger, load_env, read_json, workspace_dir  # noqa: E402

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def _iter_images(photo_dir: Path) -> Iterable[Path]:
    if not photo_dir.exists():
        return []
    return sorted(p for p in photo_dir.rglob("*") if p.suffix.lower() in IMAGE_EXTS)


def _stub_caption(image: Path, deceased: dict[str, Any]) -> str:
    name = deceased.get("name", "person")
    gender = deceased.get("gender")
    origin = deceased.get("origin")

    # Rough attribute hints from filename.
    stem = image.stem.lower()
    hints: list[str] = []
    if any(k in stem for k in ("portrait", "headshot", "id")):
        hints.append("portrait")
    if any(k in stem for k in ("young", "youth", "child")):
        hints.append("young")
    if any(k in stem for k in ("old", "elder", "senior")):
        hints.append("elderly")
    if any(k in stem for k in ("smile", "smiling")):
        hints.append("smiling")
    if any(k in stem for k in ("family", "group", "wedding", "graduation")):
        hints.append("group photo")
    if gender:
        hints.append("man" if gender == "male" else "woman" if gender == "female" else "person")
    if origin:
        hints.append(f"from {origin}")

    if hints:
        return f"a photo of {name}, person, " + ", ".join(hints)
    return f"a photo of {name}, person"


def _real_caption_blip2(images: list[Path], logger) -> dict[Path, str]:
    """BLIP-2 caption path. Heavy deps imported lazily.

    GPU/VRAM: BLIP-2 OPT-2.7B fp16 ≈ 16 GB VRAM (or ~8 GB with int8).
    """
    # TODO: replace stub with real training
    # from transformers import Blip2Processor, Blip2ForConditionalGeneration
    # import torch
    # processor = Blip2Processor.from_pretrained("Salesforce/blip2-opt-2.7b")
    # model = Blip2ForConditionalGeneration.from_pretrained(
    #     "Salesforce/blip2-opt-2.7b", torch_dtype=torch.float16
    # ).to("cuda")
    # captions = {}
    # for img_path in tqdm(images):
    #     image = Image.open(img_path).convert("RGB")
    #     inputs = processor(images=image, return_tensors="pt").to("cuda", torch.float16)
    #     out = model.generate(**inputs, max_new_tokens=40)
    #     captions[img_path] = processor.decode(out[0], skip_special_tokens=True)
    # return captions
    raise NotImplementedError(
        "BLIP-2 backend stubbed. Install `transformers torch accelerate` and "
        "uncomment the implementation in _real_caption_blip2()."
    )


def _real_caption_llava(images: list[Path], logger) -> dict[Path, str]:
    """LLaVA caption path. Heavy deps imported lazily.

    GPU/VRAM: LLaVA-1.5 7B fp16 ≈ 16 GB; 13B ≈ 24 GB+
    """
    # TODO: replace stub with real training
    # from transformers import LlavaForConditionalGeneration, AutoProcessor
    # import torch
    # ...
    raise NotImplementedError(
        "LLaVA backend stubbed. Install `transformers torch accelerate` and "
        "uncomment the implementation in _real_caption_llava()."
    )


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Auto-caption photos.")
    parser.add_argument("--token-id", required=True, type=int)
    parser.add_argument(
        "--captioner", choices=("stub", "blip2", "llava"), default="stub",
        help="captioning backend (default: stub — no GPU required)",
    )
    parser.add_argument("--force", action="store_true", help="overwrite existing captions")
    args = parser.parse_args(argv)

    ws = workspace_dir(args.token_id)
    logger = get_logger("02_caption_images", ws / "caption.log")
    logger.info("=== caption_images tokenId=%s captioner=%s ===", args.token_id, args.captioner)

    photo_dir = ws / "raw" / "photos"
    images = list(_iter_images(photo_dir))
    if not images:
        logger.warning("no photos found under %s — nothing to caption", photo_dir)
        return 0
    logger.info("found %d images", len(images))

    metadata_path = ws / "metadata.json"
    deceased: dict[str, Any] = {}
    if metadata_path.exists():
        try:
            metadata = read_json(metadata_path)
            deceased = (metadata.get("dsas") or {}).get("deceased") or {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("failed to read metadata.json: %s", exc)

    out_dir = ws / "captions"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Compute captions per backend.
    if args.captioner == "stub":
        captions: dict[Path, str] = {img: _stub_caption(img, deceased) for img in images}
    else:
        # Real backends — lazy import & progress bar inside.
        try:
            from tqdm import tqdm  # noqa: F401  (used inside the real funcs)
        except ImportError:
            pass
        if args.captioner == "blip2":
            captions = _real_caption_blip2(images, logger)
        else:
            captions = _real_caption_llava(images, logger)

    # Write per-image .txt sidecars + a single jsonl manifest.
    jsonl_path = out_dir / "captions.jsonl"
    written = 0
    with open(jsonl_path, "w", encoding="utf-8") as jf:
        for img, caption in captions.items():
            sidecar = out_dir / f"{img.stem}.txt"
            if sidecar.exists() and not args.force:
                # Re-use existing caption to keep idempotency, but still index.
                try:
                    with open(sidecar, "r", encoding="utf-8") as f:
                        caption = f.read().strip() or caption
                except Exception:  # noqa: BLE001
                    pass
            else:
                with open(sidecar, "w", encoding="utf-8") as f:
                    f.write(caption + "\n")
                written += 1

            jf.write(json.dumps({
                "image": str(img.relative_to(ws)),
                "caption": caption,
            }, ensure_ascii=False) + "\n")

    logger.info("captions: wrote %d new sidecars (total %d) → %s", written, len(captions), jsonl_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
