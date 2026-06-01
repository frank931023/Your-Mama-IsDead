/**
 * Simli 自訂 avatar 生成路由
 *
 * mint 流程中,使用者上傳逝者大頭照後呼叫這裡,把照片轉給 Simli 生成一個
 * 專屬 faceId。拿到的 faceId 會寫進 tablet metadata 的 dsas.avatar.simliFaceId,
 * 隨 metadata 一起上 IPFS / 上鏈;之後聊天頁開 session 時 (見 personas.ts 的
 * /:tokenId/simli-session) 就用這張臉做唇形同步。
 *
 * 為什麼放在這裡而不是 personas.ts:
 *   生成發生在 mint *之前*,當下還沒有 tokenId,所以不能用 requireOwner。
 *   只要 requireAuth (SIWE 登入態) 即可,避免匿名請求消耗 Simli 配額。
 *
 * 生成是非同步的 (Simli 文件說可能要數分鐘),但 faceId 提交當下就拿得到,
 * 且可立即用於 compose/token。前端可選擇性輪詢 /face/:id/status 顯示進度。
 *
 * 配額已滿 (HTTP 403) 時,generateFaceFromImage 預設會自動刪掉帳號裡最舊的
 * 一張自訂臉騰出名額再重試一次 (免費 tier 自訂臉數量很少)。
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import {
  generateFaceFromImage,
  getFaceStatus,
  simliConfigured,
  SimliError,
} from "../lib/simli.js";

const FaceIdParam = z.object({
  faceId: z.string().min(1).max(128),
});

// 圖片硬上限:臉部生成不需要大圖,擋掉誤傳的影片 / 巨檔,也保護 Simli 配額。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB
const ALLOWED_IMAGE_TYPES = /^image\/(jpe?g|png|webp)$/i;

export const simliRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/simli/face
   * multipart/form-data,單一 `image` 欄位 (逝者大頭照)。
   * 回傳 { faceId, status, evicted } —— faceId 立即可用於開 session。
   */
  app.post("/face", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!simliConfigured()) {
      return reply.code(503).send({ error: "simli_not_configured" });
    }
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "expected_multipart" });
    }

    const filePart = await request.file();
    if (!filePart) {
      return reply.code(400).send({ error: "no_file" });
    }

    const contentType = filePart.mimetype || "application/octet-stream";
    if (!ALLOWED_IMAGE_TYPES.test(contentType)) {
      return reply.code(415).send({ error: "unsupported_image_type", detail: contentType });
    }

    // @fastify/multipart streams the file; buffer it (faces are small) so we can
    // measure size and hand a Buffer to the Simli helper.
    const image = await filePart.toBuffer();
    if (image.length === 0) {
      return reply.code(400).send({ error: "empty_file" });
    }
    if (image.length > MAX_IMAGE_BYTES) {
      return reply.code(413).send({ error: "image_too_large", limit: MAX_IMAGE_BYTES });
    }

    try {
      // Legacy generation path (POST /generateFaceID): works on the free tier,
      // not capped by the GS quota, so no eviction needed. Switch to useTrinity
      // (+ evictWhenFull) only after the Simli account's GS quota is upgraded.
      const result = await generateFaceFromImage(image, {
        fileName: filePart.filename,
        contentType,
        faceName: `dsas_${request.user?.address ?? "anon"}_${image.length}`,
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof SimliError) {
        request.log.error({ err, upstream: err.upstream }, "simli face generation failed");
        // 配額滿且無臉可刪,或其它上游錯誤:回 4xx/502,前端據此降級到預設臉。
        return reply
          .code(err.status >= 500 ? 502 : err.status)
          .send({ error: "simli_face_failed", detail: err.message });
      }
      const detail = err instanceof Error ? err.message : "simli_unknown_error";
      request.log.error({ err }, "simli face unexpected error");
      return reply.code(502).send({ error: "simli_face_failed", detail });
    }
  });

  /**
   * GET /api/simli/face/:faceId/status
   * 查生成進度。回傳 { faceId, status, queuePosition }。
   * status: "not_found" | "pending" | "processing" | "completed" | ...
   */
  app.get("/face/:faceId/status", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!simliConfigured()) {
      return reply.code(503).send({ error: "simli_not_configured" });
    }
    const params = FaceIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_face_id" });

    try {
      const status = await getFaceStatus(params.data.faceId);
      return reply.send(status);
    } catch (err) {
      if (err instanceof SimliError) {
        return reply
          .code(err.status >= 500 ? 502 : err.status)
          .send({ error: "simli_status_failed", detail: err.message });
      }
      const detail = err instanceof Error ? err.message : "simli_unknown_error";
      request.log.error({ err }, "simli face status error");
      return reply.code(502).send({ error: "simli_status_failed", detail });
    }
  });
};
