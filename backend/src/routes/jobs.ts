import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getAddress } from "viem";
import { prisma } from "../db.js";
import { env } from "../lib/env.js";
import { getOwnerOf } from "../chain.js";
import { requireAuth } from "../auth/middleware.js";
import { enqueueTrainingJob } from "../queue/training.js";

const CreateBody = z.object({
  tokenId: z.string().regex(/^\d+$/u, "tokenId must be base-10"),
});

const CompleteBody = z.object({
  artifactUri: z.string().min(1),
  txHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/u, "txHash must be 0x + 64 hex")
    .optional(),
  artifactCid: z.string().optional(),
});

const IdParam = z.object({ id: z.string().min(1).max(64) });
const TokenIdParam = z.object({ tokenId: z.string().regex(/^\d+$/u) });

interface SerializedJob {
  id: string;
  tokenId: string;
  status: string;
  artifactCid: string | null;
  artifactURI: string | null;
  txHash: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

function serializeJob(j: {
  id: string;
  tokenId: bigint;
  status: string;
  artifactCid: string | null;
  artifactURI: string | null;
  txHash: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}): SerializedJob {
  return {
    id: j.id,
    tokenId: j.tokenId.toString(),
    status: j.status,
    artifactCid: j.artifactCid,
    artifactURI: j.artifactURI,
    txHash: j.txHash,
    error: j.error,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
  };
}

export const jobRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /api/jobs  — owner-only
  app.post("/", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const tokenId = BigInt(parsed.data.tokenId);
    const principal = request.user?.address;
    if (!principal) return reply.code(401).send({ error: "unauthorized" });

    let owner: string;
    try {
      owner = await getOwnerOf(tokenId);
    } catch (err) {
      request.log.error({ err }, "ownerOf failed");
      return reply.code(502).send({ error: "chain_lookup_failed" });
    }
    if (getAddress(owner) !== getAddress(principal)) {
      return reply.code(403).send({ error: "not_token_owner" });
    }

    // Ensure parent Tablet row exists (FK constraint).
    await prisma.tablet.upsert({
      where: { tokenId },
      create: {
        tokenId,
        owner: getAddress(owner),
        tokenURI: "",
      },
      update: { owner: getAddress(owner) },
    });

    const job = await prisma.trainingJob.create({
      data: { tokenId, status: "QUEUED" },
    });

    try {
      await enqueueTrainingJob({ jobId: job.id, tokenId: tokenId.toString() });
    } catch (err) {
      request.log.error({ err }, "enqueue failed");
      // Job row remains QUEUED; operator can retry.
    }

    return reply.code(201).send(serializeJob(job));
  });

  // GET /api/jobs/:id
  app.get("/:id", async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });
    const job = await prisma.trainingJob.findUnique({ where: { id: params.data.id } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    return reply.send(serializeJob(job));
  });

  // POST /api/jobs/:id/complete  — trainer-only via X-Trainer-Key
  app.post("/:id/complete", async (request, reply) => {
    if (!env.TRAINER_API_KEY) {
      return reply.code(503).send({ error: "trainer_api_key_not_configured" });
    }
    const headerKey = request.headers["x-trainer-key"];
    if (typeof headerKey !== "string" || headerKey !== env.TRAINER_API_KEY) {
      return reply.code(401).send({ error: "invalid_trainer_key" });
    }

    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_id" });
    const body = CompleteBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
    }

    const existing = await prisma.trainingJob.findUnique({ where: { id: params.data.id } });
    if (!existing) return reply.code(404).send({ error: "job_not_found" });

    const cid =
      body.data.artifactCid ??
      (body.data.artifactUri.startsWith("ipfs://")
        ? body.data.artifactUri.slice("ipfs://".length).split("/")[0] ?? null
        : null);

    const updated = await prisma.trainingJob.update({
      where: { id: params.data.id },
      data: {
        status: "DONE",
        artifactURI: body.data.artifactUri,
        artifactCid: cid,
        txHash: body.data.txHash ?? null,
        finishedAt: new Date(),
      },
    });

    // Mirror to Tablet cache so future GETs return the new artifact URI.
    await prisma.tablet
      .update({
        where: { tokenId: existing.tokenId },
        data: { artifactURI: body.data.artifactUri },
      })
      .catch(() => {
        /* tablet row may not exist if cache was wiped; ignore */
      });

    return reply.send(serializeJob(updated));
  });

  // GET /api/jobs/by-tablet/:tokenId
  app.get("/by-tablet/:tokenId", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
    const tokenId = BigInt(params.data.tokenId);
    const rows = await prisma.trainingJob.findMany({
      where: { tokenId },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({
      tokenId: tokenId.toString(),
      jobs: rows.map(serializeJob),
    });
  });
};
