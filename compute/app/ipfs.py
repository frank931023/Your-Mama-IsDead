"""IPFS gateway helpers.

Resolves ``ipfs://<cid>[/path]`` URIs through the configured HTTP gateway and
returns raw bytes / parsed JSON. Wrapped in tenacity retries because public
gateways flap.
"""
from __future__ import annotations

import json
from typing import Any

import httpx
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .config import get_settings


def _resolve_url(uri: str) -> str:
    """Convert ``ipfs://CID/path`` to a gateway URL. HTTP(S) URIs pass through."""
    settings = get_settings()
    if uri.startswith("ipfs://"):
        path = uri[len("ipfs://") :]
        gateway = settings.ipfs_gateway.rstrip("/") + "/"
        return gateway + path
    if uri.startswith(("http://", "https://")):
        return uri
    raise ValueError(f"Unsupported URI scheme: {uri!r}")


async def fetch_bytes(uri: str, *, timeout: float = 30.0) -> bytes:
    """GET ``uri`` (resolving ipfs:// via gateway) and return the body bytes."""
    url = _resolve_url(uri)
    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
            retry=retry_if_exception_type((httpx.HTTPError,)),
            reraise=True,
        ):
            with attempt:
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    return resp.content
    except RetryError as exc:  # pragma: no cover - tenacity reraise=True covers this
        raise RuntimeError(f"IPFS fetch failed for {uri!r}: {exc}") from exc
    raise RuntimeError(f"IPFS fetch unreachable for {uri!r}")


async def fetch_json(uri: str, *, timeout: float = 30.0) -> dict[str, Any]:
    """Fetch ``uri`` and decode as JSON."""
    raw = await fetch_bytes(uri, timeout=timeout)
    return json.loads(raw.decode("utf-8"))
