/**
 * 塔位 (Tablet) 相關 HTTP 路由
 *
 * 端點:
 *   GET  /api/tablets/registry             列出 DB 所有塔位
 *   POST /api/tablets/scan                 從鏈上 1..200 探測新塔位並 sync 進 DB
 *   GET  /api/tablets/:tokenId             單一塔位詳情(會做 lazy sync)
 *   GET  /api/tablets/by-owner/:address    依 owner 查詢(legacy)
 *   GET  /api/tablets?owner=0x...          依 owner 查詢(frontend 主用)
 *   POST /api/tablets/:tokenId/sync        強制重新從鏈上同步單一塔位
 *   GET  /api/tablets/:tokenId/lineage     家族樹 (BFS,深度上限 6)
 *
 * 設計重點:
 *   - DB 是鏈上資料的快取,鏈上才是真實來源
 *   - lazy sync:第一次有人查 :tokenId 才把該塔位寫進 DB
 *   - children 不快取,每次都即時讀鏈,因為新增子節點不會主動通知後端
 */
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
import { requireAuth, requireOwner } from "../auth/middleware.js";
import {
  codeGrantsAccess,
  inviteCodeFrom,
  loadTabletAccess,
  newInviteCode,
} from "../lib/access.js";
import { env } from "../lib/env.js";

const TokenIdParam = z.object({
  tokenId: z.string().regex(/^\d+$/u, "tokenId must be base-10"),
});

/**
 * 被隱藏的鏈上 tokenId 集合 (來自 env.EXCLUDED_TOKEN_IDS,逗號分隔)。
 * ERC-721 無法銷毀,demo 時若鏈上有不想展示的舊塔位就在這裡列出;
 * scan / registry / lazy-sync 一律跳過,前端就看不到。
 */
const EXCLUDED_TOKEN_IDS: Set<bigint> = new Set(
  env.EXCLUDED_TOKEN_IDS.split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => BigInt(s)),
);

function isExcluded(tokenId: bigint): boolean {
  return EXCLUDED_TOKEN_IDS.has(tokenId);
}

/** 給 Prisma where 用的排除條件 (空集合時回 undefined,不加條件)。 */
function excludeWhere(): { tokenId: { notIn: bigint[] } } | undefined {
  if (EXCLUDED_TOKEN_IDS.size === 0) return undefined;
  return { tokenId: { notIn: [...EXCLUDED_TOKEN_IDS] } };
}

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
  public: boolean;
  visibility: string;
  syncedAt: Date | null;
}): Record<string, unknown> {
  return {
    tokenId: t.tokenId.toString(),
    owner: t.owner,
    parentTokenId: t.parentTokenId === null ? null : t.parentTokenId.toString(),
    tokenURI: t.tokenURI,
    artifactURI: t.artifactURI,
    metadata: t.metadataJson,
    public: t.public,
    visibility: t.visibility,
    // 注意:inviteCode 絕不進 serialize — 只有 owner 端點 (GET /:tokenId/invite) 回傳。
    syncedAt: t.syncedAt?.toISOString() ?? null,
  };
}

/** 從抓回來的 metadata JSON 讀 dsas.public (容錯,讀不到當 false)。 */
function readPublicFlag(metadata: unknown): boolean {
  if (metadata && typeof metadata === "object") {
    const dsas = (metadata as { dsas?: { public?: unknown } }).dsas;
    if (dsas && typeof dsas === "object" && typeof dsas.public === "boolean") {
      return dsas.public;
    }
  }
  return false;
}

/**
 * 從鏈上抓單一塔位的 owner / tokenURI / artifactURI / parentId,
 * 並順帶把 metadata.json 從 IPFS 拉回來,upsert 進 DB。
 *
 * 此函式是冪等的:重複呼叫只是把資料更新到最新狀態。
 */
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

  // 公開旗標來自 metadata.dsas.public,存成真欄好讓 /registry/public 用 query 過濾。
  // 注意:metadata 抓失敗 (null) 時保守當 false — 但若已有舊 metadata 別誤覆蓋,
  // 故只有成功抓到 metadata 時才更新 public,抓不到就沿用既有值。
  const publicFlag = metadata !== null ? readPublicFlag(metadata) : undefined;

  await prisma.tablet.upsert({
    where: { tokenId },
    create: {
      tokenId,
      owner,
      parentTokenId,
      tokenURI,
      artifactURI: artifactURI || null,
      metadataJson: metadata as never,
      public: publicFlag ?? false,
      // 首次入庫:依鏈上 public 給可見度預設,並發一組邀請碼。
      // 之後可見度只由 PATCH /visibility 管,鏈上同步不覆蓋 (邀請碼不能上鏈)。
      visibility: publicFlag ? "PUBLIC" : "UNLISTED",
      inviteCode: newInviteCode(),
      syncedAt: new Date(),
    },
    update: {
      owner,
      parentTokenId,
      tokenURI,
      artifactURI: artifactURI || null,
      metadataJson: metadata as never,
      ...(publicFlag !== undefined ? { public: publicFlag } : {}),
      syncedAt: new Date(),
    },
  });

  return { owner, tokenURI, artifactURI, parentTokenId, metadata };
}

export const tabletRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /api/tablets/registry  —  every tablet currently in DB, newest first.
  app.get("/registry", async () => {
    const rows = await prisma.tablet.findMany({
      where: excludeWhere(),
      orderBy: { tokenId: "desc" },
    });
    return rows.map(serializeTablet);
  });

  // GET /api/tablets/registry/public  —  只列 visibility=PUBLIC 的塔位
  // (線上紀念館 /registry 的資料源)。可見度由屋主在管理頁即時切換 (DB-only)。
  app.get("/registry/public", async () => {
    const rows = await prisma.tablet.findMany({
      where: { visibility: "PUBLIC", ...excludeWhere() },
      orderBy: { tokenId: "desc" },
    });
    return rows.map(serializeTablet);
  });

  // ── 可見度 + 邀請碼 ──────────────────────────────────────────────────────

  // GET /api/tablets/:tokenId/access?code=  —  公開端點:告訴前端這座塔位的
  // 可見度與「這組碼能不能看」。頁面閘門用 (哀悼版進場檢查)。
  app.get("/:tokenId/access", async (request, reply) => {
    const params = TokenIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
    const tokenId = parseTokenId(params.data.tokenId);

    const row = await loadTabletAccess(tokenId);
    if (!row) return reply.code(404).send({ error: "tablet_not_synced" });

    const code = inviteCodeFrom(request);
    const codeValid = codeGrantsAccess(row, code);
    const allowed =
      row.visibility === "PUBLIC" || (row.visibility === "UNLISTED" && codeValid);

    return reply.send({
      tokenId: params.data.tokenId,
      visibility: row.visibility,
      allowed,
      codeValid,
      owner: row.owner, // 前端拿去比對已連線錢包 (owner 一律可看,UI 層放行)
    });
  });

  // GET /api/tablets/:tokenId/invite  —  owner 專用:讀邀請碼。
  app.get(
    "/:tokenId/invite",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const tokenId = parseTokenId(params.data.tokenId);
      const row = await prisma.tablet.findUnique({
        where: { tokenId },
        select: { visibility: true, inviteCode: true },
      });
      if (!row) return reply.code(404).send({ error: "tablet_not_synced" });
      return reply.send({ visibility: row.visibility, code: row.inviteCode });
    },
  );

  // PATCH /api/tablets/:tokenId/visibility  —  owner 專用:即時切換三態
  // (DB-only,免簽名免 gas;邀請碼本來就不能上鏈)。
  app.patch(
    "/:tokenId/visibility",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const body = z
        .object({ visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]) })
        .safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body" });

      const tokenId = parseTokenId(params.data.tokenId);
      try {
        const updated = await prisma.tablet.update({
          where: { tokenId },
          data: {
            visibility: body.data.visibility,
            // legacy public 欄跟著 visibility 走,讓還在讀它的舊介面顯示一致。
            public: body.data.visibility === "PUBLIC",
          },
          select: { visibility: true, inviteCode: true },
        });
        return reply.send({ visibility: updated.visibility, code: updated.inviteCode });
      } catch {
        return reply.code(404).send({ error: "tablet_not_synced" });
      }
    },
  );

  // POST /api/tablets/:tokenId/invite/regenerate  —  owner 專用:換新邀請碼,
  // 舊碼立即失效 (碼外流時用)。
  app.post(
    "/:tokenId/invite/regenerate",
    { preHandler: [requireAuth, requireOwner("tokenId")] },
    async (request, reply) => {
      const params = TokenIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_token_id" });
      const tokenId = parseTokenId(params.data.tokenId);
      try {
        const updated = await prisma.tablet.update({
          where: { tokenId },
          data: { inviteCode: newInviteCode() },
          select: { visibility: true, inviteCode: true },
        });
        return reply.send({ visibility: updated.visibility, code: updated.inviteCode });
      } catch {
        return reply.code(404).send({ error: "tablet_not_synced" });
      }
    },
  );

  // POST /api/tablets/scan  —  probe the chain for token ids 1..MAX and sync each
  // newly-found tablet into the DB. Stops after STOP_AFTER_MISSES consecutive
  // ownerOf reverts. Returns the synced rows.
  app.post("/scan", async (request, reply) => {
    const MAX_PROBE = 200n;
    const STOP_AFTER_MISSES = 5;

    const found: bigint[] = [];
    let misses = 0;
    for (let i = 1n; i <= MAX_PROBE; i++) {
      // 被排除的 tokenId 直接跳過(不 probe、不 sync),demo 隱藏舊塔位用。
      if (isExcluded(i)) {
        misses = 0; // 排除的洞不算「連續 miss」,避免提早中止掃描
        continue;
      }
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

    // 被排除的塔位:當作不存在(連直接打網址都看不到)。
    if (isExcluded(tokenId)) {
      return reply.code(404).send({ error: "tablet_not_found" });
    }

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
      where: { owner, ...excludeWhere() },
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
      where: { owner, ...excludeWhere() },
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
    // 被排除的塔位不允許手動同步,避免又寫回 DB。
    if (isExcluded(tokenId)) {
      return reply.code(404).send({ error: "tablet_not_found" });
    }
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
