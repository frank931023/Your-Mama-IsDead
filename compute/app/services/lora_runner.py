"""LoRA portrait generator.

PROTOTYPE: returns a 512x512 PNG with the prompt rendered as text so the
frontend gets something visibly tied to the request.

REAL IMPLEMENTATION (sketch, swap into ``generate``):

    from diffusers import StableDiffusionXLPipeline
    import torch

    class LoRARunner:
        _pipe = None  # class-level so the SDXL base is shared across personas

        def __init__(self, lora_path: Path):
            self.lora_path = lora_path

        @classmethod
        def _get_pipe(cls):
            if cls._pipe is None:
                cls._pipe = StableDiffusionXLPipeline.from_pretrained(
                    "stabilityai/stable-diffusion-xl-base-1.0",
                    torch_dtype=torch.float16,
                    variant="fp16",
                ).to(get_settings().gpu_device)
            return cls._pipe

        async def generate(self, prompt, negative_prompt="", seed=42):
            pipe = self._get_pipe()
            pipe.load_lora_weights(str(self.lora_path))
            try:
                gen = torch.Generator(device=pipe.device).manual_seed(seed)
                image = pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    generator=gen,
                    num_inference_steps=30,
                ).images[0]
                buf = io.BytesIO()
                image.save(buf, format="PNG")
                return buf.getvalue()
            finally:
                pipe.unload_lora_weights()
"""
from __future__ import annotations

import asyncio
import io
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


class LoRARunner:
    """Persona-bound portrait generator. One instance per request is fine."""

    def __init__(self, lora_path: Path | None) -> None:
        self.lora_path = lora_path

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        seed: int = 42,
    ) -> bytes:
        """Return PNG bytes for the requested portrait.

        Stub: synchronous PIL render dispatched to a thread to keep the event
        loop free. Real GPU inference would be similar (``asyncio.to_thread``
        wrapping the diffusers call) so the call site stays unchanged.
        """
        return await asyncio.to_thread(self._render_stub, prompt, negative_prompt, seed)

    # -- stub render --------------------------------------------------------

    def _render_stub(self, prompt: str, negative_prompt: str, seed: int) -> bytes:
        size = (512, 512)
        # Deterministic background tint from seed so different seeds look different.
        bg = (
            (seed * 37) % 200 + 30,
            (seed * 53) % 200 + 30,
            (seed * 71) % 200 + 30,
        )
        img = Image.new("RGB", size, color=bg)
        draw = ImageDraw.Draw(img)

        try:
            font = ImageFont.load_default()
        except OSError:  # pragma: no cover - default font is bundled with PIL
            font = None

        title = "[STUB] LoRA portrait"
        sub = f"lora: {self.lora_path.name if self.lora_path else 'none'}  seed={seed}"
        wrapped_prompt = textwrap.fill(prompt or "(empty prompt)", width=42)
        wrapped_neg = textwrap.fill(negative_prompt or "(none)", width=42)

        lines = [
            title,
            "",
            "prompt:",
            wrapped_prompt,
            "",
            "negative:",
            wrapped_neg,
            "",
            sub,
        ]
        y = 16
        for line in lines:
            draw.text((16, y), line, fill=(245, 245, 245), font=font)
            y += 18

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
