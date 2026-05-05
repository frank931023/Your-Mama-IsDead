"""RAG retrieval + prompt assembly.

The embedding model is loaded lazily on first ``embed()`` call so importing the
module (or running tests with pre-supplied embeddings) doesn't pay the
sentence-transformers boot cost.
"""
from __future__ import annotations

import threading
from typing import Any

import numpy as np

DEFAULT_EMBED_MODEL = "intfloat/multilingual-e5-large"

# Lazy-loaded singleton so multiple RAGEngine instances share weights.
_model_lock = threading.Lock()
_model_cache: dict[str, Any] = {}


def _get_embed_model(name: str) -> Any:
    """Return a (cached) sentence-transformers model for ``name``."""
    with _model_lock:
        cached = _model_cache.get(name)
        if cached is not None:
            return cached
        # Imported lazily to keep cold-start cheap.
        from sentence_transformers import SentenceTransformer  # type: ignore

        model = SentenceTransformer(name)
        _model_cache[name] = model
        return model


class RAGEngine:
    """Retrieval-Augmented Generation helper bound to one persona's index.

    Takes a precomputed ``(N, D)`` cosine-normalised embedding matrix and the
    matching list of chunk dicts (``{"text": ..., "metadata": ...}``).
    """

    def __init__(
        self,
        embeddings: np.ndarray | None,
        chunks: list[dict[str, Any]],
        embed_model: str = DEFAULT_EMBED_MODEL,
    ) -> None:
        self._embeddings = embeddings
        self._chunks = chunks
        self._embed_model_name = embed_model

    # -- embedding ----------------------------------------------------------

    def embed(self, text: str) -> np.ndarray:
        """L2-normalised embedding for ``text`` (1-D float32 array)."""
        model = _get_embed_model(self._embed_model_name)
        # e5-style models expect a "query:" prefix for queries; harmless for others.
        prefixed = text if text.startswith(("query:", "passage:")) else f"query: {text}"
        vec = model.encode(prefixed, normalize_embeddings=True, convert_to_numpy=True)
        return np.asarray(vec, dtype=np.float32)

    # -- retrieval ----------------------------------------------------------

    def retrieve(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Return up to ``top_k`` chunks ranked by cosine similarity.

        Returns ``[]`` if this persona has no RAG index loaded.
        """
        if self._embeddings is None or len(self._chunks) == 0:
            return []

        q = self.embed(query)
        # Embeddings are pre-normalised; query vec normalised by encode(...) above.
        scores = self._embeddings @ q  # (N,)

        k = min(top_k, scores.shape[0])
        # argpartition + sort is O(N + k log k) vs full argsort.
        top_idx = np.argpartition(-scores, kth=k - 1)[:k]
        top_idx = top_idx[np.argsort(-scores[top_idx])]

        return [
            {
                "text": self._chunks[int(i)].get("text", ""),
                "metadata": self._chunks[int(i)].get("metadata", {}),
                "score": float(scores[int(i)]),
            }
            for i in top_idx
        ]

    # -- prompt assembly ----------------------------------------------------

    @staticmethod
    def build_prompt(
        deceased_name: str,
        retrieved: list[dict[str, Any]],
        history: list[dict[str, Any]],
        message: str,
    ) -> list[dict[str, str]]:
        """Compose OpenAI-style messages for the persona.

        The system prompt instructs the model to speak *as* the deceased,
        grounded in retrieved memory chunks. Prior conversation history is
        replayed verbatim so multi-turn coherence is preserved.
        """
        if retrieved:
            context_lines = []
            for i, chunk in enumerate(retrieved, start=1):
                text = (chunk.get("text") or "").strip()
                if not text:
                    continue
                context_lines.append(f"[memory {i}] {text}")
            context_block = "\n".join(context_lines)
        else:
            context_block = "(no memory available)"

        system = (
            f"You are speaking as {deceased_name}, who has passed away. "
            f"You may answer in the language the user uses (Traditional Chinese or English). "
            f"Stay in character: speak in the first person, with warmth and the tone "
            f"suggested by the memories below. Never claim to be an AI. "
            f"If you cannot recall something from your memories, gently say so rather than inventing facts.\n\n"
            f"---- memories about your life ----\n{context_block}\n----------------------------------"
        )

        messages: list[dict[str, str]] = [{"role": "system", "content": system}]

        for h in history:
            role = h.get("role")
            content = h.get("content")
            if role in ("user", "assistant", "system") and isinstance(content, str):
                messages.append({"role": role, "content": content})

        messages.append({"role": "user", "content": message})
        return messages
