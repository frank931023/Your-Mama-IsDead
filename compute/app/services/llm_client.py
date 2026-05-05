"""LLM streaming client.

Currently wraps the OpenAI async SDK with a backend-switchable surface so a
local model (e.g. llama-3.1-8b via vLLM) can be slotted in by extending the
``if backend == ...`` branch — callers stay on a single interface.
"""
from __future__ import annotations

from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from ..config import get_settings

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        settings = get_settings()
        # api_key may be empty in CI / local-only setups; SDK will surface the
        # auth error on first call rather than at import time.
        _client = AsyncOpenAI(api_key=settings.openai_api_key or "missing-key")
    return _client


async def stream_completion(
    messages: list[dict[str, Any]],
    model: str | None = None,
) -> AsyncIterator[str]:
    """Yield content deltas for an OpenAI-style chat completion.

    ``messages`` is the standard ``[{"role": ..., "content": ...}, ...]`` list.
    """
    settings = get_settings()
    backend = settings.llm_backend
    chosen_model = model or settings.llm_model

    if backend == "openai":
        async for delta in _stream_openai(messages, chosen_model):
            yield delta
        return

    if backend == "local":
        # Placeholder for a future vLLM / llama.cpp endpoint:
        #   async with httpx.AsyncClient() as c:
        #       async with c.stream("POST", LOCAL_URL, json={...}) as r:
        #           async for line in r.aiter_lines(): ...
        raise NotImplementedError("local LLM backend not wired up in prototype")

    raise ValueError(f"unsupported LLM backend: {backend!r}")


async def _stream_openai(
    messages: list[dict[str, Any]],
    model: str,
) -> AsyncIterator[str]:
    client = _get_client()
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        content = getattr(delta, "content", None)
        if content:
            yield content
