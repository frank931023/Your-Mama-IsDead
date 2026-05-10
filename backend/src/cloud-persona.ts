/**
 * 雲端模式 (Cloud Mode) Persona 推理層
 *
 * 用途:當使用者在「啟動數位分身」modal 點選「雲端即時喚起」時,
 * 跳過離線 training pipeline + on-chain artifactURI 限制,直接打外部
 * API 即時生成對話 / 語音 / 影像 / 短片。
 *
 * 供應商路由規則:
 *   ┌───────┬──────────────────────────────────────────────────┐
 *   │ 功能  │ 供應商選擇順序                                    │
 *   ├───────┼──────────────────────────────────────────────────┤
 *   │ Chat  │ Anthropic Claude → OpenAI GPT-4o-mini             │
 *   │ Voice │ ElevenLabs (有 voice id) → OpenAI TTS             │
 *   │ Image │ fal.ai FLUX → OpenAI gpt-image-1                  │
 *   │ Video │ fal.ai Kling (唯一管道)                          │
 *   └───────┴──────────────────────────────────────────────────┘
 *
 * 設計重點:所有外部 API 細節集中在這個檔案,switch provider 只要改這裡。
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
 * 組裝 system prompt,讓 LLM 進入「逝者本人」的角色扮演。
 *
 * 餵進去的素材:姓名、籍貫、生卒、傳記、墓誌銘、子孫名單。
 * 這些全部來自鏈上 metadata,沒有任何 GPU 訓練,沒有 LoRA。
 *
 * 角色設定原則:用第一人稱、保持溫暖、無法回答的事誠實承認,
 * 並會 mirror 使用者的語言(中文/英文都會)。
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
 * 串流回傳 LLM token deltas。根據 .env 中哪些 API key 有設定自動選 provider。
 * 兩家都有設定時,優先用 Anthropic(較穩、較便宜、中文較自然)。
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

/**
 * 從 Anthropic Messages API 串流 token。
 * 注意:Anthropic 的 system prompt 是獨立欄位,不是 messages 陣列裡的 role。
 */
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

/** 從 OpenAI Chat Completions API 串流 token deltas。 */
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

/**
 * 語音合成。優先用 ElevenLabs(支援 voice cloning,品質較好),
 * 否則 fallback 到 OpenAI TTS。回傳音訊 buffer + content-type。
 */
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
 * 生成圖片。fal.ai 設了就優先 (FLUX schnell ~$0.003/張,模型選擇也多),
 * 否則 fallback 到 OpenAI gpt-image-1 (~$0.04/張)。
 *
 * 回傳值是可以直接塞進 <img src=...> 的 URL:
 *   - fal.ai 路徑:回 https URL
 *   - OpenAI 路徑:回 data:image/png;base64,... URI
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
 * 從文字 prompt 生成 5~10 秒短片 (使用 fal.ai 上的 Kling / Hailuo / Veo)。
 *
 * fal.ai 是 async queue API,要 polling 等渲染完成 (約 30~90 秒)。
 * 預設用 Kling v1.6 standard,因為對亞洲面孔/中文場景描述支援較好。
 * 可透過 FAL_VIDEO_MODEL 環境變數換模型。
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
 * 通用 fal.ai queue API 包裝:submit → poll status → fetch result。
 *
 * fal.ai queue 三步流程:
 *   1. POST  /{model}                    → 拿 request_id
 *   2. GET   /{model}/requests/{id}/status → poll 到 status === COMPLETED
 *   3. GET   /{model}/requests/{id}      → 拿最終結果
 *
 * 5 分鐘內 polling 不到 COMPLETED 會 throw timeout。
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

/**
 * 回報目前 .env 設定下,cloud mode 各功能是否就緒。
 * 給前端 modal 判斷哪些選項可以打勾、哪個 API 在跑。
 */
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
