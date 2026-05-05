"""Tests for PersonaCache LRU + TTL eviction.

Network access (chain RPC, IPFS gateway) is monkey-patched away.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app import cache as cache_mod
from app.cache import PersonaCache


@pytest.fixture
def tmp_cache_dir(tmp_path: Path) -> Path:
    d = tmp_path / "persona_cache"
    d.mkdir()
    return d


def _patch_chain_and_ipfs(monkeypatch, *, manifests: dict[int, dict]) -> dict[str, int]:
    """Make chain.get_artifact_uri and ipfs.fetch_* deterministic.

    Returns a counter dict so tests can assert how many fetches happened.
    """
    counters = {"chain": 0, "json": 0, "bytes": 0}

    def fake_get_artifact_uri(token_id: int) -> str:
        counters["chain"] += 1
        if token_id not in manifests:
            raise ValueError(f"no manifest for {token_id}")
        return f"ipfs://manifest-{token_id}"

    async def fake_fetch_json(uri: str, *, timeout: float = 30.0):
        counters["json"] += 1
        # uri shape: ipfs://manifest-<id>
        token_id = int(uri.rsplit("-", 1)[1])
        return manifests[token_id]

    async def fake_fetch_bytes(uri: str, *, timeout: float = 30.0) -> bytes:
        counters["bytes"] += 1
        # Return a tiny placeholder; for the rag.json case we need valid JSON.
        if "rag" in uri:
            return json.dumps(
                {
                    "model": "stub",
                    "chunks": [
                        {"text": "memory one", "metadata": {}, "embedding": [1.0, 0.0]},
                        {"text": "memory two", "metadata": {}, "embedding": [0.0, 1.0]},
                    ],
                }
            ).encode("utf-8")
        return b"binary-stub"

    monkeypatch.setattr(cache_mod.chain, "get_artifact_uri", fake_get_artifact_uri)
    monkeypatch.setattr(cache_mod.ipfs, "fetch_json", fake_fetch_json)
    monkeypatch.setattr(cache_mod.ipfs, "fetch_bytes", fake_fetch_bytes)
    return counters


def _manifest(token_id: int) -> dict:
    return {
        "tokenId": token_id,
        "version": "v1",
        "createdAt": "2026-05-05T00:00:00Z",
        "models": {
            "lora": {"uri": f"ipfs://lora-{token_id}", "base": "sdxl-1.0", "rank": 16, "steps": 2000},
            "voice": {"uri": f"ipfs://voice-{token_id}", "backend": "gpt-sovits"},
            "rag": {"uri": f"ipfs://rag-{token_id}", "embed": "stub", "chunks": 2, "chunkSize": 100},
        },
        "checksum": "sha256:deadbeef",
    }


@pytest.mark.asyncio
async def test_load_caches_subsequent_reads(monkeypatch, tmp_cache_dir: Path) -> None:
    counters = _patch_chain_and_ipfs(monkeypatch, manifests={1: _manifest(1)})
    cache = PersonaCache(cache_dir=tmp_cache_dir, ttl_seconds=60, max_personas=4)

    a = await cache.load(1)
    b = await cache.load(1)

    assert a is b
    assert a.token_id == 1
    assert a.lora_path is not None and a.lora_path.exists()
    assert a.rag_embeddings is not None and a.rag_embeddings.shape == (2, 2)
    # Only one round-trip per source despite two load() calls.
    assert counters["chain"] == 1
    assert counters["json"] == 1


@pytest.mark.asyncio
async def test_lru_evicts_when_capacity_exceeded(monkeypatch, tmp_cache_dir: Path) -> None:
    manifests = {tid: _manifest(tid) for tid in range(1, 5)}
    _patch_chain_and_ipfs(monkeypatch, manifests=manifests)
    cache = PersonaCache(cache_dir=tmp_cache_dir, ttl_seconds=60, max_personas=2)

    await cache.load(1)
    await cache.load(2)
    assert len(cache) == 2

    await cache.load(3)
    assert len(cache) == 2
    # Token 1 was the oldest, should be gone.
    assert await cache.get(1) is None
    assert await cache.get(2) is not None
    assert await cache.get(3) is not None

    # Touching 2 keeps it fresh; loading 4 should evict 3 (now LRU).
    await cache.get(2)
    await cache.load(4)
    assert await cache.get(3) is None
    assert await cache.get(2) is not None
    assert await cache.get(4) is not None


@pytest.mark.asyncio
async def test_ttl_evicts_stale_entries(monkeypatch, tmp_cache_dir: Path) -> None:
    _patch_chain_and_ipfs(monkeypatch, manifests={1: _manifest(1)})
    cache = PersonaCache(cache_dir=tmp_cache_dir, ttl_seconds=1, max_personas=4)

    entry = await cache.load(1)
    assert await cache.get(1) is entry

    # Rewind the entry's last_access to look stale without sleeping.
    entry.last_access -= 5
    assert await cache.get(1) is None


@pytest.mark.asyncio
async def test_concurrent_loads_dedupe(monkeypatch, tmp_cache_dir: Path) -> None:
    counters = _patch_chain_and_ipfs(monkeypatch, manifests={7: _manifest(7)})
    cache = PersonaCache(cache_dir=tmp_cache_dir, ttl_seconds=60, max_personas=4)

    results = await asyncio.gather(*(cache.load(7) for _ in range(5)))

    first = results[0]
    for r in results[1:]:
        assert r is first
    # Despite five concurrent callers, only one chain round-trip.
    assert counters["chain"] == 1
    assert counters["json"] == 1


@pytest.mark.asyncio
async def test_missing_artifact_uri_raises(monkeypatch, tmp_cache_dir: Path) -> None:
    _patch_chain_and_ipfs(monkeypatch, manifests={})
    cache = PersonaCache(cache_dir=tmp_cache_dir, ttl_seconds=60, max_personas=4)

    with pytest.raises(ValueError):
        await cache.load(999)
