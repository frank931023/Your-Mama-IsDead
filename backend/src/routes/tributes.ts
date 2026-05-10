/**
 * 線上靈堂留言板 (Tributes) HTTP 路由
 *
 * 端點:
 *   GET  /api/tributes/:tokenId        列出某座塔位的所有留言(時間倒序)
 *   POST /api/tributes/:tokenId        新增一則留言(可匿名,不要求 SIWE 登入)
 *
 * 設計重點:
 *   - 留言不要求登入,任何訪客都能祭拜(符合線上靈堂的「來客即賓」精神)
 *   - 但有連錢包者會把地址寫進來,家屬能辨識自家人 vs 訪客
 *   - 留言不可變:沒有 PUT/DELETE,符合「祭拜上香一次就是一次」的儀式感
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { isAddress, getAddress } from "viem";
import { prisma } from "../db.js";

const TokenIdParam = z.object({
  tokenId: z.string().regex(/^\d+$/u, "tokenId must be base-10"),
});

const CreateBody = z.object({
  message: z.string().min(1).max(1000),
  fromName: z.string().max(80).optional(),
  fromAddress: z
    .string()
    .optional()
    .refine((v) => !v || isAddress(v), { message: "fromAddress must be 0x EIP-55 hex" }),
});

interface SerializedTribute {
  id: string;
  tokenId: string;
  fromAddress: string | null;
  fromName: string | null;
  message: string;
  createdAt: string;
}

function serialize(t: {
  id: string;
  tokenId: bigint;
  fromAddress: string | null;
  fromName: string | null;
  message: string;
  createdAt: Date;
}): SerializedTribute {
  return {
    id: t.id,
    tokenId: t.tokenId.toString(),
    fromAddress: t.fromAddress,
    fromName: t.fromName,
    message: t.message,
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
      },
    });
    return reply.code(201).send(serialize(created));
  });
};
