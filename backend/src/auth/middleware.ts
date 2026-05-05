import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { getAddress } from "viem";
import { getOwnerOf } from "../chain.js";

/**
 * preHandler that verifies the bearer JWT issued by /api/auth/verify.
 * On success, `request.user.address` is populated by @fastify/jwt.
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
 * Higher-order preHandler that ensures the JWT principal owns `tokenId`
 * (read from `request.params[paramName]`, default "tokenId") on chain.
 * Must run *after* requireAuth.
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
