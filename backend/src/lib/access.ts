/**
 * 追悼頁可見度 + 邀請碼 存取控制
 *
 * 三態 (Tablet.visibility,DB-only 權威來源;邀請碼絕不上鏈):
 *   PUBLIC   公開:列在線上紀念館;內容任何人可讀,對話仍需 owner 或邀請碼
 *   UNLISTED 不公開:憑邀請碼可看哀悼版 / 拜拜 (公祭 WS) / 對話 / 投稿留言
 *   PRIVATE  私人:僅屋主 (SIWE jwt);邀請碼無效、公祭 WS 關閉
 *
 * 邀請碼的三種攜帶方式 (擇一):
 *   - Authorization: Bearer invite:<code>   ← 對話端點用 (沿用 jwt 欄位最省前端改動)
 *   - x-invite-code: <code>                 ← 一般 API
 *   - ?code=<code>                          ← 簡單 GET / WS upgrade
 *
 * 誠實聲明:塔位 metadata 本體在 IPFS 上永遠是公開可讀的 (內容定址),這裡的
 * 閘門保護的是「互動面」:對話 (會花 API 錢)、投稿寫入、公祭即時通道與頁面體驗。
 */
import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { getAddress } from "viem";
import { prisma } from "../db.js";
import { getOwnerOf } from "../chain.js";

export type Visibility = "PUBLIC" | "UNLISTED" | "PRIVATE";

/** 8 碼大寫邀請碼,好唸好抄 (0/O、1/I 混淆字元不避了,demo 夠用)。 */
export function newInviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

/** 從請求取出邀請碼 (bearer invite: / x-invite-code / ?code=)。 */
export function inviteCodeFrom(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer invite:")) {
    return auth.slice("Bearer invite:".length).trim() || null;
  }
  const header = request.headers["x-invite-code"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const q = (request.query as { code?: unknown } | undefined)?.code;
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

interface TabletAccessRow {
  visibility: Visibility;
  inviteCode: string;
  owner: string;
}

export async function loadTabletAccess(tokenId: bigint): Promise<TabletAccessRow | null> {
  const t = await prisma.tablet.findUnique({
    where: { tokenId },
    select: { visibility: true, inviteCode: true, owner: true },
  });
  return t as TabletAccessRow | null;
}

/** 邀請碼是否有效 (大小寫不敏感;PRIVATE 一律無效)。 */
export function codeGrantsAccess(row: TabletAccessRow, code: string | null): boolean {
  if (!code || row.visibility === "PRIVATE") return false;
  return row.inviteCode.length > 0 && row.inviteCode.toUpperCase() === code.toUpperCase();
}

/** 嘗試從 (可選的) SIWE jwt 驗出鏈上 owner;非 owner / 無 jwt 回 false。 */
async function isOwnerRequest(request: FastifyRequest, tokenId: bigint): Promise<boolean> {
  const auth = request.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ") || auth.startsWith("Bearer invite:")) {
    return false;
  }
  try {
    await request.jwtVerify();
  } catch {
    return false;
  }
  const principal = request.user?.address;
  if (!principal) return false;
  try {
    const owner = await getOwnerOf(tokenId);
    return getAddress(owner) === getAddress(principal);
  } catch {
    return false;
  }
}

/**
 * 對話 / 互動端點用:owner (SIWE jwt) 或有效邀請碼 (Bearer invite:<code>) 擇一。
 * PRIVATE 模式下邀請碼無效 → 只剩 owner。
 */
export function requireOwnerOrInvite(paramName: string = "tokenId"): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = (request.params as Record<string, string | undefined>)[paramName];
    let tokenId: bigint;
    try {
      tokenId = BigInt(raw ?? "");
    } catch {
      await reply.code(400).send({ error: `invalid ${paramName}` });
      return;
    }

    const row = await loadTabletAccess(tokenId);
    if (!row) {
      await reply.code(404).send({ error: "tablet_not_synced" });
      return;
    }

    if (codeGrantsAccess(row, inviteCodeFrom(request))) return; // 邀請碼放行

    if (await isOwnerRequest(request, tokenId)) return; // owner 放行

    await reply.code(401).send({ error: "owner_or_invite_required" });
  };
}

/**
 * 投稿寫入 (留言 / 回憶) 用:
 *   PUBLIC   → 開放 (維持既有「來客即賓」)
 *   UNLISTED → 邀請碼或 owner
 *   PRIVATE  → owner only
 */
export function requireWriteAccess(paramName: string = "tokenId"): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = (request.params as Record<string, string | undefined>)[paramName];
    let tokenId: bigint;
    try {
      tokenId = BigInt(raw ?? "");
    } catch {
      await reply.code(400).send({ error: `invalid ${paramName}` });
      return;
    }

    const row = await loadTabletAccess(tokenId);
    // DB 還沒 sync 過的塔位:視同 UNLISTED 擋下寫入 (先去塔位頁觸發 lazy sync)。
    if (!row) {
      await reply.code(404).send({ error: "tablet_not_synced" });
      return;
    }

    if (row.visibility === "PUBLIC") return;
    if (row.visibility === "UNLISTED" && codeGrantsAccess(row, inviteCodeFrom(request))) return;
    if (await isOwnerRequest(request, tokenId)) return;

    await reply
      .code(row.visibility === "PRIVATE" ? 403 : 401)
      .send({ error: row.visibility === "PRIVATE" ? "private_tablet" : "invite_required" });
  };
}
