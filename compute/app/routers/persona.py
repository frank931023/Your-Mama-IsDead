"""Authenticated persona interaction endpoints.

- ``POST /persona/{tokenId}/chat``     SSE token stream (RAG + LLM)
- ``POST /persona/{tokenId}/portrait`` LoRA portrait (stubbed for prototype)
- ``POST /persona/{tokenId}/voice``    TTS (stubbed for prototype)
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from ..cache import PersonaArtifacts, get_cache
from ..config import get_settings
from ..services.llm_client import stream_completion
from ..services.lora_runner import LoRARunner
from ..services.rag_engine import RAGEngine
from ..services.tts_runner import TTSRunner
from .auth import verify_token

router = APIRouter(prefix="/persona", tags=["persona"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list)


class PortraitRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1000)
    negative_prompt: str = Field(default="", max_length=1000)
    seed: int = Field(default=42)


class VoiceRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_or_404(token_id: int) -> PersonaArtifacts:
    try:
        return await get_cache().load(token_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"failed to load artifacts: {exc}",
        ) from exc


def _deceased_name(artifacts: PersonaArtifacts) -> str:
    """Best-effort extraction of the deceased's name from the manifest."""
    manifest: dict[str, Any] = artifacts.manifest or {}
    dsas = manifest.get("dsas", {}) or {}
    deceased = dsas.get("deceased", {}) or {}
    if name := deceased.get("name"):
        return str(name)
    if name := manifest.get("name"):
        return str(name)
    return f"Token #{artifacts.token_id}"


# ---------------------------------------------------------------------------
# Chat (fully implemented)
# ---------------------------------------------------------------------------


@router.post("/{token_id}/chat")
async def chat(
    token_id: int,
    body: ChatRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> StreamingResponse:
    """Streaming chat endpoint. Returns ``text/event-stream``.

    Each SSE event is ``data: <json>\\n\\n`` with one of:
        ``{"type": "token", "content": "..."}``  — incremental token
        ``{"type": "done"}``                    — terminal sentinel
        ``{"type": "error", "message": "..."}`` — terminal error
    """
    artifacts = await _load_or_404(token_id)
    settings = get_settings()

    rag = RAGEngine(
        embeddings=artifacts.rag_embeddings,
        chunks=artifacts.rag_chunks,
    )

    retrieved = rag.retrieve(body.message, top_k=5)
    messages = rag.build_prompt(
        deceased_name=_deceased_name(artifacts),
        retrieved=retrieved,
        history=[m.model_dump() for m in body.history],
        message=body.message,
    )

    async def event_stream() -> AsyncIterator[bytes]:
        try:
            async for token in stream_completion(messages, model=settings.llm_model):
                payload = json.dumps({"type": "token", "content": token}, ensure_ascii=False)
                yield f"data: {payload}\n\n".encode("utf-8")
            yield b'data: {"type": "done"}\n\n'
        except Exception as exc:  # noqa: BLE001 - surface upstream errors to client
            err = json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False)
            yield f"data: {err}\n\n".encode("utf-8")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# Portrait (stubbed)
# ---------------------------------------------------------------------------


@router.post("/{token_id}/portrait")
async def portrait(
    token_id: int,
    body: PortraitRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> Response:
    """Generate a portrait (stubbed: PNG with prompt overlay).

    Real implementation: load SDXL pipeline + ``pipe.load_lora_weights(cache.lora_path)``.
    """
    artifacts = await _load_or_404(token_id)
    runner = LoRARunner(lora_path=artifacts.lora_path)
    png_bytes = await runner.generate(
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        seed=body.seed,
    )
    return Response(content=png_bytes, media_type="image/png")


# ---------------------------------------------------------------------------
# Voice (stubbed)
# ---------------------------------------------------------------------------


@router.post("/{token_id}/voice")
async def voice(
    token_id: int,
    body: VoiceRequest,
    claims: dict[str, Any] = Depends(verify_token),
) -> Response:
    """Synthesize speech (stubbed: 1s silent WAV).

    Real implementation: call GPT-SoVITS / ElevenLabs using ``cache.voice_path``.
    """
    artifacts = await _load_or_404(token_id)
    runner = TTSRunner(voice_path=artifacts.voice_path)
    wav_bytes = await runner.synthesize(body.text)
    return Response(content=wav_bytes, media_type="audio/wav")
