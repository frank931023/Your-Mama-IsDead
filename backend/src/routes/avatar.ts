/**
 * 自建 LAM 渲染机 avatar 路由 (替代 Simli)
 *
 * 两个职责:
 *   1. POST /api/avatar/build  — mint 阶段上传逝者照片 → 渲染机用 LAM 重建 3DGS
 *      avatar (阻塞 ~100s)。只需 requireAuth (此时还没 tokenId)。回传 { label, url }
 *      写进 metadata.dsas.avatar.{avatarLabel,avatarUrl}。
 *   2. POST /api/avatar/build-voice — 同理上传音频 → 克隆声音 → { label }。
 *   3. POST /api/personas/... 的 avatar-session 在 personas.ts (要 tokenId+owner)。
 *      为内聚, avatar-session 也放这里, 用 /:tokenId/avatar-session, 挂在
 *      /api/personas 前缀下 (见 server.ts 注册)。
 *
 * 渲染机本身是 stateless + persona-agnostic: avatar/voice 只是 label, 实时对话
 * 走前端直连的 WebSocket (后端只签短期 token)。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { TabletMetadata } from "../../../shared/types/tablet.js";
import { prisma } from "../db.js";
import { requireAuth, requireOwner } from "../auth/middleware.js";
import {
  buildAvatar,
  buildVoice,
  buildAvatarSession,
  renderConfigured,
  RenderError,
} from "../lib/render.js";

const TokenIdParam = z.object({ tokenId: z.string().regex(/^\d+$/u) });
// 安全 label: 渲染机要求 [A-Za-z0-9_-]+
const LabelField = z.string().regex(/^[A-Za-z0-9_-]+$/u).min(1).max(128);

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 渲染机 /upload_avatar 上限 20MB
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 渲染机 /upload_voice 上限 25MB
const ALLOWED_IMAGE_TYPES = /^image\/(jpe?g|png|webp)$/i;
const ALLOWED_AUDIO_TYPES = /^(audio\/.+|video\/webm|application\/octet-stream)$/i;

export const avatarRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/avatar/build — multipart { file: 照片, label }。
   * 渲染机 LAM 重建 ~100s, 故超时给足。回传 { label, url, took_sec, size }。
   */
  app.post("/build", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!renderConfigured()) return reply.code(503).send({ error: "render_not_configured" });
    if (!request.isMultipart()) return reply.code(400).send({ error: "expected_multipart" });

    let label: string | undefined;
    let image: Buffer | undefined;
    let fileName = "portrait.jpg";
    let contentType = "image/jpeg";

    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "label") {
        label = String(part.value);
      } else if (part.type === "file" && part.fieldname === "file") {
        contentType = part.mimetype || "image/jpeg";
        fileName = part.filename || "portrait.jpg";
        if (!ALLOWED_IMAGE_TYPES.test(contentType)) {
          return reply.code(415).send({ error: "unsupported_image_type", detail: contentType });
        }
        image = await part.toBuffer();
      }
    }

    const parsedLabel = LabelField.safeParse(label);
    if (!parsedLabel.success) return reply.code(400).send({ error: "invalid_label" });
    if (!image || image.length === 0) return reply.code(400).send({ error: "no_file" });
    if (image.length > MAX_IMAGE_BYTES) {
      return reply.code(413).send({ error: "image_too_large", limit: MAX_IMAGE_BYTES });
    }

    try {
      const result = await buildAvatar(image, parsedLabel.data, fileName, contentType);
      return reply.send(result);
    } catch (err) {
      return sendRenderError(reply, request, err, "avatar_build_failed");
    }
  });

  /**
   * POST /api/avatar/build-voice — multipart { file: 音频, label }。克隆声音 profile。
   */
  app.post("/build-voice", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!renderConfigured()) return reply.code(503).send({ error: "render_not_configured" });
    if (!request.isMultipart()) return reply.code(400).send({ error: "expected_multipart" });

    let label: string | undefined;
    let audio: Buffer | undefined;
    let fileName = "voice.wav";
    let contentType = "audio/wav";

    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "label") {
        label = String(part.value);
      } else if (part.type === "file" && part.fieldname === "file") {
        contentType = part.mimetype || "audio/wav";
        fileName = part.filename || "voice.wav";
        if (!ALLOWED_AUDIO_TYPES.test(contentType)) {
          return reply.code(415).send({ error: "unsupported_audio_type", detail: contentType });
        }
        audio = await part.toBuffer();
      }
    }

    const parsedLabel = LabelField.safeParse(label);
    if (!parsedLabel.success) return reply.code(400).send({ error: "invalid_label" });
    if (!audio || audio.length === 0) return reply.code(400).send({ error: "no_file" });
    if (audio.length > MAX_AUDIO_BYTES) {
      return reply.code(413).send({ error: "audio_too_large", limit: MAX_AUDIO_BYTES });
    }

    try {
      const result = await buildVoice(audio, parsedLabel.data, fileName, contentType);
      return reply.send(result);
    } catch (err) {
      return sendRenderError(reply, request, err, "voice_build_failed");
    }
  });
};

/**
 * 挂在 /api/personas 前缀下的 avatar-session 路由 (需要 tokenId + owner)。
 * 在 server.ts 里用 app.register(avatarSessionRoutes, { prefix: "/api/personas" })。
 */
export const avatarSessionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /api/personas/:tokenId/avatar-session — auth + owner. 签一个短期 render
  // token, 回传前端开 WS 直连渲染机所需的全部信息 (wsUrl/token/renderBase/labels)。
  app.post(
    "/:tokenId/avatar-session",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      if (!renderConfigured()) return reply.code(503).send({ error: "render_not_configured" });

      // 从 metadata 读这个 tablet 绑定的 avatar / voice label + avatar zip 相对 URL。
      let avatarLabel: string | undefined;
      let voiceLabel: string | undefined;
      let avatarRelUrl: string | undefined;
      try {
        const tablet = await prisma.tablet.findUnique({
          where: { tokenId: BigInt(params.data.tokenId) },
        });
        const md = tablet?.metadataJson as TabletMetadata | null;
        const av = (md?.dsas as {
          avatar?: { avatarLabel?: unknown; voiceLabel?: unknown; avatarUrl?: unknown };
        } | undefined)?.avatar;
        if (typeof av?.avatarLabel === "string" && av.avatarLabel) avatarLabel = av.avatarLabel;
        if (typeof av?.voiceLabel === "string" && av.voiceLabel) voiceLabel = av.voiceLabel;
        if (typeof av?.avatarUrl === "string" && av.avatarUrl) avatarRelUrl = av.avatarUrl;
      } catch (err) {
        request.log.warn({ err }, "avatar-session: tablet lookup failed, using render defaults");
      }

      const principal = request.user?.address ?? "unknown";
      try {
        const session = buildAvatarSession(
          {
            sub: principal,
            persona: params.data.tokenId,
            avatar: avatarLabel,
            voice: voiceLabel,
          },
          avatarRelUrl,
        );
        return reply.send(session);
      } catch (err) {
        return sendRenderError(reply, request, err, "avatar_session_failed");
      }
    },
  );
};

function sendRenderError(
  reply: FastifyReply,
  request: FastifyRequest,
  err: unknown,
  errorCode: string,
): unknown {
  if (err instanceof RenderError) {
    request.log.error({ err, upstream: err.upstream }, `${errorCode}: render error`);
    return reply.code(err.status >= 500 ? 502 : err.status).send({ error: errorCode, detail: err.message });
  }
  const detail = err instanceof Error ? err.message : "render_unknown_error";
  request.log.error({ err }, `${errorCode}: unexpected`);
  return reply.code(502).send({ error: errorCode, detail });
}
