"""Thin web3.py helper for reading DigitalTablet contract state.

Only the read-side surface needed by the inference service is wired up here;
write paths (mint / setArtifactURI) live in the line-off training script and
the application backend.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from web3 import Web3

from .config import get_settings

# Minimal ABI: only the views the compute service needs.
_ABI: list[dict[str, Any]] = [
    {
        "name": "ownerOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "address"}],
    },
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
    # Convenience getter alias — the contract may expose either a public mapping
    # `artifactURI(uint256)` or an explicit `getArtifactURI(uint256)`. We try both.
    {
        "name": "getArtifactURI",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "string"}],
    },
]


@lru_cache(maxsize=1)
def _w3() -> Web3:
    settings = get_settings()
    return Web3(Web3.HTTPProvider(settings.rpc_url))


@lru_cache(maxsize=1)
def _contract():
    settings = get_settings()
    w3 = _w3()
    return w3.eth.contract(
        address=Web3.to_checksum_address(settings.contract_address),
        abi=_ABI,
    )


def get_owner(token_id: int) -> str:
    """Return the address that currently owns ``token_id`` (checksummed)."""
    return _contract().functions.ownerOf(token_id).call()


def get_token_uri(token_id: int) -> str:
    """Return the ERC-721 ``tokenURI`` (typically ``ipfs://<cid>``)."""
    return _contract().functions.tokenURI(token_id).call()


def get_artifact_uri(token_id: int) -> str:
    """Return the AI artifact manifest URI written by the trainer.

    Tries ``artifactURI(tokenId)`` first; falls back to ``getArtifactURI`` if
    the contract uses an explicit getter.
    """
    contract = _contract()
    try:
        return contract.functions.artifactURI(token_id).call()
    except Exception:  # pragma: no cover - depends on deployed contract shape
        return contract.functions.getArtifactURI(token_id).call()
