import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import axios, { AxiosError, type AxiosResponse } from "axios";
import { env } from "../lib/env.js";
import { requireAuth, requireOwner } from "../auth/middleware.js";

const TokenIdParam = z.object({
  tokenId: z.string().regex(/^\d+$/u),
});

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
};
