"""JWT verification dependency.

The application backend issues these tokens after running the SIWE flow and
checking ``ownerOf(tokenId)``. The compute service trusts that signal — its
only job here is to confirm the token signature and the presence of an
``address`` claim.
"""
from __future__ import annotations

from typing import Any

import jwt
from fastapi import Header, HTTPException, status

from ..config import get_settings


def _strip_bearer(value: str) -> str:
    parts = value.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return value.strip()


async def verify_token(authorization: str = Header(..., alias="Authorization")) -> dict[str, Any]:
    """FastAPI dependency: decode + validate JWT, return claims.

    Raises 401 on missing / malformed / expired tokens.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing Authorization header",
        )

    token = _strip_bearer(authorization)
    settings = get_settings()

    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token expired",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {exc}",
        ) from exc

    if "address" not in claims or not claims["address"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token missing 'address' claim",
        )

    return claims
