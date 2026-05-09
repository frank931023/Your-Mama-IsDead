import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  getArtifactURI,
  getChildrenOf,
  getOwnerOf,
  getParentOf,
  getTokenURI,
} from "../chain.js";
import { fetchIPFS } from "../lib/ipfs.js";

const TokenIdParam = z.object({
  tokenId: z.string().regex(/^\d+$/u, "tokenId must be base-10"),
});

const AddressParam = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/u, "address must be 0x-hex"),
});

function parseTokenId(input: string): bigint {
  return BigInt(input);
}

function serializeTablet(t: {
  tokenId: bigint;
  owner: string;
  parentTokenId: bigint | null;
  tokenURI: string;
  artifactURI: string | null;
  metadataJson: unknown;
  syncedAt: Date | null;
}): Record<string, unknown> {
  return {
    tokenId: t.tokenId.toString(),
    owner: t.owner,
    parentTokenId: t.parentTokenId === null ? null : t.parentTokenId.toString(),
    tokenURI: t.tokenURI,
    artifactURI: t.artifactURI,
    metadata: t.metadataJson,
    syncedAt: t.syncedAt?.toISOString() ?? null,
  };
}

async function syncOnce(tokenId: bigint): Promise<{
  owner: string;
  tokenURI: string;
  artifactURI: string;
  parentTokenId: bigint | null;
  metadata: unknown | null;
}> {
  const [ownerRaw, tokenURI, artifactURI, parentRaw] = await Promise.all([
    getOwnerOf(tokenId),
    getTokenURI(tokenId),
    getArtifactURI(tokenId).catch(() => ""),
    getParentOf(tokenId).catch(() => 0n),
  ]);

  const owner = getAddress(ownerRaw);
  const parentTokenId = parentRaw === 0n ? null : parentRaw;

  let metadata: unknown | null = null;
  if (tokenURI) {
    try {
      metadata = await fetchIPFS(tokenURI);
    } catch {
      metadata = null;
    }
  }

  await prisma.tablet.upsert({
    where: { tokenId },
    create: {
      tokenId,
      owner,
      parentTokenId,
      tokenURI,
      artifactURI: artifactURI || null,
      metadataJson: metadata as never,
      syncedAt: new Date(),
    },
    update: {
      owner,
      parentTokenId,
      tokenURI,
      artifactURI: artifactURI || null,
      metadataJson: metadata as never,
      syncedAt: new Date(),
    },
  });

  return { owner, tokenURI, artifactURI, parentTokenId, metadata };
}

export const tabletRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /api/tablets/registry  —  every tablet currently in DB, newest first.
  app.get("/registry", async () => {
    const rows = await prisma.tablet.findMany({ orderBy: { tokenId: "desc" } });
    return rows.map(serializeTablet);
  });

  // POST /api/tablets/scan  —  probe the chain for token ids 1..MAX and sync each
  // newly-found tablet into the DB. Stops after STOP_AFTER_MISSES consecutive
  // ownerOf reverts. Returns the synced rows.
  app.post("/scan", async (request, reply) => {
    const MAX_PROBE = 200n;
    const STOP_AFTER_MISSES = 5;

    const found: bigint[] = [];
    let misses = 0;
    for (let i = 1n; i <= MAX_PROBE; i++) {
      try {
        await getOwnerOf(i);
        found.push(i);
        misses = 0;
      } catch {
        misses++;
        if (misses >= STOP_AFTER_MISSES) break;
      }
    }

    for (const id of found) {
      try {
        await syncOnce(id);
      } catch (err) {
        request.log.warn({ err, tokenId: id.toString() }, "scan: syncOnce failed");
      }
    }

    const rows = await prisma.tablet.findMany({
      where: { tokenId: { in: found } },
      orderBy: { tokenId: "desc" },
    });
    return reply.send({ found: found.length, tablets: rows.map(serializeTablet) });
  });

  // GET /api/tablets/:tokenId
  app.get("/:tokenId", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_token_id" });
    }
    const tokenId = parseTokenId(params.data.tokenId);

    const cached = await prisma.tablet.findUnique({ where: { tokenId } });
    let synced = cached;

    // Always re-read children since they're cheap and not cached.
    let children: bigint[] = [];
    try {
      children = await getChildrenOf(tokenId);
    } catch (err) {
      request.log.warn({ err }, "childrenOf lookup failed");
    }

    if (!synced) {
      try {
        await syncOnce(tokenId);
        synced = await prisma.tablet.findUnique({ where: { tokenId } });
      } catch (err) {
        request.log.error({ err }, "initial sync failed");
        return reply.code(404).send({ error: "tablet_not_found" });
      }
    }

    if (!synced) return reply.code(404).send({ error: "tablet_not_found" });

    return reply.send({
      ...serializeTablet(synced),
      children: children.map((c) => c.toString()),
    });
  });

  // GET /api/tablets/by-owner/:address  (legacy)
  app.get("/by-owner/:address", async (request, reply) => {
    const params = AddressParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_address" });
    }
    const owner = getAddress(params.data.address);
    const rows = await prisma.tablet.findMany({
      where: { owner },
      orderBy: { tokenId: "asc" },
    });
    return reply.send({
      address: owner,
      tablets: rows.map(serializeTablet),
    });
  });

  // GET /api/tablets?owner=0x...
  // Returns a bare array (matches frontend `getOwned`).
  app.get("/", async (request, reply) => {
    const query = z
      .object({ owner: z.string().refine(isAddress, "owner must be a 0x address") })
      .safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query", issues: query.error.issues });
    }
    const owner = getAddress(query.data.owner);
    const rows = await prisma.tablet.findMany({
      where: { owner },
      orderBy: { tokenId: "asc" },
    });
    return reply.send(rows.map(serializeTablet));
  });

  // POST /api/tablets/:tokenId/sync
  app.post("/:tokenId/sync", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_token_id" });
    }
    const tokenId = parseTokenId(params.data.tokenId);
    try {
      const result = await syncOnce(tokenId);
      const row = await prisma.tablet.findUnique({ where: { tokenId } });
      return reply.send({
        synced: true,
        ...result,
        parentTokenId: result.parentTokenId?.toString() ?? null,
        tablet: row ? serializeTablet(row) : null,
      });
    } catch (err) {
      request.log.error({ err }, "sync failed");
      return reply.code(502).send({ error: "chain_sync_failed" });
    }
  });

  // GET /api/tablets/:tokenId/lineage
  app.get("/:tokenId/lineage", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_token_id" });
    }
    const root = parseTokenId(params.data.tokenId);
    const MAX_DEPTH = 6;

    interface Node {
      tokenId: string;
      depth: number;
      children: string[];
    }
    const nodes: Record<string, Node> = {};
    const visited = new Set<string>();
    const queue: Array<{ id: bigint; depth: number }> = [{ id: root, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const key = id.toString();
      if (visited.has(key)) continue;
      visited.add(key);

      let children: bigint[] = [];
      if (depth < MAX_DEPTH) {
        try {
          children = await getChildrenOf(id);
        } catch (err) {
          request.log.warn({ err, tokenId: key }, "childrenOf during lineage failed");
        }
      }
      nodes[key] = {
        tokenId: key,
        depth,
        children: children.map((c) => c.toString()),
      };
      for (const c of children) {
        if (!visited.has(c.toString())) {
          queue.push({ id: c, depth: depth + 1 });
        }
      }
    }

    return reply.send({
      root: root.toString(),
      maxDepth: MAX_DEPTH,
      nodes,
    });
  });
};
