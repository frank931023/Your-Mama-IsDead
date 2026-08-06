"use client";

/**
 * 邀請碼的前端儲存 (per-tokenId, sessionStorage)。
 *
 * 訪客從 /memorial/[id]?code=XXXX 進來 → 存起來 → 之後同分頁內的
 * 投稿 / 公祭 WS / 對話 都自動帶上;關分頁即忘 (不落 localStorage,
 * 避免共用電腦長期留碼)。
 *
 * 對話端點沿用 Authorization 欄位:`Bearer invite:<code>`
 * (見 backend/src/lib/access.ts),前端拿 inviteBearer() 當 jwt 用即可。
 */

const KEY_PREFIX = "dsas:invite";

function key(tokenId: string | number): string {
  return `${KEY_PREFIX}:${tokenId}`;
}

export function getStoredInviteCode(tokenId: string | number): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key(tokenId));
  } catch {
    return null;
  }
}

export function storeInviteCode(tokenId: string | number, code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key(tokenId), code.trim().toUpperCase());
  } catch {
    /* ignore */
  }
}

export function clearInviteCode(tokenId: string | number): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key(tokenId));
  } catch {
    /* ignore */
  }
}

/** 給對話端點當 jwt 用的邀請憑證字串;沒碼回 null。 */
export function inviteBearer(tokenId: string | number): string | null {
  const code = getStoredInviteCode(tokenId);
  return code ? `invite:${code}` : null;
}

/** 把碼附到 URL 上 (分享連結 / 對話頁跳轉用)。 */
export function withInviteCode(url: string, tokenId: string | number): string {
  const code = getStoredInviteCode(tokenId);
  if (!code) return url;
  return `${url}${url.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`;
}
