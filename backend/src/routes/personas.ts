import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import axios, { AxiosError, type AxiosResponse } from "axios";
import type { TabletMetadata } from "../../../shared/types/tablet.js";
import { env } from "../lib/env.js";
import { prisma } from "../db.js";
import { requireAuth, requireOwner } from "../auth/middleware.js";
import { requireOwnerOrInvite } from "../lib/access.js";
import {
  buildPersonaSystemPrompt,
  cloudProviderStatus,
  generateImageDataUrl,
  generateVideoUrl,
  streamPersonaChat,
  synthesizeVoice,
  transcribeAudio,
  type ChatTurn,
} from "../cloud-persona.js";
import { createComposeSessionToken, simliConfigured, SimliError } from "../lib/simli.js";
import { reindexMemory, retrieveMemory, memoryCount, type MemoryHit } from "../lib/rag.js";

const TokenIdParam = z.object({
  tokenId: z.string().regex(/^\d+$/u),
});

/** cosine 距離大於此值的命中視為「不夠相關」丟掉 (e5 normalize 後,經驗閾值)。 */
const MEMORY_MAX_DISTANCE = 0.62;
/**
 * 照片要在對話中浮現的門檻,比文字更嚴:在靈堂場景放出不相關的照片,
 * 情感傷害遠大於不放 — 寧缺勿錯。
 */
const MEDIA_MAX_DISTANCE = 0.55;
/** 單輪回覆最多浮現幾張照片。 */
const MEDIA_MAX_PER_TURN = 2;

/** 本輪要隨回覆浮現的照片 (story 命中附帶的)。 */
export interface MemoryMedia {
  /** ipfs:// uri */
  uri: string;
  /** 照片所屬回憶的摘要 (給前端當卡片說明、給 LLM 知道有這張照片)。 */
  caption: string;
  source: "story";
}

interface MemoryInjection {
  block: string | null;
  /** 通過閾值、實際注入 prompt 的片段數。 */
  usedCount: number;
  media: MemoryMedia[];
}

/**
 * 把檢索到的記憶片段組成可塞進 persona system prompt 的文字,並挑出
 * 可隨回覆浮現的照片。兩種來源分開呈現:
 *   - chatlog: 逝者「本人說過的話」→ 模仿語氣、可當自己的記憶
 *   - story:   「親友分享的回憶」→ 是別人對你的記憶,可自然提及
 *     (「小華有跟我提過…」),但不能當成自己說過的話照唸
 * 命中為空時 block 回 null (呼叫方維持純 metadata 的 prompt)。
 */
function buildMemoryInjection(hits: MemoryHit[], name: string): MemoryInjection {
  const relevant = hits.filter((h) => h.distance <= MEMORY_MAX_DISTANCE);
  const chatlogHits = relevant.filter((h) => h.kind === "chatlog");
  const storyHits = relevant.filter((h) => h.kind === "story");

  const sections: string[] = [];

  if (chatlogHits.length > 0) {
    sections.push(
      [
        `--- ${name} 本人說過的話 (從生前對話紀錄檢索,供你參考語氣與內容) ---`,
        "下面是與當前話題相關的真實片段。回答時請貼近這些話的語氣、用詞、立場;",
        "若片段裡有具體事實就用上,但不要逐字照唸或硬湊;沒有相關片段時照常回答即可。",
        ...chatlogHits.map((h) => `- 「${h.text.replace(/\s+/g, " ").trim()}」`),
      ].join("\n"),
    );
  }

  if (storyHits.length > 0) {
    sections.push(
      [
        `--- 親友在哀悼版分享的、關於你 (${name}) 的回憶 ---`,
        "這些是「別人」寫下的對你的記憶,不是你說過的話。你可以把它們當作確實",
        "發生過的事自然帶入 (例如「對啊,那次…」),也可以提到是誰記得這件事;",
        "但不要把這些文字當成自己的原話照唸,口吻仍要是你自己。",
        ...storyHits.map((h) => {
          const who = h.speaker ? ` (${h.speaker} 分享)` : "";
          return `- ${h.text.replace(/\s+/g, " ").trim()}${who}`;
        }),
      ].join("\n"),
    );
  }

  // 照片:story 命中且距離夠近才浮現;同一張只出一次,最多 MEDIA_MAX_PER_TURN 張。
  const media: MemoryMedia[] = [];
  for (const h of storyHits) {
    if (!h.mediaUri || h.distance > MEDIA_MAX_DISTANCE) continue;
    if (media.some((m) => m.uri === h.mediaUri)) continue;
    media.push({
      uri: h.mediaUri,
      caption: h.text.replace(/\s+/g, " ").trim().slice(0, 120),
      source: "story",
    });
    if (media.length >= MEDIA_MAX_PER_TURN) break;
  }

  if (media.length > 0) {
    sections.push(
      [
        "--- 本輪會隨你的回覆浮現的老照片 ---",
        "下面這(些)張回憶照片會在你回覆時顯示給對方看。請在回覆中自然地呼應它",
        "(例如「你看,就是這張…」),不要描述系統或照片機制本身。",
        ...media.map((m) => `- ${m.caption}`),
      ].join("\n"),
    );
  }

  return {
    block: sections.length > 0 ? `\n${sections.join("\n\n")}` : null,
    usedCount: relevant.length,
    media,
  };
}

function ensureCompute(reply: FastifyReply): string | null {
  if (!env.COMPUTE_URL) {
    reply.code(503).send({ error: "compute_not_configured" });
    return null;
  }
  return env.COMPUTE_URL.replace(/\/$/, "");
}

async function proxy(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: string,
  method: "GET" | "POST",
  stream: boolean,
): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    const ct = request.headers["content-type"];
    if (typeof ct === "string") headers["content-type"] = ct;
    if (request.user?.address) headers["x-dsas-address"] = request.user.address;

    const res: AxiosResponse = await axios.request({
      url: upstream,
      method,
      data: method === "POST" ? request.body : undefined,
      headers,
      responseType: stream ? "stream" : "json",
      timeout: stream ? 0 : 30_000,
      validateStatus: () => true,
    });

    reply.code(res.status);
    const upstreamCT = res.headers["content-type"];
    if (typeof upstreamCT === "string") reply.header("content-type", upstreamCT);

    if (stream) {
      // Pipe upstream body straight back; suitable for SSE / chunked output.
      await reply.send(res.data);
    } else {
      await reply.send(res.data);
    }
  } catch (err) {
    const status = err instanceof AxiosError ? err.response?.status ?? 502 : 502;
    request.log.error({ err, upstream }, "compute proxy failed");
    if (!reply.sent) {
      await reply.code(status).send({ error: "compute_proxy_failed" });
    }
  }
}

export const personaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /api/personas/:tokenId/chat — auth + owner; streams SSE from compute.
  app.post(
    "/:tokenId/chat",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const base = ensureCompute(reply);
      if (!base) return;
      await proxy(request, reply, `${base}/persona/${params.data.tokenId}/chat`, "POST", true);
    },
  );

  // POST /api/personas/:tokenId/portrait
  app.post(
    "/:tokenId/portrait",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const base = ensureCompute(reply);
      if (!base) return;
      await proxy(request, reply, `${base}/persona/${params.data.tokenId}/portrait`, "POST", false);
    },
  );

  // POST /api/personas/:tokenId/voice
  app.post(
    "/:tokenId/voice",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const base = ensureCompute(reply);
      if (!base) return;
      await proxy(request, reply, `${base}/persona/${params.data.tokenId}/voice`, "POST", true);
    },
  );

  // GET /api/personas/:tokenId/manifest — public (no auth needed for read).
  app.get("/:tokenId/manifest", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
    const base = ensureCompute(reply);
    if (!base) return;
    await proxy(request, reply, `${base}/persona/${params.data.tokenId}/manifest`, "GET", false);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Cloud-mode endpoints — bypass the offline training pipeline + on-chain
  // artifactURI requirement. Powered directly by OpenAI (and optionally
  // ElevenLabs). Used when the user picks "雲端 API 即時啟用" in the
  // persona activation modal.
  // ────────────────────────────────────────────────────────────────────────

  // GET /api/personas/cloud-status — public; tells the frontend whether to
  // enable the cloud activation card in the modal.
  app.get("/cloud-status", async () => cloudProviderStatus());

  // GET /api/personas/:tokenId/persona-prompt — auth + owner. 回传该 persona 的
  // system prompt。LAM 渲染机的 WS /render 是 persona-agnostic (不会自动注入人设),
  // 前端在 LAM 模式下要自己把这段 system prompt 放进 messages[0]。这与后端
  // cloud-chat 用的是同一份 buildPersonaSystemPrompt,保证两条路径人设一致。
  // 帶 ?q=<使用者本輪問題> 時,會用它對該 persona 的記憶索引 (對話紀錄向量庫)
  // 做 RAG 檢索,把命中的逝者真實語料片段附加在 system prompt 後面。沒帶 q、
  // 沒有索引、或檢索不到夠相關的片段時,就回純 metadata 的 prompt (行為同舊版)。
  // 前端 LAM 模式每輪對話帶上 q,即可做到「每輪用問題檢索」的真 RAG。
  app.get(
    "/:tokenId/persona-prompt",
    { preHandler: [requireOwnerOrInvite("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const tokenId = BigInt(params.data.tokenId);
      const tablet = await prisma.tablet.findUnique({ where: { tokenId } });
      if (!tablet) return reply.code(404).send({ error: "tablet_not_synced" });
      const metadata = tablet.metadataJson as TabletMetadata | null;
      if (!metadata) return reply.code(409).send({ error: "metadata_unavailable" });

      let prompt = buildPersonaSystemPrompt(metadata);
      let memoryUsed = 0;
      let media: MemoryMedia[] = [];

      const q = (request.query as { q?: unknown })?.q;
      if (typeof q === "string" && q.trim()) {
        try {
          const total = await memoryCount(tokenId);
          const hits = await retrieveMemory(tokenId, q);
          const name = metadata.dsas.deceased?.name || metadata.name || "他";
          const injection = buildMemoryInjection(hits, name);
          if (injection.block) {
            prompt += injection.block;
            memoryUsed = injection.usedCount;
            media = injection.media;
          }
          // ── RAG 可觀測性:在後端 console 印出本輪檢索實況 ──────────────────
          // grep "[RAG]" 看每一輪:查詢、索引總數、命中片段+距離、是否注入。
          request.log.info(
            {
              tokenId: tokenId.toString(),
              query: q,
              indexedChunks: total,
              threshold: MEMORY_MAX_DISTANCE,
              injected: memoryUsed,
              media: media.length,
              hits: hits.map((h) => ({
                kind: h.kind,
                dist: Number(h.distance.toFixed(3)),
                pass: h.distance <= MEMORY_MAX_DISTANCE,
                text: h.text.replace(/\s+/g, " ").slice(0, 60),
              })),
            },
            `[RAG] token#${tokenId} q="${q.slice(0, 40)}" → indexed=${total} injected=${memoryUsed}/${hits.length} media=${media.length}`,
          );
          if (total === 0) {
            request.log.warn(
              { tokenId: tokenId.toString() },
              `[RAG] token#${tokenId} 索引為空 — 還沒上傳對話紀錄、也沒有已核可的回憶 (或還沒 reindex),本輪用純 metadata persona`,
            );
          }
        } catch (err) {
          // RAG 失敗不該擋住對話 — 降級成純 metadata prompt。
          request.log.warn({ err, tokenId: tokenId.toString() }, "[RAG] retrieval failed, fallback to base prompt");
        }
      } else {
        request.log.info({ tokenId: tokenId.toString() }, `[RAG] token#${tokenId} 本輪無 query (前端沒帶 ?q=) — 純 metadata persona`);
      }

      return reply.send({ prompt, memoryUsed, media });
    },
  );

  // POST /api/personas/:tokenId/reindex-memory — auth + owner. 重建該 persona 的
  // 記憶索引 (拉 chatlogs → 解析 → 切片 → embed → 存 pgvector)。前端在「保存上鏈」
  // 成功 + sync 後呼叫一次即可。冪等:重跑會先清舊再建。可能要跑幾秒~幾十秒
  // (首次會下載 embedding 模型)。
  app.post(
    "/:tokenId/reindex-memory",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const tokenId = BigInt(params.data.tokenId);
      const tablet = await prisma.tablet.findUnique({ where: { tokenId } });
      if (!tablet) return reply.code(404).send({ error: "tablet_not_synced" });
      const metadata = tablet.metadataJson as TabletMetadata | null;
      if (!metadata) return reply.code(409).send({ error: "metadata_unavailable" });
      try {
        const t0 = Date.now();
        const result = await reindexMemory(tokenId, metadata);
        request.log.info(
          { ...result, ms: Date.now() - t0 },
          `[RAG] reindex token#${tokenId}: chatlogs=${result.chatlogsProcessed} stories=${result.storiesProcessed} 片段=${result.piecesIndexed} skipped=${result.skipped.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
        );
        if (result.piecesIndexed === 0) {
          request.log.warn(
            { tokenId: tokenId.toString(), skipped: result.skipped },
            `[RAG] reindex token#${tokenId} 索引了 0 段 — 可能沒上傳對話紀錄、沒有已核可的回憶,或逝者名字對不上 chatlog 裡的發話者 (檢查 metadata.deceased.name 與對話檔裡的名字)`,
          );
        }
        return reply.send(result);
      } catch (err) {
        const detail = err instanceof Error ? err.message : "reindex_failed";
        request.log.error({ err, tokenId: tokenId.toString() }, "[RAG] reindex-memory failed");
        return reply.code(500).send({ error: "reindex_failed", detail });
      }
    },
  );

  // GET /api/personas/:tokenId/memory-status — auth + owner. 回傳目前索引了幾段記憶。
  app.get(
    "/:tokenId/memory-status",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const tokenId = BigInt(params.data.tokenId);
      try {
        const count = await memoryCount(tokenId);
        return reply.send({ tokenId: tokenId.toString(), chunks: count });
      } catch (err) {
        request.log.error({ err }, "memory-status failed");
        return reply.code(500).send({ error: "memory_status_failed" });
      }
    },
  );

  // POST /api/personas/:tokenId/cloud-chat — auth + owner; SSE token stream.
  app.post(
    "/:tokenId/cloud-chat",
    { preHandler: [requireOwnerOrInvite("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

      const body = z
        .object({
          message: z.string().min(1).max(4000),
          history: z
            .array(
              z.object({
                role: z.enum(["system", "user", "assistant"]),
                content: z.string(),
              }),
            )
            .default([]),
        })
        .safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
      }

      const tokenId = BigInt(params.data.tokenId);
      const tablet = await prisma.tablet.findUnique({ where: { tokenId } });
      if (!tablet) return reply.code(404).send({ error: "tablet_not_synced" });

      const metadata = tablet.metadataJson as TabletMetadata | null;
      if (!metadata) {
        return reply.code(409).send({
          error: "metadata_unavailable",
          hint: "tablet metadata has not been resolved from IPFS yet; trigger /sync first",
        });
      }

      // RAG:跟 LAM 模式的 persona-prompt 同一套 — 用本輪訊息檢索記憶庫
      // (對話紀錄 + 已核可回憶),把命中片段拼進 system prompt。失敗就降級。
      let systemPrompt = buildPersonaSystemPrompt(metadata);
      let media: MemoryMedia[] = [];
      try {
        const hits = await retrieveMemory(tokenId, body.data.message);
        const name = metadata.dsas.deceased?.name || metadata.name || "他";
        const injection = buildMemoryInjection(hits, name);
        if (injection.block) {
          systemPrompt += injection.block;
          media = injection.media;
        }
        request.log.info(
          { tokenId: tokenId.toString(), injected: injection.usedCount, media: media.length },
          `[RAG] cloud-chat token#${tokenId} injected=${injection.usedCount} media=${media.length}`,
        );
      } catch (err) {
        request.log.warn({ err, tokenId: tokenId.toString() }, "[RAG] cloud-chat retrieval failed, base prompt only");
      }

      const messages: ChatTurn[] = [
        { role: "system", content: systemPrompt },
        ...body.data.history,
        { role: "user", content: body.data.message },
      ];

      // We're writing the response headers via reply.raw.writeHead, which
      // bypasses Fastify's @fastify/cors plugin (it only sets headers on the
      // `reply` object). Mirror the plugin behaviour manually here so the
      // browser doesn't block the SSE response on cross-origin chat requests.
      const origin = request.headers.origin;
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...(typeof origin === "string"
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
              Vary: "Origin",
            }
          : {}),
      });

      const ctrl = new AbortController();
      request.raw.on("close", () => ctrl.abort());

      try {
        // 先把本輪要浮現的回憶照片推給前端 (在 token 之前,前端可先掛上卡片)。
        if (media.length > 0) {
          reply.raw.write(`event: media\ndata: ${escapeSseData(JSON.stringify(media))}\n\n`);
        }
        for await (const delta of streamPersonaChat(messages, ctrl.signal)) {
          // SSE frame format: `event: token\ndata: <text>\n\n` — matches
          // the parser in frontend/src/lib/chat-stream.ts (`parsed.type`
          // is read from the SSE event field).
          reply.raw.write(`event: token\ndata: ${escapeSseData(delta)}\n\n`);
        }
        reply.raw.write(`event: done\ndata: {}\n\n`);
      } catch (err) {
        request.log.error({ err }, "cloud-chat stream failed");
        const msg = describeUpstreamError(err);
        reply.raw.write(`event: error\ndata: ${escapeSseData(msg)}\n\n`);
      } finally {
        reply.raw.end();
      }
    },
  );

  // POST /api/personas/:tokenId/cloud-voice — auth + owner; returns mp3.
  app.post(
    "/:tokenId/cloud-voice",
    { preHandler: [requireOwnerOrInvite("tokenId")] },
    async (request, reply) => {
      const body = z.object({ text: z.string().min(1).max(2000) }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body" });

      try {
        const { audio, contentType } = await synthesizeVoice(body.data.text);
        reply.header("content-type", contentType);
        return reply.send(audio);
      } catch (err) {
        const detail = err instanceof Error ? err.message : "voice_provider_failed";
        request.log.error({ err }, "cloud-voice failed");
        return reply.code(502).send({ error: "voice_provider_failed", detail });
      }
    },
  );

  // POST /api/personas/:tokenId/cloud-stt — auth + owner. multipart/form-data
  // with a single `audio` field (the user's mic recording). Returns
  // { text } — the transcript, fed back into the chat flow client-side.
  app.post(
    "/:tokenId/cloud-stt",
    { preHandler: [requireOwnerOrInvite("tokenId")] },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply.code(400).send({ error: "expected_multipart" });
      }
      const filePart = await request.file();
      if (!filePart) return reply.code(400).send({ error: "no_file" });

      const audio = await filePart.toBuffer();
      if (audio.length === 0) return reply.code(400).send({ error: "empty_file" });

      try {
        const text = await transcribeAudio(audio, filePart.filename || "speech.webm");
        return reply.send({ text });
      } catch (err) {
        const detail = describeUpstreamError(err);
        request.log.error({ err }, "cloud-stt failed");
        return reply.code(502).send({ error: "stt_provider_failed", detail });
      }
    },
  );

  // POST /api/personas/:tokenId/cloud-portrait — auth + owner; returns base64 PNG.
  app.post(
    "/:tokenId/cloud-portrait",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

      const body = z
        .object({ prompt: z.string().min(1).max(1000) })
        .safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body" });

      const tokenId = BigInt(params.data.tokenId);
      const tablet = await prisma.tablet.findUnique({ where: { tokenId } });
      const metadata = (tablet?.metadataJson as TabletMetadata | null) ?? null;
      const name = metadata?.dsas?.deceased?.name ?? metadata?.name ?? `Tablet #${tokenId}`;

      const fullPrompt = `Memorial portrait of ${name}, dignified, soft natural light, photographic quality, gentle expression. Scene: ${body.data.prompt}`;

      try {
        const url = await generateImageDataUrl(fullPrompt);
        return reply.send({ url });
      } catch (err) {
        const detail = describeUpstreamError(err);
        request.log.error({ err }, "cloud-portrait failed");
        return reply.code(502).send({ error: "image_provider_failed", detail });
      }
    },
  );

  // POST /api/personas/:tokenId/simli-session — auth + owner. Mints a Simli
  // compose-mode session token bound to the avatar face configured for this
  // tablet (or the default face). Returned token is short-lived and used by
  // the browser to open the WebRTC pipe via simli-client.
  app.post(
    "/:tokenId/simli-session",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      if (!simliConfigured()) {
        return reply.code(503).send({ error: "simli_not_configured" });
      }

      // Per-tablet faceId override: tablet.metadata.dsas.avatar?.simliFaceId
      // takes precedence over the env default. Lookup is best-effort; if the
      // tablet hasn't been synced from chain yet, fall through to default.
      let faceId: string | undefined;
      try {
        const tablet = await prisma.tablet.findUnique({
          where: { tokenId: BigInt(params.data.tokenId) },
        });
        const md = tablet?.metadataJson as TabletMetadata | null;
        const candidate = (md?.dsas as { avatar?: { simliFaceId?: unknown } } | undefined)?.avatar
          ?.simliFaceId;
        if (typeof candidate === "string" && candidate.length > 0) faceId = candidate;
      } catch (err) {
        request.log.warn({ err }, "simli-session: tablet lookup failed, using default face");
      }

      try {
        const result = await createComposeSessionToken({ faceId });
        return reply.send(result);
      } catch (err) {
        if (err instanceof SimliError) {
          request.log.error({ err, upstream: err.upstream }, "simli session mint failed");
          return reply
            .code(err.status >= 500 ? 502 : err.status)
            .send({ error: "simli_session_failed", detail: err.message });
        }
        const detail = err instanceof Error ? err.message : "simli_unknown_error";
        request.log.error({ err }, "simli session unexpected error");
        return reply.code(502).send({ error: "simli_session_failed", detail });
      }
    },
  );

  // POST /api/personas/:tokenId/cloud-video — short video generation via fal.ai.
  // Returns { url } pointing to the rendered MP4. Render takes 30–90s.
  app.post(
    "/:tokenId/cloud-video",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

      const body = z
        .object({ prompt: z.string().min(1).max(1000) })
        .safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body" });

      const tokenId = BigInt(params.data.tokenId);
      const tablet = await prisma.tablet.findUnique({ where: { tokenId } });
      const metadata = (tablet?.metadataJson as TabletMetadata | null) ?? null;
      const name = metadata?.dsas?.deceased?.name ?? metadata?.name ?? `Tablet #${tokenId}`;

      const fullPrompt = `Cinematic memorial video for ${name}. ${body.data.prompt}. Soft natural lighting, gentle camera movement, photo-realistic, dignified atmosphere.`;

      try {
        const url = await generateVideoUrl(fullPrompt);
        return reply.send({ url });
      } catch (err) {
        const detail = describeUpstreamError(err);
        request.log.error({ err }, "cloud-video failed");
        return reply.code(502).send({ error: "video_provider_failed", detail });
      }
    },
  );
};

function escapeSseData(s: string): string {
  // SSE data lines split on \n. Replace embedded newlines/CR with explicit
  // markers so a single delta doesn't split into two frames.
  return s.replace(/\r/g, "").replace(/\n/g, "\\n");
}

/**
 * Convert an upstream provider error into a short, user-readable detail.
 * Surfaces billing / quota issues in plain language regardless of whether the
 * error came from axios (image/voice) or fetch (chat streams).
 */
function describeUpstreamError(err: unknown): string {
  // axios path (image / voice / video): structured error.response.data.
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    const data = err.response?.data as
      | {
          error?: { code?: string; message?: string; type?: string };
          detail?: string | unknown;
        }
      | undefined;

    // OpenAI shape: { error: { code, message, type } }
    const code = data?.error?.code;
    const msg = data?.error?.message;
    if (code === "billing_hard_limit_reached") {
      return "OpenAI 帳戶已達設定的每月用量上限,請於 platform.openai.com 後台調高 monthly cap。";
    }
    if (code === "insufficient_quota" || data?.error?.type === "insufficient_quota") {
      return "OpenAI 帳戶餘額不足,請至 platform.openai.com 充值,或設定 ANTHROPIC_API_KEY 改用 Claude。";
    }
    if (msg) return msg.slice(0, 240);

    // fal.ai shape: { detail: "User is locked. Reason: Exhausted balance. ..." }
    if (typeof data?.detail === "string") {
      if (data.detail.includes("Exhausted balance") || data.detail.includes("locked")) {
        return "fal.ai 帳戶餘額不足或被鎖定,請至 fal.ai/dashboard/billing 充值。";
      }
      if (data.detail.includes("Authentication")) {
        return "fal.ai API key 無效,請至 fal.ai/dashboard/keys 重新建立並更新 .env 的 FAL_API_KEY。";
      }
      return data.detail.slice(0, 240);
    }
    // ElevenLabs shape: { detail: { status: ..., message: ... } } sometimes.
    if (data?.detail && typeof data.detail === "object") {
      const d = data.detail as { message?: string; status?: string };
      if (d.message) return d.message.slice(0, 240);
    }

    return `Upstream ${status ?? "?"}`;
  }
  // fetch path (chat stream): error message embeds the raw upstream body.
  if (err instanceof Error) {
    if (err.message.includes("billing_hard_limit_reached")) {
      return "OpenAI 帳戶已達設定的每月用量上限,請於 platform.openai.com 後台調高 monthly cap,或設定 ANTHROPIC_API_KEY 改用 Claude。";
    }
    if (err.message.includes("insufficient_quota")) {
      return "OpenAI 帳戶餘額不足,請至 platform.openai.com 充值,或設定 ANTHROPIC_API_KEY 改用 Claude。";
    }
    if (err.message.includes("invalid_api_key") || err.message.includes("Incorrect API key")) {
      return "API key 無效,請檢查 .env 設定。";
    }
    return err.message.slice(0, 240);
  }
  return "unknown error";
}
