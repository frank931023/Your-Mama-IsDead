"""Per-tokenId artifact cache.

Lazy: nothing is fetched until ``load(token_id)`` is called.
LRU + TTL: at most ``cache_max_personas`` entries; entries idle longer than
``cache_ttl_seconds`` are evicted on access. On eviction the in-memory entry is
dropped but the on-disk files are kept (the chain remains the source of truth,
re-download is cheap).

This implements the §5.4 strategy: lazy-load on first interaction, GC after
the SSE connection has been idle.
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from . import chain, ipfs
from .config import get_settings


# ---------------------------------------------------------------------------
# Data shape
# ---------------------------------------------------------------------------


@dataclass
class PersonaArtifacts:
    """Resolved on-disk artifact bundle for one tokenId."""

    token_id: int
    manifest: dict[str, Any]
    lora_path: Path | None
    voice_path: Path | None
    rag_index_path: Path | None
    rag_embeddings: np.ndarray | None = None  # (N, D) cosine-normalised, optional
    rag_chunks: list[dict[str, Any]] = field(default_factory=list)
    last_access: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.last_access = time.monotonic()


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


class PersonaCache:
    """Thread-safe LRU cache of :class:`PersonaArtifacts` keyed by tokenId."""

    def __init__(
        self,
        cache_dir: Path | None = None,
        ttl_seconds: int | None = None,
        max_personas: int | None = None,
    ) -> None:
        s = get_settings()
        self._dir: Path = Path(cache_dir or s.cache_dir)
        self._ttl: int = ttl_seconds if ttl_seconds is not None else s.cache_ttl_seconds
        self._max: int = max_personas if max_personas is not None else s.cache_max_personas
        self._dir.mkdir(parents=True, exist_ok=True)

        self._entries: OrderedDict[int, PersonaArtifacts] = OrderedDict()
        self._global_lock = asyncio.Lock()
        self._token_locks: dict[int, asyncio.Lock] = {}

    # -- public API ---------------------------------------------------------

    async def get(self, token_id: int) -> PersonaArtifacts | None:
        """Return cached artifacts if fresh, else ``None``. Does not fetch."""
        async with self._global_lock:
            self._evict_stale_locked()
            entry = self._entries.get(token_id)
            if entry is None:
                return None
            entry.touch()
            self._entries.move_to_end(token_id)
            return entry

    async def load(self, token_id: int) -> PersonaArtifacts:
        """Return artifacts, fetching from chain + IPFS if not cached.

        Per-tokenId lock so concurrent requests for the same NFT don't trigger
        duplicate downloads.
        """
        # Fast path
        cached = await self.get(token_id)
        if cached is not None:
            return cached

        lock = await self._lock_for(token_id)
        async with lock:
            cached = await self.get(token_id)
            if cached is not None:
                return cached

            artifacts = await self._fetch(token_id)

            async with self._global_lock:
                self._entries[token_id] = artifacts
                self._entries.move_to_end(token_id)
                self._enforce_capacity_locked()

            return artifacts

    async def evict(self, token_id: int) -> None:
        async with self._global_lock:
            self._entries.pop(token_id, None)

    async def clear(self) -> None:
        async with self._global_lock:
            self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)

    # -- internals ----------------------------------------------------------

    async def _lock_for(self, token_id: int) -> asyncio.Lock:
        async with self._global_lock:
            lock = self._token_locks.get(token_id)
            if lock is None:
                lock = asyncio.Lock()
                self._token_locks[token_id] = lock
            return lock

    def _evict_stale_locked(self) -> None:
        now = time.monotonic()
        stale = [tid for tid, e in self._entries.items() if now - e.last_access > self._ttl]
        for tid in stale:
            self._entries.pop(tid, None)

    def _enforce_capacity_locked(self) -> None:
        while len(self._entries) > self._max:
            self._entries.popitem(last=False)  # drop least-recently-used

    async def _fetch(self, token_id: int) -> PersonaArtifacts:
        """Resolve manifest from chain, then download referenced artifacts."""
        artifact_uri = await asyncio.to_thread(chain.get_artifact_uri, token_id)
        if not artifact_uri:
            raise ValueError(f"Token {token_id} has no artifactURI set on-chain")

        manifest = await ipfs.fetch_json(artifact_uri)

        token_dir = self._dir / str(token_id)
        token_dir.mkdir(parents=True, exist_ok=True)

        models = manifest.get("models", {}) or {}
        lora_path = await self._maybe_fetch(models.get("lora"), token_dir / "lora.safetensors")
        voice_path = await self._maybe_fetch(models.get("voice"), token_dir / "voice.bin")
        rag_path = await self._maybe_fetch(models.get("rag"), token_dir / "rag.json")

        rag_embeddings, rag_chunks = self._load_rag(rag_path) if rag_path else (None, [])

        return PersonaArtifacts(
            token_id=token_id,
            manifest=manifest,
            lora_path=lora_path,
            voice_path=voice_path,
            rag_index_path=rag_path,
            rag_embeddings=rag_embeddings,
            rag_chunks=rag_chunks,
        )

    @staticmethod
    async def _maybe_fetch(model_block: dict[str, Any] | None, dest: Path) -> Path | None:
        if not model_block:
            return None
        uri = model_block.get("uri")
        if not uri:
            return None
        if dest.exists():
            return dest
        data = await ipfs.fetch_bytes(uri)
        dest.write_bytes(data)
        return dest

    @staticmethod
    def _load_rag(path: Path) -> tuple[np.ndarray | None, list[dict[str, Any]]]:
        """Read a RAG index produced by training step 05.

        Expected JSON shape::

            {
              "model": "multilingual-e5-large",
              "chunks": [
                {"text": "...", "metadata": {...}, "embedding": [..floats..]},
                ...
              ]
            }
        """
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None, []

        chunks_raw = obj.get("chunks", []) or []
        if not chunks_raw:
            return None, []

        embeddings: list[list[float]] = []
        chunks: list[dict[str, Any]] = []
        for ch in chunks_raw:
            emb = ch.get("embedding")
            if emb is None:
                continue
            embeddings.append(emb)
            chunks.append({"text": ch.get("text", ""), "metadata": ch.get("metadata", {})})

        if not embeddings:
            return None, chunks

        mat = np.asarray(embeddings, dtype=np.float32)
        # L2-normalise for cosine via dot product
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        mat = mat / norms
        return mat, chunks


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_singleton: PersonaCache | None = None


def get_cache() -> PersonaCache:
    global _singleton
    if _singleton is None:
        _singleton = PersonaCache()
    return _singleton
