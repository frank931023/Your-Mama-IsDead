/**
 * Fastify preHandler middleware:身份與所有權檢查
 *
 * - requireAuth        驗證 Authorization: Bearer <JWT>
 * - requireOwner(...)  進一步要求 JWT principal 必須是該 tokenId 的鏈上 owner
 *
 * 設計重點:owner 檢查直接讀鏈,不信任 DB,因為 NFT 可能轉手後 DB 還沒 sync。
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { getAddress } from "viem";
import { getOwnerOf } from "../chain.js";

/**
 * 驗證 /api/auth/verify 簽發的 Bearer JWT。
 * 成功後 @fastify/jwt 會把 payload 寫到 request.user。
 */
export const requireAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    request.log.warn({ err }, "JWT verification failed");
    await reply.code(401).send({ error: "unauthorized" });
  }
};

/**
 * 高階 middleware:確認 JWT 的擁有者就是該 tokenId 在鏈上的 owner。
 *
 * 用法: { preHandler: [requireAuth, requireOwner("tokenId")] }
 * 必須掛在 requireAuth 之後,因為要讀 request.user.address。
 *
 * @param paramName route param 名稱,預設 "tokenId"
 */
export function requireOwner(paramName: string = "tokenId"): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string | undefined>;
    const raw = params[paramName];
    if (!raw) {
      await reply.code(400).send({ error: `missing ${paramName} param` });
      return;
    }

    let tokenId: bigint;
    try {
      tokenId = BigInt(raw);
    } catch {
      await reply.code(400).send({ error: `invalid ${paramName}` });
      return;
    }

    const principal = request.user?.address;
    if (!principal) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }

    let owner: string;
    try {
      owner = await getOwnerOf(tokenId);
    } catch (err) {
      request.log.error({ err, tokenId: tokenId.toString() }, "ownerOf lookup failed");
      await reply.code(502).send({ error: "chain_lookup_failed" });
      return;
    }

    if (getAddress(owner) !== getAddress(principal)) {
      await reply.code(403).send({ error: "not_token_owner" });
      return;
    }
  };
}
