/**
 * 線上公祭連線資訊
 *
 *   GET /api/ceremony/:tokenId/connect[?code=]
 *     → { transport: "ws" }                                     連 /api/ceremony/:tokenId/ws
 *     → { transport: "livekit", url, token, identity, room }    用 LiveKit 入房
 *
 * 可見度規則與 WebSocket 版 (ceremony-hub.ts) 相同:PUBLIC 放行、UNLISTED 需邀請碼、
 * PRIVATE 關閉。通道由 CEREMONY_TRANSPORT 決定 (見 lib/livekit.ts)。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../lib/env.js";
import { codeGrantsAccess, inviteCodeFrom, loadTabletAccess } from "../lib/access.js";
import { ceremonyRoomName, ceremonyTransport, createCeremonyToken } from "../lib/livekit.js";

const TokenIdParam = z.object({ tokenId: z.string().regex(/^\d+$/u) });

export const ceremonyRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/:tokenId/connect", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
    const { tokenId } = params.data;

    const row = await loadTabletAccess(BigInt(tokenId));
    if (!row) return reply.code(404).send({ error: "tablet_not_synced" });
    const allowed =
      row.visibility === "PUBLIC" ||
      (row.visibility === "UNLISTED" && codeGrantsAccess(row, inviteCodeFrom(request)));
    if (!allowed) return reply.code(403).send({ error: "ceremony_closed" });

    if (ceremonyTransport() === "ws") return reply.send({ transport: "ws" });

    const identity = randomUUID().replace(/-/g, "").slice(0, 12);
    try {
      const token = await createCeremonyToken(tokenId, identity);
      return reply.send({
        transport: "livekit",
        url: env.LIVEKIT_URL,
        token,
        identity,
        room: ceremonyRoomName(tokenId),
      });
    } catch (err) {
      request.log.error({ err, tokenId }, "livekit token failed");
      return reply.send({ transport: "ws" });
    }
  });
};
