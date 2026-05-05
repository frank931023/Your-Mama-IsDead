"""
01_fetch_assets.py — pull a tablet NFT's metadata + assets to local workspace.

  python pipelines/01_fetch_assets.py --token-id 42

Reads tokenURI(tokenId) from the on-chain DigitalTablet contract, fetches
the metadata JSON from IPFS, then walks ``dsas.assets.{photos,videos,
audios,texts,chatlogs}`` and downloads every asset into:

    training/workspace/<tokenId>/raw/{photos,videos,audios,texts,chatlogs}/

Idempotent — already-downloaded files are skipped unless ``--force``.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

# Allow `python pipelines/01_fetch_assets.py` direct invocation.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    download,
    fetch_chain_metadata,
    get_logger,
    ipfs_to_https,
    load_env,
    url_basename,
    workspace_dir,
    write_json,
)

ASSET_KINDS = ("photos", "videos", "audios", "texts", "chatlogs")


def _safe_basename(uri: str, fallback_ext: str = "") -> str:
    name = url_basename(uri)
    if "." not in name and fallback_ext:
        name = f"{name}{fallback_ext}"
    return name


def _download_simple_list(
    uris: list[str],
    dest_dir: Path,
    gateway: str,
    *,
    force: bool,
    logger,
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for uri in uris:
        if not isinstance(uri, str) or not uri:
            continue
        url = ipfs_to_https(uri, gateway)
        local = dest_dir / _safe_basename(uri)
        download(url, local, force=force, logger=logger)
        out.append({"uri": uri, "path": str(local.relative_to(dest_dir.parents[1]))})
    return out


def _download_chatlogs(
    chatlogs: list[Any],
    dest_dir: Path,
    gateway: str,
    *,
    force: bool,
    logger,
) -> list[dict[str, str]]:
    """Chatlog entries are objects: {platform, uri, format}."""
    out: list[dict[str, str]] = []
    for i, entry in enumerate(chatlogs or []):
        if not isinstance(entry, dict):
            continue
        uri = entry.get("uri")
        if not uri:
            continue
        platform = entry.get("platform", "unknown")
        fmt = entry.get("format", "json")
        url = ipfs_to_https(uri, gateway)
        # Prefix with platform + index so we never collide.
        base = _safe_basename(uri, fallback_ext=f".{fmt}")
        local = dest_dir / f"{platform}-{i:02d}-{base}"
        download(url, local, force=force, logger=logger)
        out.append({
            "uri": uri,
            "platform": platform,
            "format": fmt,
            "path": str(local.relative_to(dest_dir.parents[1])),
        })
    return out


def main(argv: list[str] | None = None) -> int:
    load_env()

    parser = argparse.ArgumentParser(description="Fetch tablet NFT assets to workspace.")
    parser.add_argument("--token-id", required=True, type=int, help="ERC-721 tokenId")
    parser.add_argument("--rpc", default=os.getenv("RPC_URL"), help="EVM RPC URL")
    parser.add_argument(
        "--contract", default=os.getenv("CONTRACT_ADDRESS"),
        help="DigitalTablet contract address",
    )
    parser.add_argument(
        "--gateway", default=os.getenv("IPFS_GATEWAY"),
        help="IPFS HTTPS gateway (rewrites ipfs:// URIs)",
    )
    parser.add_argument("--force", action="store_true", help="re-download existing files")
    args = parser.parse_args(argv)

    ws = workspace_dir(args.token_id)
    logger = get_logger("01_fetch_assets", ws / "fetch.log")
    logger.info("=== fetch_assets tokenId=%s ===", args.token_id)

    # 1. Read metadata from chain + IPFS.
    metadata = fetch_chain_metadata(
        args.token_id, args.rpc, args.contract,
        gateway=args.gateway, logger=logger,
    )
    write_json(ws / "metadata.json", metadata)

    # 2. Walk dsas.assets and pull every URI to local raw/.
    raw_root = ws / "raw"
    for kind in ASSET_KINDS:
        (raw_root / kind).mkdir(parents=True, exist_ok=True)

    dsas = metadata.get("dsas") or {}
    assets = dsas.get("assets") or {}

    fetched: dict[str, list[dict[str, str]]] = {k: [] for k in ASSET_KINDS}

    for kind in ("photos", "videos", "audios", "texts"):
        items = assets.get(kind) or []
        if not isinstance(items, list):
            logger.warning("dsas.assets.%s is not a list, skipping", kind)
            continue
        fetched[kind] = _download_simple_list(
            items, raw_root / kind, args.gateway,
            force=args.force, logger=logger,
        )

    fetched["chatlogs"] = _download_chatlogs(
        assets.get("chatlogs") or [], raw_root / "chatlogs", args.gateway,
        force=args.force, logger=logger,
    )

    # Portrait is special — drop it under photos/ as well so LoRA training sees it.
    portrait_uri = assets.get("portrait")
    if isinstance(portrait_uri, str) and portrait_uri:
        url = ipfs_to_https(portrait_uri, args.gateway)
        local = raw_root / "photos" / f"portrait-{_safe_basename(portrait_uri)}"
        download(url, local, force=args.force, logger=logger)
        fetched["photos"].append({
            "uri": portrait_uri,
            "path": str(local.relative_to(ws)),
            "role": "portrait",
        })

    # 3. Manifest of what we fetched.
    manifest = {
        "tokenId": args.token_id,
        "tokenURI": metadata.get("_tokenURI"),
        "name": metadata.get("name"),
        "fetched": fetched,
        "counts": {k: len(v) for k, v in fetched.items()},
    }
    write_json(ws / "manifest.fetched.json", manifest)
    logger.info("fetch complete: %s", manifest["counts"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
