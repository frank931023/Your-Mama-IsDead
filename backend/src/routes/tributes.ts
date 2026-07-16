/**
 * 線上靈堂留言板 (Tributes) HTTP 路由
 *
 * 端點:
 *   GET    /api/tributes/:tokenId             列出某座塔位的所有留言(時間倒序)
 *   POST   /api/tributes/:tokenId             新增一則留言(可匿名,不要求 SIWE 登入)
 *   DELETE /api/tributes/:tokenId/:tributeId  屋主:刪除不當留言(燈塔典藏管理頁用)
 *
 * 設計重點:
 *   - 留言不要求登入,任何訪客都能祭拜(符合線上靈堂的「來客即賓」精神)
 *   - 但有連錢包者會把地址寫進來,家屬能辨識自家人 vs 訪客
 *   - 留言沒有編輯(沒有 PUT),「祭拜上香一次就是一次」;但屋主可以移除
 *     不當留言 — 哀悼版是公開的,家屬需要最低限度的管理權
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { isAddress, getAddress } from "viem";
import { prisma } from "../db.js";
import { requireAuth, requireOwner } from "../auth/middleware.js";
import { broadcastTribute } from "../lib/ceremony-hub.js";

const TokenIdParam = z.object({
  tokenId: z.string().regex(/^\d+$/u, "tokenId must be base-10"),
});

const TributeIdParam = TokenIdParam.extend({
  tributeId: z.string().min(1),
});

/** 供品小物類型;預設 note(純留言)。 */
const TributeKind = z.enum(["incense", "lotus", "fruit", "tea", "candle", "note"]);

const CreateBody = z.object({
  message: z.string().min(1).max(1000),
  fromName: z.string().max(80).optional(),
  fromAddress: z
    .string()
    .optional()
    .refine((v) => !v || isAddress(v), { message: "fromAddress must be 0x EIP-55 hex" }),
  kind: TributeKind.optional(),
});

interface SerializedTribute {
  id: string;
  tokenId: string;
  fromAddress: string | null;
  fromName: string | null;
  message: string;
  kind: string;
  createdAt: string;
}

function serialize(t: {
  id: string;
  tokenId: bigint;
  fromAddress: string | null;
  fromName: string | null;
  message: string;
  kind: string;
  createdAt: Date;
}): SerializedTribute {
  return {
    id: t.id,
    tokenId: t.tokenId.toString(),
    fromAddress: t.fromAddress,
    fromName: t.fromName,
    message: t.message,
    kind: t.kind,
    createdAt: t.createdAt.toISOString(),
  };
}

export const tributeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /api/tributes/:tokenId — 列出某塔位的所有留言,新到舊排序
  app.get("/:tokenId", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

    const tokenId = BigInt(params.data.tokenId);
    const rows = await prisma.tribute.findMany({
      where: { tokenId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return reply.send(rows.map(serialize));
  });

  // POST /api/tributes/:tokenId — 任何人都可留言,不要求 SIWE
  app.post("/:tokenId", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });

    const body = CreateBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
    }

    const tokenId = BigInt(params.data.tokenId);
    const created = await prisma.tribute.create({
      data: {
        tokenId,
        message: body.data.message.trim(),
        fromName: body.data.fromName?.trim() || null,
        fromAddress: body.data.fromAddress ? getAddress(body.data.fromAddress) : null,
        kind: body.data.kind ?? "note",
      },
    });
    const payload = serialize(created);
    // 線上公祭:同房間(同塔位頁面)的訪客即時看到這份供品
    broadcastTribute(params.data.tokenId, payload);
    return reply.code(201).send(payload);
  });

  // DELETE /api/tributes/:tokenId/:tributeId — 屋主刪除不當留言
  app.delete(
    "/:tokenId/:tributeId",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TributeIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_params" });

      const tokenId = BigInt(params.data.tokenId);
      // 確認留言屬於這座塔位 (避免越權刪別座的)。
      const existing = await prisma.tribute.findUnique({
        where: { id: params.data.tributeId },
      });
      if (!existing || existing.tokenId !== tokenId) {
        return reply.code(404).send({ error: "tribute_not_found" });
      }

      await prisma.tribute.delete({ where: { id: params.data.tributeId } });
      return reply.code(204).send();
    },
  );
};
