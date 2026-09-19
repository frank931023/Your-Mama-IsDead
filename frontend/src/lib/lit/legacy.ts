/**
 * Lit 門檻網路 (SDK v8) 的檔案加密 —— 系統概述文件描述的做法
 *
 * 加密:在瀏覽器以 Lit 網路公鑰 + 身分參數(存取條件雜湊 ‖ 資料雜湊)直接加密整個檔案,
 *      不需與節點互動;存取條件 = 呼叫合約 ownerOf(tokenId) 必須等於請求者。
 * 解密:錢包簽名證明身分 → 各節點各自上鏈驗證 ownerOf → 交出 BLS 簽章分片 → 湊滿門檻後
 *      在瀏覽器組合成解密金鑰、本地解密。完整金鑰從不出現在任何單一節點。
 *
 * SDK 從 CDN 動態載入,見 legacy-sdk.ts。
 */
import type { WalletClient } from "viem";
import type { LitAccess } from "@shared/types/artifact";
import { CONTRACT_ADDRESS } from "@/lib/contract";
import { LEGACY_NETWORK, LIT_CHAIN } from "./config";
import { loadSdk, type SdkModule } from "./legacy-sdk";

const CONNECT_TIMEOUT_MS = 20_000;
/** 解鎖 session 的有效時間;過期後要重新簽名 */
const AUTH_TTL_MS = 15 * 60 * 1000;

function connectError(err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(
    `連不上 Lit 門檻網路 (${LEGACY_NETWORK}):${detail}。請確認網路可用,或改用 NEXT_PUBLIC_LIT_MODE=chipotle / none`,
  );
}

let clientPromise: Promise<SdkModule> | null = null;

async function getClient(): Promise<SdkModule> {
  if (!clientPromise) {
    const connect = (async () => {
      const [{ createLitClient }, networks] = await Promise.all([loadSdk("client"), loadSdk("networks")]);
      const byName: Record<string, unknown> = {
        "naga-dev": networks.nagaDev,
        "naga-test": networks.nagaTest,
        naga: networks.naga,
      };
      return createLitClient({ network: byName[LEGACY_NETWORK] ?? networks.nagaDev });
    })();
    // 網路不可用時 SDK 可能一直重試,限時避免畫面卡住
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("連線逾時")), CONNECT_TIMEOUT_MS),
    );
    clientPromise = Promise.race([connect, timeout]).catch((err: unknown) => {
      clientPromise = null;
      throw connectError(err);
    });
  }
  return clientPromise;
}

/** 鑄造前先確認連得上 Lit 網路,連不上就別鑄造(免得鑄好了卻加密失敗)。 */
export async function legacyPreflight(): Promise<void> {
  await getClient();
}

/** 存取條件:持有這座塔位 NFT 的地址才能解密。 */
export async function legacyAccess(tokenId: bigint): Promise<LitAccess> {
  const { createAccBuilder } = await loadSdk("acc");
  const accessControlConditions: unknown[] = createAccBuilder()
    .requireNftOwnership(CONTRACT_ADDRESS, tokenId.toString())
    .on(LIT_CHAIN)
    .build();
  return { network: LEGACY_NETWORK, chain: LIT_CHAIN, accessControlConditions };
}

/**
 * 以 Lit 網路公鑰在本地加密整份資料。SDK 會算出資料的 SHA-256 (dataToEncryptHash),
 * 和存取條件雜湊一起組成身分參數;解密時條件或資料對不上,金鑰就湊不出來。
 */
export async function legacyEncrypt(
  data: Uint8Array,
  access: LitAccess,
): Promise<{ ciphertext: string; dataToEncryptHash: string }> {
  const litClient = await getClient();
  const res = await litClient.encrypt({
    dataToEncrypt: data,
    accessControlConditions: access.accessControlConditions,
    chain: access.chain,
  });
  return { ciphertext: res.ciphertext, dataToEncryptHash: res.dataToEncryptHash };
}

/** Lit SDK 的 auth context;內容由 SDK 定義,這裡只負責建立與傳遞。 */
export type LegacyAuth = unknown;

/** 解鎖 session:錢包簽一次訊息證明身分,之後每個檔案的解密請求都附上它。 */
export async function legacyAuth(walletClient: WalletClient, network: string): Promise<LegacyAuth> {
  if (network !== LEGACY_NETWORK) {
    throw new Error(`這些素材以 Lit 網路 ${network} 加密,目前前端設定為 ${LEGACY_NETWORK},無法解鎖`);
  }
  const litClient = await getClient();
  const { createAuthManager, storagePlugins } = await loadSdk("auth");
  const authManager = createAuthManager({
    storage: storagePlugins.localStorage({ appName: "aeterlux", networkName: network }),
  });
  return authManager.createEoaAuthContext({
    config: { account: walletClient },
    authConfig: {
      domain: typeof window === "undefined" ? "aeterlux" : window.location.host,
      statement: "解鎖 Aeterlux 私密記憶",
      expiration: new Date(Date.now() + AUTH_TTL_MS).toISOString(),
      resources: [["access-control-condition-decryption", "*"]],
    },
    litClient,
  });
}

function decryptError(err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  if (/not.?authorized|unauthorized|access.?control|denied/i.test(detail)) {
    return new Error(`Lit 節點拒絕解密:簽名者不是這座燈塔目前的持有者(${detail})`);
  }
  return new Error(`Lit 解密失敗:${detail}`);
}

/**
 * 向 Lit 節點請求解密:節點各自上鏈驗證存取條件,通過才交出簽章分片;SDK 湊滿門檻後
 * 在瀏覽器組合出解密金鑰、本地解密。回傳明文 bytes。
 */
export async function legacyDecrypt(params: {
  ciphertext: string;
  dataToEncryptHash: string;
  access: LitAccess;
  auth: LegacyAuth;
}): Promise<Uint8Array> {
  const litClient = await getClient();
  try {
    const res = await litClient.decrypt({
      ciphertext: params.ciphertext,
      dataToEncryptHash: params.dataToEncryptHash,
      accessControlConditions: params.access.accessControlConditions,
      chain: params.access.chain,
      authContext: params.auth,
    });
    const data: unknown = res.decryptedData;
    return data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  } catch (err) {
    throw decryptError(err);
  }
}
