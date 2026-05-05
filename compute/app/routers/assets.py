"""Public asset endpoints (no auth required).

The manifest is content-addressed on IPFS already; serving it from compute is a
convenience for the frontend (saves a chain RPC + a gateway round-trip).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status

from ..cache import get_cache

router = APIRouter(prefix="/persona", tags=["assets"])


@router.get("/{token_id}/manifest")
async def get_manifest(token_id: int) -> dict[str, Any]:
    """Return the artifact manifest for ``token_id``.

    Triggers a cache load if cold; manifest fetch is cheap (single JSON GET)
    so we don't gate it behind auth.
    """
    try:
        artifacts = await get_cache().load(token_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"failed to load manifest: {exc}",
        ) from exc

    return {
        "tokenId": artifacts.token_id,
        "manifest": artifacts.manifest,
    }
