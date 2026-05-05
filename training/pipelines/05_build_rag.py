"""
05_build_rag.py — build the RAG index from texts + chatlogs.

  python pipelines/05_build_rag.py --token-id 42

★ This step is FULLY IMPLEMENTED (no stub) — sentence-transformers is light
enough to run on CPU and the resulting index is the smallest, most useful
artifact for the prototype's chat experience.

Reads:
  workspace/<id>/raw/texts/*.txt
  workspace/<id>/raw/chatlogs/*.json     (unified DSAS schema OR raw export)
  workspace/<id>/raw/chatlogs/*.txt      (raw line/whatsapp dumps)

Writes:
  workspace/<id>/rag/index.json   { model, chunks: [{id, text, embedding[], source}] }
  workspace/<id>/rag/embeddings.npy   (matrix mirror of embeddings, faster to load)

If sentence-transformers is unavailable, a deterministic 384-dim
hash-embedding stub is used (logged as a warning).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Iterator

import numpy as np
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import get_logger, load_env, read_json, workspace_dir, write_json  # noqa: E402

DEFAULT_EMBED = "sentence-transformers/multilingual-e5-large"


# ---------------------------------------------------------------------------
# Document collection
# ---------------------------------------------------------------------------

def _iter_text_files(text_dir: Path) -> Iterator[tuple[Path, str]]:
    if not text_dir.exists():
        return
    for path in sorted(text_dir.rglob("*.txt")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except UnicodeDecodeError:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        if content.strip():
            yield path, content


def _flatten_unified_chatlog(payload: dict[str, Any]) -> str:
    """Convert a DSAS-unified chatlog ({platform, participants, messages}) to
    a single document with one line per message."""
    deceased = payload.get("deceasedName")
    lines: list[str] = []
    platform = payload.get("platform", "chat")
    if deceased:
        lines.append(f"[platform={platform}, deceased={deceased}]")
    else:
        lines.append(f"[platform={platform}]")
    for msg in payload.get("messages", []) or []:
        if not isinstance(msg, dict):
            continue
        ts = msg.get("ts", "")
        who = msg.get("from", "?")
        text = (msg.get("text") or "").strip()
        if not text:
            continue
        lines.append(f"{ts} {who}: {text}")
    return "\n".join(lines)


def _iter_chatlog_files(chat_dir: Path) -> Iterator[tuple[Path, str]]:
    if not chat_dir.exists():
        return
    for path in sorted(chat_dir.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix == ".json":
            try:
                payload = read_json(path)
            except Exception:  # noqa: BLE001
                continue
            # Sniff: unified schema has "messages" key.
            if isinstance(payload, dict) and "messages" in payload:
                content = _flatten_unified_chatlog(payload)
            else:
                # Raw export: serialize the JSON back to a string so embeddings still work.
                content = json.dumps(payload, ensure_ascii=False, indent=2)
            if content.strip():
                yield path, content
        elif suffix == ".txt":
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
            except UnicodeDecodeError:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
            if content.strip():
                yield path, content


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def _chunk_text(text: str, chunk_size: int, overlap: int, min_chars: int = 32) -> list[str]:
    """Sliding-window character chunking. Simple, stable, and language-agnostic.

    chunk_size / overlap are interpreted as character counts here so the same
    code works for CJK and Latin scripts without a tokenizer dependency.
    """
    text = text.strip()
    if len(text) <= chunk_size:
        return [text] if len(text) >= min_chars else []
    if overlap >= chunk_size:
        overlap = max(0, chunk_size // 4)

    step = chunk_size - overlap
    chunks: list[str] = []
    i = 0
    while i < len(text):
        piece = text[i : i + chunk_size].strip()
        if len(piece) >= min_chars:
            chunks.append(piece)
        i += step
    return chunks


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def _hash_embed(texts: list[str], dim: int = 384) -> np.ndarray:
    """Deterministic fallback embedder — bag-of-hashed-trigrams projected to ``dim``.

    NOT semantically meaningful; only good enough so downstream code (compute
    service, similarity search) doesn't crash when sentence-transformers is
    missing. A warning is logged when this path is taken.
    """
    out = np.zeros((len(texts), dim), dtype=np.float32)
    for row, t in enumerate(texts):
        s = t.strip().lower()
        # Trigram hashing → bucketed sums.
        for i in range(len(s) - 2):
            tri = s[i : i + 3]
            h = int(hashlib.md5(tri.encode("utf-8")).hexdigest()[:8], 16)
            out[row, h % dim] += 1.0
        # L2-normalise so cosine sim makes sense.
        norm = float(np.linalg.norm(out[row])) or 1.0
        out[row] /= norm
    return out


def _real_embed(model_id: str, texts: list[str], batch_size: int, normalize: bool, logger):
    from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]

    logger.info("loading sentence-transformers model: %s", model_id)
    model = SentenceTransformer(model_id)

    # e5 family expects "passage: " prefix at index time.
    if "e5" in model_id.lower():
        prepared = [f"passage: {t}" for t in texts]
    else:
        prepared = texts

    logger.info("embedding %d chunks (batch_size=%d)", len(texts), batch_size)
    vecs = model.encode(
        prepared,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=normalize,
        convert_to_numpy=True,
    )
    return np.asarray(vecs, dtype=np.float32)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Build RAG index for a tablet.")
    parser.add_argument("--token-id", required=True, type=int)
    parser.add_argument("--embed", default=DEFAULT_EMBED, help="sentence-transformers model id")
    parser.add_argument("--chunk", type=int, default=512, help="chunk size (chars)")
    parser.add_argument("--overlap", type=int, default=64, help="chunk overlap (chars)")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--normalize", action="store_true", default=True)
    parser.add_argument("--force", action="store_true", help="rebuild even if index exists")
    args = parser.parse_args(argv)

    ws = workspace_dir(args.token_id)
    out_dir = ws / "rag"
    out_dir.mkdir(parents=True, exist_ok=True)
    logger = get_logger("05_build_rag", out_dir / "run.log")
    logger.info("=== build_rag tokenId=%s embed=%s chunk=%d overlap=%d ===",
                args.token_id, args.embed, args.chunk, args.overlap)

    index_path = out_dir / "index.json"
    npy_path = out_dir / "embeddings.npy"
    if index_path.exists() and npy_path.exists() and not args.force:
        logger.info("index already exists; pass --force to rebuild. Done.")
        return 0

    # 1. Collect documents.
    raw_root = ws / "raw"
    documents: list[tuple[str, str]] = []  # (source_relpath, content)
    for path, content in _iter_text_files(raw_root / "texts"):
        documents.append((str(path.relative_to(ws)), content))
    for path, content in _iter_chatlog_files(raw_root / "chatlogs"):
        documents.append((str(path.relative_to(ws)), content))

    if not documents:
        logger.warning("no documents found — writing empty index")
        write_json(index_path, {"model": args.embed, "chunks": []})
        np.save(npy_path, np.zeros((0, 0), dtype=np.float32))
        return 0
    logger.info("collected %d documents", len(documents))

    # 2. Chunk.
    chunks: list[dict[str, Any]] = []
    for source, content in tqdm(documents, desc="chunking", unit="doc"):
        for piece in _chunk_text(content, args.chunk, args.overlap):
            chunks.append({"id": len(chunks), "text": piece, "source": source})
    logger.info("produced %d chunks", len(chunks))

    if not chunks:
        write_json(index_path, {"model": args.embed, "chunks": []})
        np.save(npy_path, np.zeros((0, 0), dtype=np.float32))
        return 0

    # 3. Embed.
    texts = [c["text"] for c in chunks]
    try:
        vecs = _real_embed(args.embed, texts, args.batch_size, args.normalize, logger)
        model_used = args.embed
    except ImportError:
        logger.warning(
            "sentence-transformers not installed — falling back to hash-embedding stub. "
            "Install with `pip install sentence-transformers` for a real index."
        )
        vecs = _hash_embed(texts)
        model_used = f"stub-hash-{vecs.shape[1]}d (sentence-transformers missing)"

    # 4. Persist. embeddings.npy is the canonical numeric source; index.json
    # mirrors floats for easy human inspection / standalone use.
    np.save(npy_path, vecs)
    for c, v in zip(chunks, vecs):
        c["embedding"] = [float(x) for x in v.tolist()]

    index_payload = {
        "model": model_used,
        "chunkSize": args.chunk,
        "chunkOverlap": args.overlap,
        "normalize": bool(args.normalize),
        "dim": int(vecs.shape[1]) if vecs.size else 0,
        "count": len(chunks),
        "chunks": chunks,
    }
    write_json(index_path, index_payload)
    logger.info("wrote index → %s (%d chunks, dim=%d)", index_path, len(chunks), vecs.shape[1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
