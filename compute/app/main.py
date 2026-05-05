"""FastAPI entrypoint for the DSAS compute service."""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import assets, auth as auth_module  # noqa: F401  (auth is dependency-only)
from .routers import persona


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup / shutdown hooks."""
    settings = get_settings()
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    yield
    # No teardown needed — cache lives in /persona_cache, OS cleans tmp.


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="DSAS Compute Service",
        description=(
            "AI inference for the Digital Sovereign Ancestor System prototype: "
            "RAG-grounded chat, LoRA portraits, and persona TTS, gated by "
            "wallet-based JWT and backed by chain + IPFS artifacts."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    allow_origins = sorted(
        {origin for origin in (settings.frontend_url, settings.backend_url, "http://localhost:3000") if origin}
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Public health
    @app.get("/", tags=["health"])
    async def root() -> dict[str, str]:
        return {"service": "dsas-compute", "status": "ok"}

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # Routers
    app.include_router(assets.router)
    app.include_router(persona.router)

    return app


app = create_app()
