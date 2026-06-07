/**
 * 哀悼版 (Memorial Stories) HTTP 路由
 *
 * 端點:
 *   GET    /api/stories/:tokenId            公開:列出已核可 (APPROVED + ONCHAIN) 的回憶
 *   GET    /api/stories/:tokenId/all        屋主:列出全部狀態 (含 PENDING / REJECTED) 供審核
 *   POST   /api/stories/:tokenId            任何人投稿一段回憶 (內容先 pin 到 IPFS,狀態 PENDING)
 *   PATCH  /api/stories/:tokenId/:storyId   屋主:核可 / 隱藏 (APPROVED | REJECTED)
 *   DELETE /api/stories/:tokenId/:storyId   屋主:硬刪 DB row (IPFS CID 仍在=不可竄改)
 *   POST   /api/stories/:tokenId/commit     屋主:把剛上鏈那批 APPROVED 翻成 ONCHAIN (dedup)
 *
 * 設計重點:
 *   - 投稿不要求登入,任何訪客都能留下回憶 (符合線上靈堂「來客即賓」精神)
 *   - 但預設 PENDING,屋主審核過才公開可見、才會被批次上鏈 (擋濫用)
 *   - 屋主動作走 requireAuth + requireOwner("tokenId") 直接讀鏈驗持有
 *   - story 內容投稿當下就 pin 到 IPFS,拿到不可竄改的 contentCid (immutability proof)
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { isAddress, getAddress } from "viem";
import { prisma } from "../db.js";
import { pinJSON } from "../lib/ipfs.js";
import { requireAuth, requireOwner } from "../auth/middleware.js";

const TokenIdParam = z.object({
  tokenId: z.string().regex(/^\d+$/u, "tokenId must be base-10"),
});

const StoryIdParam = TokenIdParam.extend({
  storyId: z.string().min(1),
});

const IpfsUri = z
  .string()
  .max(256)
  .refine((v) => v.startsWith("ipfs://") || v.startsWith("ar://"), {
    message: "photoUri must be an ipfs:// or ar:// uri",
  });

const CreateBody = z.object({
  title: z.string().min(1).max(120),
  // body 是 Tiptap 輸出的 HTML;格式標籤會膨脹長度,放寬到 20000。
  // 渲染端用 DOMPurify 淨化 (擋 XSS)。
  body: z.string().min(1).max(20000),
  authorName: z.string().max(80).optional(),
  authorAddress: z
    .string()
    .optional()
    .refine((v) => !v || isAddress(v), { message: "authorAddress must be 0x EIP-55 hex" }),
  photoUri: IpfsUri.optional(),
  refDate: z.string().max(40).optional(),
});

const ModerateBody = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

const CommitBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

interface SerializedStory {
  id: string;
  tokenId: string;
  title: string;
  body: string;
  authorName: string | null;
  authorAddress: string | null;
  photoUri: string | null;
  refDate: string | null;
  contentCid: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "ONCHAIN";
  createdAt: string;
}

function serialize(s: {
  id: string;
  tokenId: bigint;
  title: string;
  body: string;
  authorName: string | null;
  authorAddress: string | null;
  photoUri: string | null;
  refDate: string | null;
  contentCid: string;
  status: SerializedStory["status"];
  createdAt: Date;
}): SerializedStory {
  return {
    id: s.id,
    tokenId: s.tokenId.toString(),
    title: s.title,
    body: s.body,
    authorName: s.authorName,
    authorAddress: s.authorAddress,
    photoUri: s.photoUri,
    refDate: s.refDate,
    contentCid: s.contentCid,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
  };
}

export const storyRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /api/stories/:tokenId — 公開:只回已核可的 (APPROVED + ONCHAIN),新到舊
  app.get("/:tokenId", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

    const tokenId = BigInt(params.data.tokenId);
    const rows = await prisma.memorialStory.findMany({
      where: { tokenId, status: { in: ["APPROVED", "ONCHAIN"] } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return reply.send(rows.map(serialize));
  });

  // GET /api/stories/:tokenId/all — 屋主:列出全部狀態供審核
  app.get(
    "/:tokenId/all",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

      const tokenId = BigInt(params.data.tokenId);
      const rows = await prisma.memorialStory.findMany({
        where: { tokenId },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });
      return reply.send(rows.map(serialize));
    },
  );

  // POST /api/stories/:tokenId — 任何人投稿;內容先 pin 到 IPFS,狀態 PENDING
  app.post("/:tokenId", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

    const body = CreateBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
    }

    const tokenId = BigInt(params.data.tokenId);
    const authorAddress = body.data.authorAddress ? getAddress(body.data.authorAddress) : null;
    const createdAtIso = new Date().toISOString();

    // 1. 先把 story 內容 pin 到 IPFS 拿不可竄改的 contentCid。
    let contentCid: string;
    try {
      const pinned = await pinJSON(
        {
          v: 1,
          type: "dsas-memorial-story",
          tokenId: tokenId.toString(),
          title: body.data.title.trim(),
          body: body.data.body.trim(),
          author: body.data.authorName?.trim() || null,
          authorAddress,
          photo: body.data.photoUri ?? null,
          date: body.data.refDate ?? null,
          createdAt: createdAtIso,
        },
        `story-${tokenId.toString()}-${createdAtIso}`,
      );
      contentCid = pinned.cid;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason === "pinata_not_configured") {
        return reply.code(503).send({ error: "pinata_not_configured" });
      }
      request.log.error({ err }, "story pin to IPFS failed");
      return reply.code(502).send({ error: "story_pin_failed" });
    }

    // 2. 存進 DB,狀態 PENDING。
    const created = await prisma.memorialStory.create({
      data: {
        tokenId,
        title: body.data.title.trim(),
        body: body.data.body.trim(),
        authorName: body.data.authorName?.trim() || null,
        authorAddress,
        photoUri: body.data.photoUri ?? null,
        refDate: body.data.refDate ?? null,
        contentCid,
      },
    });
    return reply.code(201).send(serialize(created));
  });

  // PATCH /api/stories/:tokenId/:storyId — 屋主審核 (核可 / 隱藏)
  app.patch(
    "/:tokenId/:storyId",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = StoryIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_params" });

      const body = ModerateBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
      }

      const tokenId = BigInt(params.data.tokenId);
      // 確認 story 屬於這座塔位 (避免越權改別座的)。
      const existing = await prisma.memorialStory.findUnique({
        where: { id: params.data.storyId },
      });
      if (!existing || existing.tokenId !== tokenId) {
        return reply.code(404).send({ error: "story_not_found" });
      }

      const updated = await prisma.memorialStory.update({
        where: { id: params.data.storyId },
        data: { status: body.data.status },
      });
      return reply.send(serialize(updated));
    },
  );

  // DELETE /api/stories/:tokenId/:storyId — 屋主硬刪 DB row
  app.delete(
    "/:tokenId/:storyId",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = StoryIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_params" });

      const tokenId = BigInt(params.data.tokenId);
      const existing = await prisma.memorialStory.findUnique({
        where: { id: params.data.storyId },
      });
      if (!existing || existing.tokenId !== tokenId) {
        return reply.code(404).send({ error: "story_not_found" });
      }

      await prisma.memorialStory.delete({ where: { id: params.data.storyId } });
      return reply.code(204).send();
    },
  );

  // POST /api/stories/:tokenId/commit — 屋主把剛上鏈那批 APPROVED 翻成 ONCHAIN
  app.post(
    "/:tokenId/commit",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

      const body = CommitBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
      }

      const tokenId = BigInt(params.data.tokenId);
      const result = await prisma.memorialStory.updateMany({
        where: { id: { in: body.data.ids }, tokenId, status: "APPROVED" },
        data: { status: "ONCHAIN" },
      });
      return reply.send({ committed: result.count });
    },
  );
};
