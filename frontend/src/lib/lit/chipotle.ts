/**
 * Lit v3 (Chipotle) 綁定 Action 模式的金鑰包裝
 *
 * 加密(瀏覽器,不經過 Lit):取得 Action 身分公鑰 → 臨時金鑰做 secp256k1 ECDH →
 * SHA-256 → AES-256-GCM 包裝 { tokenId, contract, key }。
 * 解密:使用者錢包簽一段含 tokenId 與時間的訊息 → 呼叫 Action;Action 在 TEE 內驗證
 * 簽章、訊息時效與鏈上 ownerOf,通過才解開信封交回檔案金鑰。
 *
 * Action 的身分金鑰由其程式碼內容雜湊 (CID) 推導,規則改一個字金鑰就不同,
 * 所以平台無法事後放寬規則。Action 原始碼:lit-actions/aeterlux-artifact-key.js。
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import type { ChipotleWrappedKey } from "@shared/types/artifact";
import { CONTRACT_ADDRESS } from "@/lib/contract";
import { CHIPOTLE, LIT_CHAIN_ID } from "./config";
import { bytesToB64 } from "./envelope";

function assertConfigured(): void {
  if (!CHIPOTLE.actionCid || !CHIPOTLE.usageKey) {
    throw new Error(
      "Lit Chipotle 未設定:缺 NEXT_PUBLIC_LIT_CHIPOTLE_ACTION_CID / NEXT_PUBLIC_LIT_CHIPOTLE_USAGE_KEY(請先跑 backend/scripts/lit-chipotle-setup.ts)",
    );
  }
}

async function runAction<T>(actionCid: string, jsParams: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CHIPOTLE.apiUrl}/core/v1/lit_action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": CHIPOTLE.usageKey },
    body: JSON.stringify({ ipfs_id: actionCid, js_params: jsParams }),
  });
  if (!res.ok) {
    throw new Error(`Lit Chipotle 請求失敗 (${res.status}):${await res.text()}`);
  }
  const body = (await res.json()) as { response?: unknown; logs?: string; has_error?: boolean };
  if (body.has_error) throw new Error(`Lit Action 執行錯誤:${body.logs ?? ""}`);
  const payload = typeof body.response === "string" ? JSON.parse(body.response) : body.response;
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(`Lit Action 拒絕解鎖:${String((payload as { error: unknown }).error)}`);
  }
  return payload as T;
}

let cachedPublicKey: string | null = CHIPOTLE.actionPublicKey || null;

async function actionPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  const { publicKey } = await runAction<{ publicKey: string }>(CHIPOTLE.actionCid, {
    op: "publicKey",
  });
  cachedPublicKey = publicKey;
  return publicKey;
}

/** 鑄造前確認設定齊全、Action 可用(公鑰已由環境變數提供時不會呼叫 Lit)。 */
export async function chipotlePreflight(): Promise<void> {
  assertConfigured();
  await actionPublicKey();
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function chipotleWrap(rawKey: string, tokenId: bigint): Promise<ChipotleWrappedKey> {
  assertConfigured();
  const publicKey = await actionPublicKey();
  const ephemeral = secp256k1.utils.randomPrivateKey();
  // ECDH 共享點的 X 座標(與 Action 內 ethers SigningKey.computeSharedSecret 一致)
  const shared = secp256k1.getSharedSecret(ephemeral, publicKey.replace(/^0x/, ""), true).slice(1);
  const kek = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", shared as BufferSource),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(
    JSON.stringify({ v: 1, tokenId: tokenId.toString(), contract: CONTRACT_ADDRESS, key: rawKey }),
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, kek, payload),
  );
  return {
    mode: "chipotle",
    actionCid: CHIPOTLE.actionCid,
    envelope: {
      ephPub: `0x${toHex(secp256k1.getPublicKey(ephemeral, false))}`,
      iv: bytesToB64(iv),
      ct: bytesToB64(ct),
    },
  };
}

/** Action 會逐行解析這段訊息;欄位名稱與格式要和 Action 保持一致。 */
export function unlockMessage(tokenId: bigint): string {
  return [
    "Aeterlux 私密記憶解鎖",
    `contract: ${CONTRACT_ADDRESS}`,
    `chainId: ${LIT_CHAIN_ID}`,
    `tokenId: ${tokenId.toString()}`,
    `issuedAt: ${new Date().toISOString()}`,
  ].join("\n");
}

export interface UnlockAuth {
  message: string;
  signature: string;
}

/** 簽一次解鎖訊息;5 分鐘內可重複用來解開同一座塔位的多把金鑰。 */
export async function signUnlock(
  tokenId: bigint,
  signMessage: (message: string) => Promise<string>,
): Promise<UnlockAuth> {
  const message = unlockMessage(tokenId);
  return { message, signature: await signMessage(message) };
}

export async function chipotleUnwrap(
  wrapped: ChipotleWrappedKey,
  tokenId: bigint,
  auth: UnlockAuth,
): Promise<string> {
  if (!CHIPOTLE.usageKey) {
    throw new Error("Lit Chipotle 未設定:缺 NEXT_PUBLIC_LIT_CHIPOTLE_USAGE_KEY");
  }
  // 金鑰綁定在當初加密用的那份 Action,所以呼叫 wrapped.actionCid 而不是目前設定值。
  const { key } = await runAction<{ key: string }>(wrapped.actionCid, {
    op: "unwrap",
    tokenId: tokenId.toString(),
    envelope: wrapped.envelope,
    message: auth.message,
    signature: auth.signature,
  });
  return key;
}
