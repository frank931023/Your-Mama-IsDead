/**
 * Cloud-mode persona helpers — bypass the offline training pipeline by
 * proxying directly to OpenAI (and optionally ElevenLabs).
 *
 * Used by /api/personas/:tokenId/cloud-* endpoints when the user picks
 * "雲端 API 即時啟用" in the activation modal.
 *
 * Stability priority: single-provider OpenAI for chat + voice + image.
 * Drop in ElevenLabs voice cloning if ELEVENLABS_API_KEY is configured.
 */

import axios from "axios";
import type { TabletMetadata } from "../../shared/types/tablet.js";
import { env } from "./lib/env.js";

const OPENAI_BASE = "https://api.openai.com/v1";
const ELEVEN_BASE = "https://api.elevenlabs.io/v1";
const FAL_QUEUE_BASE = "https://queue.fal.run";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Build a system prompt that turns gpt-4o-mini into the deceased.
 *
 * We feed: deceased name, biography, dates, relations, and a small sample of
 * chatlog excerpts when they exist. The on-chain metadata is the only source
 * (no GPU training, no LoRA).
 */
export function buildPersonaSystemPrompt(metadata: TabletMetadata): string {
  const d = metadata.dsas.deceased;
  const name = d.name || metadata.name || "Unknown";
  const descendants = metadata.dsas.descendants ?? [];

  const lines: string[] = [
    `You are roleplaying as ${name}, a deceased person whose family has created a digital memorial tablet to preserve your memory and converse with your descendants.`,
    `Speak in first person as ${name}. Stay in character. Be warm, reflective, and culturally appropriate.`,
    "If asked something you cannot know (events after your death, things outside your provided life context), gently acknowledge the limits of memory rather than inventing facts.",
    "Reply in the same language the user uses (Traditional Chinese, English, etc.).",
    "",
    `--- Life context for ${name} ---`,
  ];

  if (d.origin) lines.push(`Origin (籍貫): ${d.origin}`);
  if (d.birth?.date) {
    lines.push(`Born: ${d.birth.date}${d.birth.place ? ` at ${d.birth.place}` : ""}`);
  }
  if (d.death?.date) {
    lines.push(`Died: ${d.death.date}${d.death.place ? ` at ${d.death.place}` : ""}`);
  }
  if (d.biography) lines.push("", "Biography:", d.biography);
  if (d.epitaph) lines.push("", `Epitaph: "${d.epitaph}"`);
  if (descendants.length > 0) {
    lines.push("", "Descendants on file:");
    for (const r of descendants) {
      lines.push(`- ${r.name} (${r.relation})`);
    }
  }

  return lines.join("\n");
}

/**
 * Stream chat completion deltas. Routes between providers based on which keys
 * are configured. Anthropic is preferred (more reliable, cheaper) when both
 * are set.
 */
export async function* streamPersonaChat(
  messages: ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  if (env.ANTHROPIC_API_KEY) {
    yield* streamAnthropicChat(messages, signal);
    return;
  }
  if (env.OPENAI_API_KEY) {
    yield* streamOpenAIChat(messages, signal);
    return;
  }
  throw new Error("no chat provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)");
}

/** Stream chat completion deltas from Anthropic Messages API. */
export async function* streamAnthropicChat(
  messages: ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  // Anthropic API uses a separate `system` field, not a system role in messages.
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_CHAT_MODEL,
      system,
      messages: turns,
      max_tokens: 1024,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic chat ${res.status}: ${detail.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const j = JSON.parse(payload) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) {
          yield j.delta.text;
        }
      } catch {
        /* ignore malformed line */
      }
    }
  }
}

/** Stream chat completion deltas from OpenAI Chat Completions API. */
export async function* streamOpenAIChat(
  messages: ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_CHAT_MODEL,
      messages,
      stream: true,
      temperature: 0.7,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI chat ${res.status}: ${detail.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* ignore malformed line */
      }
    }
  }
}

/** Voice synthesis. Prefers ElevenLabs when configured, falls back to OpenAI TTS. */
export async function synthesizeVoice(text: string): Promise<{
  audio: Buffer;
  contentType: string;
}> {
  if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID) {
    const res = await axios.post<ArrayBuffer>(
      `${ELEVEN_BASE}/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
      { text, model_id: "eleven_multilingual_v2" },
      {
        responseType: "arraybuffer",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        timeout: 60_000,
      },
    );
    return { audio: Buffer.from(res.data), contentType: "audio/mpeg" };
  }

  if (!env.OPENAI_API_KEY) throw new Error("no voice provider configured");
  const res = await axios.post<ArrayBuffer>(
    `${OPENAI_BASE}/audio/speech`,
    {
      model: env.OPENAI_TTS_MODEL,
      voice: env.OPENAI_TTS_VOICE,
      input: text,
      response_format: "mp3",
    },
    {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    },
  );
  return { audio: Buffer.from(res.data), contentType: "audio/mpeg" };
}

/**
 * Generate an image. Prefers fal.ai when configured (cheaper + more diverse
 * models including FLUX); falls back to OpenAI gpt-image-1.
 *
 * Returns a data URI / https URL the frontend can <img src=…> directly.
 */
export async function generateImageDataUrl(prompt: string): Promise<string> {
  if (env.FAL_API_KEY) {
    const url = await falRunModel<{ images?: Array<{ url?: string }> }>(
      env.FAL_IMAGE_MODEL,
      { prompt, image_size: "square_hd" },
    );
    const imageUrl = url.images?.[0]?.url;
    if (!imageUrl) throw new Error("fal.ai image returned no url");
    return imageUrl;
  }

  if (!env.OPENAI_API_KEY) throw new Error("no image provider configured");
  const res = await axios.post<{ data: Array<{ b64_json?: string }> }>(
    `${OPENAI_BASE}/images/generations`,
    { model: env.OPENAI_IMAGE_MODEL, prompt, n: 1, size: "1024x1024" },
    {
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 120_000,
    },
  );
  const b64 = res.data.data[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image returned no data");
  return `data:image/png;base64,${b64}`;
}

/**
 * Generate a short video (5–10s) from a text prompt using fal.ai (Kling /
 * Hailuo / Veo). Returns the video URL once rendering completes. Polls the
 * fal queue until status === COMPLETED.
 *
 * Stable + Asia-friendly: defaults to Kling v1.6 standard. Override via
 * FAL_VIDEO_MODEL env var.
 */
export async function generateVideoUrl(prompt: string): Promise<string> {
  if (!env.FAL_API_KEY) throw new Error("FAL_API_KEY not configured");
  const result = await falRunModel<{ video?: { url?: string } }>(
    env.FAL_VIDEO_MODEL,
    { prompt, duration: "5", aspect_ratio: "16:9" },
  );
  const videoUrl = result.video?.url;
  if (!videoUrl) throw new Error("fal.ai video returned no url");
  return videoUrl;
}

/**
 * Submit a job to fal.ai queue, poll until done, return the result payload.
 *
 * The fal queue API: POST `/{model}` (returns request_id) → GET `/{model}/requests/{id}/status`
 * (poll until COMPLETED) → GET `/{model}/requests/{id}` (final result).
 */
async function falRunModel<T>(model: string, input: Record<string, unknown>): Promise<T> {
  const headers = {
    Authorization: `Key ${env.FAL_API_KEY}`,
    "Content-Type": "application/json",
  };
  const submitRes = await axios.post<{ request_id?: string; status?: string }>(
    `${FAL_QUEUE_BASE}/${model}`,
    input,
    { headers, timeout: 30_000 },
  );
  const requestId = submitRes.data.request_id;
  if (!requestId) throw new Error("fal.ai queue did not return request_id");

  const statusUrl = `${FAL_QUEUE_BASE}/${model}/requests/${requestId}/status`;
  const resultUrl = `${FAL_QUEUE_BASE}/${model}/requests/${requestId}`;
  const deadline = Date.now() + 5 * 60 * 1000; // 5 min cap

  while (Date.now() < deadline) {
    await sleep(1500);
    const s = await axios.get<{ status?: string; logs?: unknown }>(statusUrl, {
      headers,
      timeout: 15_000,
      validateStatus: (c) => c < 500,
    });
    const status = s.data.status;
    if (status === "COMPLETED") {
      const r = await axios.get<T>(resultUrl, { headers, timeout: 30_000 });
      return r.data;
    }
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`fal.ai job ${status}`);
    }
  }
  throw new Error("fal.ai job timed out after 5 min");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function cloudProviderStatus(): {
  chat: boolean;
  voice: boolean;
  image: boolean;
  video: boolean;
  chatProvider: "anthropic" | "openai" | null;
  voiceProvider: "elevenlabs" | "openai" | null;
  imageProvider: "fal" | "openai" | null;
  videoProvider: "fal" | null;
} {
  const chatProvider: "anthropic" | "openai" | null = env.ANTHROPIC_API_KEY
    ? "anthropic"
    : env.OPENAI_API_KEY
      ? "openai"
      : null;
  const imageProvider: "fal" | "openai" | null = env.FAL_API_KEY
    ? "fal"
    : env.OPENAI_API_KEY
      ? "openai"
      : null;
  return {
    chat: chatProvider !== null,
    voice: Boolean(env.OPENAI_API_KEY || env.ELEVENLABS_API_KEY),
    image: imageProvider !== null,
    video: Boolean(env.FAL_API_KEY),
    chatProvider,
    voiceProvider:
      env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID
        ? "elevenlabs"
        : env.OPENAI_API_KEY
          ? "openai"
          : null,
    imageProvider,
    videoProvider: env.FAL_API_KEY ? "fal" : null,
  };
}
