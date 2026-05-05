"""
06_package_artifact.py — bundle LoRA + voice + RAG into a single tar.gz.

  python pipelines/06_package_artifact.py --token-id 42 --version v1

Produces:
  workspace/<id>/dist/artifact-<version>.tar.gz
  workspace/<id>/dist/manifest.json   (matches shared/types/artifact.ts)

Step 07 fills in the IPFS URIs after upload and overwrites manifest.json.
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import tarfile
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    compute_sha256,
    get_logger,
    load_env,
    read_json,
    workspace_dir,
    write_json,
)


def _safe_yaml_load(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception:  # noqa: BLE001
        return {}


def _build_tarball(sources: list[tuple[Path, str]], dest: Path, logger) -> None:
    """Tar+gzip the listed (path, arcname) pairs into ``dest``.

    Skips entries whose source doesn't exist; logs a warning.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    with tarfile.open(tmp, "w:gz") as tar:
        for src, arc in sources:
            if not src.exists():
                logger.warning("skip missing artifact piece: %s", src)
                continue
            logger.info("tar: %s → %s", src, arc)
            tar.add(src, arcname=arc, recursive=True)
    tmp.replace(dest)


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Package training artifact.")
    parser.add_argument("--token-id", required=True, type=int)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--force", action="store_true", help="overwrite existing dist files")
    args = parser.parse_args(argv)

    ws = workspace_dir(args.token_id)
    dist = ws / "dist"
    dist.mkdir(parents=True, exist_ok=True)
    logger = get_logger("06_package_artifact", dist / "package.log")
    logger.info("=== package_artifact tokenId=%s version=%s ===", args.token_id, args.version)

    tarball = dist / f"artifact-{args.version}.tar.gz"
    manifest_path = dist / "manifest.json"
    if tarball.exists() and manifest_path.exists() and not args.force:
        logger.info("artifact already packaged; pass --force to repackage. Done.")
        return 0

    # 1. Pull metadata snapshots from each step's outputs.
    lora_cfg = _safe_yaml_load(ws / "lora" / "config_snapshot.yaml")
    voice_cfg_path = ws / "voice" / "voice_config.json"
    voice_cfg: dict[str, Any] = {}
    if voice_cfg_path.exists():
        try:
            voice_cfg = read_json(voice_cfg_path)
        except Exception:  # noqa: BLE001
            logger.warning("failed to parse voice_config.json")

    rag_index_path = ws / "rag" / "index.json"
    rag_chunks = 0
    rag_model = ""
    rag_chunk_size = 0
    if rag_index_path.exists():
        try:
            idx = read_json(rag_index_path)
            rag_chunks = int(idx.get("count") or len(idx.get("chunks") or []))
            rag_model = str(idx.get("model") or "")
            rag_chunk_size = int(idx.get("chunkSize") or 0)
        except Exception:  # noqa: BLE001
            logger.warning("failed to parse rag/index.json")

    # 2. Bundle.
    sources: list[tuple[Path, str]] = [
        (ws / "lora", "lora"),
        (ws / "voice", "voice"),
        (ws / "rag", "rag"),
    ]
    _build_tarball(sources, tarball, logger)
    checksum_hex = compute_sha256(tarball)
    logger.info("tarball sha256: %s", checksum_hex)

    # 3. Write manifest matching shared/types/artifact.ts.
    # URIs are filled in by 07_upload_artifact.py after upload.
    manifest: dict[str, Any] = {
        "tokenId": args.token_id,
        "version": args.version,
        "createdAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "models": {
            "lora": {
                "uri": None,
                "base": lora_cfg.get("base", "sdxl-1.0"),
                "rank": int(lora_cfg.get("rank", 16)),
                "steps": int(lora_cfg.get("steps", 2000)),
            },
            "voice": {
                "uri": None,
                "backend": voice_cfg.get("backend", "stub"),
            },
            "rag": {
                "uri": None,
                "embed": rag_model,
                "chunks": rag_chunks,
                "chunkSize": rag_chunk_size,
            },
        },
        "checksum": f"sha256:{checksum_hex}",
        "bundle": {
            "path": str(tarball.relative_to(ws)),
            "sizeBytes": tarball.stat().st_size,
        },
    }
    write_json(manifest_path, manifest)
    logger.info("manifest → %s", manifest_path)
    logger.info("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
