"""
Shared utilities for the DSAS off-line training pipeline.

Used by all 01_*..07_*.py scripts. Keep this module dependency-light —
heavy ML imports MUST live in the scripts that need them, not here, so the
stubs work on a vanilla Python install.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# repo root = two levels up from this file: training/pipelines/_common.py
REPO_ROOT: Path = Path(__file__).resolve().parents[2]
TRAINING_ROOT: Path = REPO_ROOT / "training"
WORKSPACE_ROOT: Path = TRAINING_ROOT / "workspace"


def load_env() -> None:
    """Load `.env` from the repo root. Idempotent; safe to call multiple times."""
    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path, override=False)
    else:
        # Fall back to default search; users may export vars another way.
        load_dotenv(override=False)


def workspace_dir(token_id: int | str) -> Path:
    """Return (and ensure existence of) ``training/workspace/<tokenId>/``."""
    p = WORKSPACE_ROOT / str(token_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


def get_logger(name: str, log_file: Optional[Path] = None) -> logging.Logger:
    """Return a logger that writes to stdout and (optionally) a file.

    Calling repeatedly with the same name reuses the existing logger —
    handlers are only attached once.
    """
    logger = logging.getLogger(name)
    if getattr(logger, "_dsas_configured", False):
        return logger

    logger.setLevel(logging.INFO)
    formatter = logging.Formatter(_LOG_FORMAT)

    sh = logging.StreamHandler(stream=sys.stdout)
    sh.setFormatter(formatter)
    logger.addHandler(sh)

    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(formatter)
        logger.addHandler(fh)

    logger._dsas_configured = True  # type: ignore[attr-defined]
    return logger


# ---------------------------------------------------------------------------
# IPFS / HTTP helpers
# ---------------------------------------------------------------------------

DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/"


def ipfs_to_https(uri: str, gateway: Optional[str] = None) -> str:
    """Rewrite ``ipfs://<cid>[/path]`` to an HTTPS gateway URL.

    Other schemes (https://, ar://, http://) are returned untouched, except
    that ``ar://`` is rewritten to the Arweave gateway from env / default.
    """
    gw = gateway or os.getenv("IPFS_GATEWAY") or DEFAULT_IPFS_GATEWAY
    if not gw.endswith("/"):
        gw = gw + "/"

    if uri.startswith("ipfs://"):
        rest = uri[len("ipfs://") :]
        # Some tools emit `ipfs://ipfs/<cid>` — strip the redundant prefix.
        if rest.startswith("ipfs/"):
            rest = rest[len("ipfs/") :]
        return gw + rest

    if uri.startswith("ar://"):
        ar_gw = os.getenv("ARWEAVE_GATEWAY", "https://arweave.net").rstrip("/")
        return f"{ar_gw}/{uri[len('ar://'):]}"

    return uri


def download(
    url: str,
    dest: Path,
    *,
    force: bool = False,
    retries: int = 3,
    backoff: float = 2.0,
    timeout: int = 60,
    chunk_size: int = 1 << 16,
    logger: Optional[logging.Logger] = None,
) -> Path:
    """Download ``url`` to ``dest`` with retry + idempotent skip.

    If ``dest`` already exists and ``force`` is False, the function returns
    immediately. Streamed in chunks so large media don't blow memory.
    """
    log = logger or logging.getLogger("download")
    dest.parent.mkdir(parents=True, exist_ok=True)

    if dest.exists() and not force:
        log.info("skip (exists): %s", dest)
        return dest

    last_err: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            with requests.get(url, stream=True, timeout=timeout) as r:
                r.raise_for_status()
                tmp = dest.with_suffix(dest.suffix + ".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=chunk_size):
                        if chunk:
                            f.write(chunk)
                tmp.replace(dest)
            log.info("downloaded: %s (%d bytes)", dest, dest.stat().st_size)
            return dest
        except Exception as exc:  # noqa: BLE001 — broad on purpose for retry
            last_err = exc
            wait = backoff ** attempt
            log.warning(
                "download failed (attempt %d/%d) for %s: %s — retry in %.1fs",
                attempt, retries, url, exc, wait,
            )
            time.sleep(wait)

    raise RuntimeError(f"download failed after {retries} attempts: {url}") from last_err


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

def compute_sha256(path: Path, chunk_size: int = 1 << 20) -> str:
    """Return the lower-case hex sha256 digest of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Chain access (web3.py)
# ---------------------------------------------------------------------------

# Minimal ABI fragments — the prototype only needs three functions.
TABLET_ABI: list[dict[str, Any]] = [
    {
        "name": "tokenURI",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "string"}],
    },
    {
        "name": "artifactURI",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "string"}],
    },
    {
        "name": "setArtifactURI",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "tokenId", "type": "uint256"},
            {"name": "uri", "type": "string"},
        ],
        "outputs": [],
    },
]


def _require(value: Optional[str], var: str) -> str:
    if not value:
        raise SystemExit(
            f"missing required value: {var}. Set it in .env or pass via CLI flag."
        )
    return value


def get_web3(rpc_url: Optional[str] = None):
    """Return a connected ``Web3`` instance. Imports web3 lazily."""
    from web3 import Web3  # local import keeps module light when unused

    url = _require(rpc_url or os.getenv("RPC_URL"), "RPC_URL")
    w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        raise SystemExit(f"web3: cannot connect to {url}")
    return w3


def get_contract(
    rpc_url: Optional[str] = None,
    contract_addr: Optional[str] = None,
):
    """Return a ``(w3, contract)`` tuple for the DigitalTablet contract."""
    from web3 import Web3  # local import

    w3 = get_web3(rpc_url)
    addr = _require(contract_addr or os.getenv("CONTRACT_ADDRESS"), "CONTRACT_ADDRESS")
    checksum = Web3.to_checksum_address(addr)
    return w3, w3.eth.contract(address=checksum, abi=TABLET_ABI)


def fetch_chain_metadata(
    token_id: int,
    rpc_url: Optional[str] = None,
    contract_addr: Optional[str] = None,
    *,
    gateway: Optional[str] = None,
    logger: Optional[logging.Logger] = None,
) -> dict:
    """Read ``tokenURI(tokenId)`` from chain, fetch the JSON, and return it.

    Returns a dict with one extra key, ``_tokenURI``, recording the on-chain
    URI so callers can persist it for provenance.
    """
    log = logger or logging.getLogger("chain")
    _w3, contract = get_contract(rpc_url, contract_addr)

    token_uri: str = contract.functions.tokenURI(int(token_id)).call()
    log.info("tokenURI(%s) = %s", token_id, token_uri)
    if not token_uri:
        raise RuntimeError(f"empty tokenURI for tokenId={token_id}")

    https_url = ipfs_to_https(token_uri, gateway)
    log.info("fetching metadata from %s", https_url)
    resp = requests.get(https_url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    data["_tokenURI"] = token_uri
    return data


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def write_json(path: Path, obj: Any, *, indent: int = 2) -> None:
    """UTF-8 JSON write with parent-dir mkdir + atomic replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
    tmp.replace(path)


def read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------

def url_basename(url: str) -> str:
    """Best-effort basename for an `ipfs://` or http(s) URL — for naming files locally."""
    parsed = urlparse(url)
    path = parsed.path or ""
    if not path or path.endswith("/"):
        # Use last path segment of the netloc (CID for ipfs URIs)
        return parsed.netloc or "asset"
    return os.path.basename(path) or (parsed.netloc or "asset")
