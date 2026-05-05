import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { isAddress } from "viem";
import { issueNonce, verifyAndCreateSession } from "../auth/siwe.js";

const NonceQuery = z.object({
  address: z.string().refine(isAddress, "address must be a 0x EIP-55 hex"),
});

const VerifyBody = z.object({
  message: z.string().min(1),
  signature: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/u, "signature must be 0x-hex"),
  tokenId: z.string().optional(),
});

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/nonce", async (request, reply) => {
    const parsed = NonceQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    }
    const { nonce, expiresAt, issuedAt } = await issueNonce(parsed.data.address);
    return reply.send({
      nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.post("/verify", async (request, reply) => {
    const parsed = VerifyBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    try {
      const result = await verifyAndCreateSession(
        parsed.data.message,
        parsed.data.signature as `0x${string}`,
        app.jwt,
      );
      return reply.send({
        token: result.jwt,
        address: result.address,
        expiresIn: result.expiresIn,
      });
    } catch (err) {
      request.log.warn({ err }, "SIWE verify rejected");
      return reply.code(401).send({
        error: "siwe_verification_failed",
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  });
};
