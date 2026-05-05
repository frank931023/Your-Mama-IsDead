"""
07_upload_artifact.py — pin artifact pieces to IPFS and call setArtifactURI on chain.

  python pipelines/07_upload_artifact.py --token-id 42 --network sepolia

Steps:
  1. Pin each top-level piece (lora/, voice/, rag/) to Pinata. We tar each
     directory on the fly so each piece is one CID — easier to fetch later.
  2. Update workspace/<id>/dist/manifest.json with returned ipfs:// URIs.
  3. Pin the updated manifest JSON (pinJSONToIPFS).
  4. Call DigitalTablet.setArtifactURI(tokenId, "ipfs://<manifest-cid>")
     using TRAINER_PRIVATE_KEY.

Prints the final tx hash and the manifest URI.
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import tarfile
import time
from pathlib import Path
from typing import Any, Optional

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    TABLET_ABI,
    get_logger,
    get_web3,
    load_env,
    read_json,
    workspace_dir,
    write_json,
)

PINATA_PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS"
PINATA_PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS"


# ---------------------------------------------------------------------------
# Pinata helpers
# ---------------------------------------------------------------------------

def _tar_gz_dir(src_dir: Path) -> bytes:
    """Tar+gzip a directory into an in-memory bytes blob."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(src_dir, arcname=src_dir.name)
    return buf.getvalue()


def _pinata_pin_file(
    name: str, blob: bytes, jwt: str, *, content_type: str = "application/gzip", logger,
) -> str:
    headers = {"Authorization": f"Bearer {jwt}"}
    files = {"file": (name, blob, content_type)}
    # Pinata accepts options as multipart fields too.
    data = {"pinataMetadata": '{"name":"' + name + '"}'}
    logger.info("pin file → %s (%d bytes)", name, len(blob))
    resp = requests.post(
        PINATA_PIN_FILE_URL, headers=headers, files=files, data=data, timeout=300,
    )
    if not resp.ok:
        raise RuntimeError(f"Pinata pinFile failed [{resp.status_code}]: {resp.text}")
    cid = resp.json().get("IpfsHash")
    if not cid:
        raise RuntimeError(f"Pinata pinFile returned no CID: {resp.text}")
    logger.info("  → ipfs://%s", cid)
    return cid


def _pinata_pin_json(name: str, payload: Any, jwt: str, *, logger) -> str:
    headers = {
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
    }
    body = {
        "pinataMetadata": {"name": name},
        "pinataContent": payload,
    }
    logger.info("pin json → %s", name)
    resp = requests.post(PINATA_PIN_JSON_URL, headers=headers, json=body, timeout=120)
    if not resp.ok:
        raise RuntimeError(f"Pinata pinJSON failed [{resp.status_code}]: {resp.text}")
    cid = resp.json().get("IpfsHash")
    if not cid:
        raise RuntimeError(f"Pinata pinJSON returned no CID: {resp.text}")
    logger.info("  → ipfs://%s", cid)
    return cid


# ---------------------------------------------------------------------------
# On-chain
# ---------------------------------------------------------------------------

def _set_artifact_uri(
    *,
    rpc_url: Optional[str],
    contract_addr: Optional[str],
    private_key: str,
    token_id: int,
    manifest_uri: str,
    logger,
) -> str:
    from web3 import Web3

    w3 = get_web3(rpc_url)
    addr = contract_addr or os.getenv("CONTRACT_ADDRESS")
    if not addr:
        raise SystemExit("CONTRACT_ADDRESS not set")
    contract = w3.eth.contract(address=Web3.to_checksum_address(addr), abi=TABLET_ABI)

    if not private_key.startswith("0x"):
        private_key = "0x" + private_key
    acct = w3.eth.account.from_key(private_key)
    sender = acct.address
    logger.info("signer: %s", sender)

    nonce = w3.eth.get_transaction_count(sender)
    chain_id = int(os.getenv("CHAIN_ID") or w3.eth.chain_id)

    fn = contract.functions.setArtifactURI(int(token_id), manifest_uri)
    # Best-effort gas estimate; fall back to a generous default if the node refuses.
    try:
        gas_est = fn.estimate_gas({"from": sender})
        gas = int(gas_est * 1.2)
    except Exception as exc:  # noqa: BLE001
        logger.warning("gas estimate failed (%s) — using fallback 200000", exc)
        gas = 200_000

    tx = fn.build_transaction({
        "from": sender,
        "nonce": nonce,
        "chainId": chain_id,
        "gas": gas,
        "maxFeePerGas": w3.to_wei("30", "gwei"),
        "maxPriorityFeePerGas": w3.to_wei("2", "gwei"),
    })
    signed = acct.sign_transaction(tx)
    raw = getattr(signed, "rawTransaction", None) or getattr(signed, "raw_transaction", None)
    tx_hash = w3.eth.send_raw_transaction(raw)
    tx_hex = tx_hash.hex()
    logger.info("tx sent: %s — waiting for receipt…", tx_hex)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
    if receipt.status != 1:
        raise RuntimeError(f"setArtifactURI tx reverted: {tx_hex}")
    logger.info("tx confirmed in block %s", receipt.blockNumber)
    return tx_hex


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Upload artifact + write URI on chain.")
    parser.add_argument("--token-id", required=True, type=int)
    parser.add_argument("--version", default="v1")
    parser.add_argument(
        "--signer", default=os.getenv("TRAINER_PRIVATE_KEY"),
        help="hex private key (defaults to TRAINER_PRIVATE_KEY env)",
    )
    parser.add_argument("--network", default=os.getenv("CHAIN_NAME", "sepolia"))
    parser.add_argument("--rpc", default=os.getenv("RPC_URL"))
    parser.add_argument("--contract", default=os.getenv("CONTRACT_ADDRESS"))
    parser.add_argument("--gateway", default=os.getenv("IPFS_GATEWAY"))
    parser.add_argument(
        "--pinata-jwt", default=os.getenv("PINATA_JWT"),
        help="Pinata JWT (defaults to PINATA_JWT env)",
    )
    parser.add_argument(
        "--skip-chain", action="store_true",
        help="upload to IPFS but do not call setArtifactURI",
    )
    args = parser.parse_args(argv)

    ws = workspace_dir(args.token_id)
    logger = get_logger("07_upload_artifact", ws / "dist" / "upload.log")
    logger.info("=== upload_artifact tokenId=%s network=%s ===", args.token_id, args.network)

    if not args.pinata_jwt:
        raise SystemExit("PINATA_JWT not set (pass --pinata-jwt or set in .env)")

    manifest_path = ws / "dist" / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"missing manifest: {manifest_path}. Run 06_package_artifact.py first.")
    manifest = read_json(manifest_path)

    # 1. Pin each piece (lora/, voice/, rag/) as a tar.gz.
    pieces = [
        ("lora", ws / "lora"),
        ("voice", ws / "voice"),
        ("rag", ws / "rag"),
    ]
    for key, path in pieces:
        if not path.exists():
            logger.warning("piece dir missing: %s — skipping", path)
            continue
        # Skip if already uploaded (idempotency).
        existing = (manifest.get("models") or {}).get(key, {}).get("uri")
        if existing:
            logger.info("  %s already pinned at %s — skipping", key, existing)
            continue
        blob = _tar_gz_dir(path)
        cid = _pinata_pin_file(f"dsas-{args.token_id}-{key}-{args.version}.tar.gz",
                               blob, args.pinata_jwt, logger=logger)
        manifest.setdefault("models", {}).setdefault(key, {})["uri"] = f"ipfs://{cid}"

    # Re-write the manifest with URIs filled.
    write_json(manifest_path, manifest)
    logger.info("manifest with URIs → %s", manifest_path)

    # 2. Pin the manifest JSON itself.
    manifest_cid = _pinata_pin_json(
        f"dsas-{args.token_id}-manifest-{args.version}.json",
        manifest, args.pinata_jwt, logger=logger,
    )
    manifest_uri = f"ipfs://{manifest_cid}"

    # Persist the manifest URI alongside the manifest for visibility.
    write_json(ws / "dist" / "manifest.uri.json", {
        "tokenId": args.token_id,
        "manifestURI": manifest_uri,
        "uploadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })

    # 3. Call setArtifactURI on chain.
    if args.skip_chain:
        logger.info("--skip-chain set, not writing to chain.")
        print(f"manifest URI: {manifest_uri}")
        return 0

    if not args.signer:
        raise SystemExit("TRAINER_PRIVATE_KEY not set (pass --signer or env)")

    tx_hex = _set_artifact_uri(
        rpc_url=args.rpc,
        contract_addr=args.contract,
        private_key=args.signer,
        token_id=args.token_id,
        manifest_uri=manifest_uri,
        logger=logger,
    )

    print(f"manifest URI : {manifest_uri}")
    print(f"tx hash      : {tx_hex}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
