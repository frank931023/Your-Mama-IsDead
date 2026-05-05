"""TTS runner.

PROTOTYPE: returns a 1-second mono silent WAV so the frontend audio pipeline
(``<audio src=blob:...>``) can be wired up end-to-end.

REAL IMPLEMENTATION (sketch, swap into ``synthesize``):

    # GPT-SoVITS local inference server
    async def synthesize(self, text: str) -> bytes:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{settings.sovits_url}/tts",
                json={
                    "text": text,
                    "ref_audio_path": str(self.voice_path),
                    "language": "zh",
                },
            )
            resp.raise_for_status()
            return resp.content  # WAV bytes

    # ElevenLabs SDK alternative
    from elevenlabs.client import AsyncElevenLabs
    client = AsyncElevenLabs(api_key=settings.elevenlabs_api_key)
    audio = client.text_to_speech.convert(voice_id=..., text=text)
    return b"".join([chunk async for chunk in audio])
"""
from __future__ import annotations

import asyncio
import io
import wave
from pathlib import Path


class TTSRunner:
    """Persona-bound TTS. One instance per request is fine."""

    SAMPLE_RATE = 22050  # matches GPT-SoVITS default
    DURATION_S = 1.0

    def __init__(self, voice_path: Path | None) -> None:
        self.voice_path = voice_path

    async def synthesize(self, text: str) -> bytes:
        """Return WAV bytes for ``text``.

        Stub yields silent PCM; real implementations should keep the same
        return type so the router never needs to change.
        """
        return await asyncio.to_thread(self._render_silence)

    # -- stub render --------------------------------------------------------

    def _render_silence(self) -> bytes:
        n_frames = int(self.SAMPLE_RATE * self.DURATION_S)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit PCM
            wf.setframerate(self.SAMPLE_RATE)
            wf.writeframes(b"\x00\x00" * n_frames)
        return buf.getvalue()
