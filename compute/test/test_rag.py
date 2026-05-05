"""Sanity checks for RAGEngine retrieval + prompt assembly.

The heavy sentence-transformers model is monkey-patched out so these tests
run in milliseconds with no network access.
"""
from __future__ import annotations

import numpy as np

from app.services import rag_engine
from app.services.rag_engine import RAGEngine


def _normalise(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n else v


def _make_engine(monkeypatch) -> RAGEngine:
    """Build a tiny in-memory index with a stubbed embedder.

    We use 3-D handcrafted vectors so we can verify which chunk wins by hand:

        chunk 0  -> "I taught math at the village school for forty years."
                   query about teaching should hit this.
        chunk 1  -> "I loved fishing on weekends near the harbor."
        chunk 2  -> "My grandson was born the spring of 2010."
    """
    chunks = [
        {"text": "I taught math at the village school for forty years.", "metadata": {"id": 0}},
        {"text": "I loved fishing on weekends near the harbor.", "metadata": {"id": 1}},
        {"text": "My grandson was born the spring of 2010.", "metadata": {"id": 2}},
    ]
    raw_embeddings = np.array(
        [
            [1.0, 0.0, 0.0],  # teaching axis
            [0.0, 1.0, 0.0],  # fishing axis
            [0.0, 0.0, 1.0],  # family axis
        ],
        dtype=np.float32,
    )
    embeddings = raw_embeddings / np.linalg.norm(raw_embeddings, axis=1, keepdims=True)

    # Map keywords in the query to one of the axes so retrieve() is deterministic.
    keyword_axis = {
        "teach": np.array([1.0, 0.0, 0.0], dtype=np.float32),
        "school": np.array([1.0, 0.0, 0.0], dtype=np.float32),
        "math": np.array([1.0, 0.0, 0.0], dtype=np.float32),
        "fish": np.array([0.0, 1.0, 0.0], dtype=np.float32),
        "harbor": np.array([0.0, 1.0, 0.0], dtype=np.float32),
        "grandson": np.array([0.0, 0.0, 1.0], dtype=np.float32),
        "born": np.array([0.0, 0.0, 1.0], dtype=np.float32),
    }

    class _StubModel:
        def encode(self, text, normalize_embeddings=True, convert_to_numpy=True):
            t = text.lower()
            vec = np.zeros(3, dtype=np.float32)
            for kw, axis in keyword_axis.items():
                if kw in t:
                    vec = vec + axis
            if not vec.any():
                vec = np.array([0.33, 0.33, 0.33], dtype=np.float32)
            return _normalise(vec)

    # Bypass the real sentence-transformers download.
    monkeypatch.setattr(rag_engine, "_get_embed_model", lambda name: _StubModel())

    return RAGEngine(embeddings=embeddings, chunks=chunks)


def test_retrieve_ranks_correct_chunk_first(monkeypatch) -> None:
    engine = _make_engine(monkeypatch)

    hits = engine.retrieve("Where did you teach math?", top_k=3)

    assert len(hits) == 3
    assert hits[0]["metadata"]["id"] == 0  # teaching wins
    # Cosine score should be ~1 for the perfect axis-aligned match.
    assert hits[0]["score"] > 0.99
    # Other hits should be strictly lower.
    assert hits[0]["score"] > hits[1]["score"]


def test_retrieve_other_topic(monkeypatch) -> None:
    engine = _make_engine(monkeypatch)

    hits = engine.retrieve("Tell me about your grandson born in 2010.", top_k=2)

    assert hits[0]["metadata"]["id"] == 2


def test_retrieve_empty_index_returns_empty_list() -> None:
    engine = RAGEngine(embeddings=None, chunks=[])
    assert engine.retrieve("anything", top_k=5) == []


def test_build_prompt_shape() -> None:
    retrieved = [
        {"text": "I taught math.", "metadata": {}, "score": 0.99},
        {"text": "I loved fishing.", "metadata": {}, "score": 0.4},
    ]
    history = [
        {"role": "user", "content": "Hi grandpa."},
        {"role": "assistant", "content": "Hello, child."},
    ]
    msgs = RAGEngine.build_prompt(
        deceased_name="Wang Da-ming",
        retrieved=retrieved,
        history=history,
        message="What did you teach?",
    )

    assert msgs[0]["role"] == "system"
    assert "Wang Da-ming" in msgs[0]["content"]
    assert "I taught math." in msgs[0]["content"]
    assert msgs[1] == {"role": "user", "content": "Hi grandpa."}
    assert msgs[2] == {"role": "assistant", "content": "Hello, child."}
    assert msgs[-1] == {"role": "user", "content": "What did you teach?"}


def test_build_prompt_no_memory() -> None:
    msgs = RAGEngine.build_prompt(
        deceased_name="Anon",
        retrieved=[],
        history=[],
        message="Hello.",
    )
    assert "(no memory available)" in msgs[0]["content"]
