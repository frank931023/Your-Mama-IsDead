"""
04_train_voice.py — train / clone a voice model for the deceased.

  python pipelines/04_train_voice.py --token-id 42 --backend stub

Backends:
  - stub             : produces a tiny binary placeholder (default)
  - gpt-sovits       : GPT-SoVITS local fine-tune (≥12 GB VRAM)
  - elevenlabs-clone : ElevenLabs Instant Voice Clone REST API (no local GPU)

Outputs:
  workspace/<id>/voice/voice_model.bin
  workspace/<id>/voice/voice_config.json
  workspace/<id>/voice/run.log
"""
from __future__ import annotations

import argparse
import os
import sys
import wave
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import get_logger, load_env, workspace_dir, write_json  # noqa: E402

AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".wma"}


def _audio_durations(audio_dir: Path) -> list[dict[str, Any]]:
    """Best-effort duration probe — uses stdlib `wave` for .wav, falls back to size."""
    out: list[dict[str, Any]] = []
    if not audio_dir.exists():
        return out
    for path in sorted(audio_dir.iterdir()):
        if path.suffix.lower() not in AUDIO_EXTS or not path.is_file():
            continue
        info: dict[str, Any] = {
            "path": str(path.relative_to(audio_dir.parents[1])),
            "size_bytes": path.stat().st_size,
        }
        if path.suffix.lower() == ".wav":
            try:
                with wave.open(str(path), "rb") as w:
                    frames = w.getnframes()
                    rate = w.getframerate() or 1
                    info["duration_sec"] = round(frames / rate, 3)
                    info["sample_rate"] = rate
                    info["channels"] = w.getnchannels()
            except Exception:  # noqa: BLE001
                pass
        out.append(info)
    return out


def _stub_train(
    audio_dir: Path, out_dir: Path, *, sample_rate: int, logger,
) -> dict[str, Any]:
    durations = _audio_durations(audio_dir)
    total = sum(d.get("duration_sec", 0.0) for d in durations)
    logger.info(
        "stub voice training: %d clips, total %.1fs of audio",
        len(durations), total,
    )

    # Tiny placeholder binary — size keeps it cheap to upload.
    bin_path = out_dir / "voice_model.bin"
    with open(bin_path, "wb") as f:
        # Magic header so accidental loaders fail loudly instead of silently.
        f.write(b"DSAS_VOICE_STUB_v1\n")
        f.write(f"sample_rate={sample_rate}\n".encode("ascii"))
        f.write(f"sources={len(durations)}\n".encode("ascii"))
        f.write(b"\x00" * 1024)  # padding so file is non-trivial
    logger.info("wrote stub voice model → %s (%d bytes)", bin_path, bin_path.stat().st_size)

    return {
        "backend": "stub",
        "sample_rate": sample_rate,
        "sources": durations,
        "total_seconds": round(total, 3),
        "stub": True,
    }


def _real_train_gpt_sovits(*args, **kwargs):
    # TODO: replace stub with real training
    # GPT-SoVITS workflow (RVC-Boss/GPT-SoVITS):
    #   1. Pre-process: denoise + slice audios into 3-10s chunks (`tools/slicer2.py`).
    #   2. Transcribe with faster-whisper to get prompt text.
    #   3. Run `s2_train.py` (SoVITS) ~8 epochs and `s1_train.py` (GPT) ~15 epochs.
    #   4. Convert outputs to .pth checkpoints + a JSON config; bundle as voice_model.bin.
    # GPU/VRAM: ≥12 GB. Needs 5–30 minutes of clean reference speech for good results.
    raise NotImplementedError("GPT-SoVITS backend stubbed. See _real_train_gpt_sovits TODO.")


def _real_train_elevenlabs(audio_dir: Path, out_dir: Path, logger):
    # TODO: replace stub with real training
    # ElevenLabs Instant Voice Cloning (https://elevenlabs.io/docs/api-reference/voices/add):
    #   POST https://api.elevenlabs.io/v1/voices/add
    #     headers: xi-api-key: $ELEVENLABS_API_KEY
    #     multipart: name=<token-id>, files=[ each audio in audio_dir ]
    #   Returns {"voice_id": "..."} — store that in voice_config.json (no local weights).
    raise NotImplementedError("ElevenLabs backend stubbed. See _real_train_elevenlabs TODO.")


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Train / clone a voice model.")
    parser.add_argument("--token-id", required=True, type=int)
    parser.add_argument(
        "--backend", choices=("stub", "gpt-sovits", "elevenlabs-clone"), default="stub",
        help="voice backend (default: stub — no GPU required)",
    )
    parser.add_argument("--sample-rate", type=int, default=32000)
    parser.add_argument("--force", action="store_true", help="retrain over existing model")
    args = parser.parse_args(argv)

    ws = workspace_dir(args.token_id)
    out_dir = ws / "voice"
    out_dir.mkdir(parents=True, exist_ok=True)
    logger = get_logger("04_train_voice", out_dir / "run.log")
    logger.info("=== train_voice tokenId=%s backend=%s ===", args.token_id, args.backend)

    bin_path = out_dir / "voice_model.bin"
    cfg_path = out_dir / "voice_config.json"
    if bin_path.exists() and cfg_path.exists() and not args.force:
        logger.info("voice model already exists; pass --force to retrain. Done.")
        return 0

    audio_dir = ws / "raw" / "audios"
    if not audio_dir.exists() or not any(audio_dir.iterdir()):
        logger.warning("no audio under %s — stub will still emit a model", audio_dir)

    if args.backend == "stub":
        cfg = _stub_train(audio_dir, out_dir, sample_rate=args.sample_rate, logger=logger)
    elif args.backend == "gpt-sovits":
        cfg = _real_train_gpt_sovits(audio_dir, out_dir, logger=logger)
    else:  # elevenlabs-clone
        cfg = _real_train_elevenlabs(audio_dir, out_dir, logger)

    # Augment with environment hints.
    cfg.setdefault("device", os.getenv("GPU_DEVICE", "cpu"))
    write_json(cfg_path, cfg)
    logger.info("voice config → %s", cfg_path)
    logger.info("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
