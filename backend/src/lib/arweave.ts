/**
 * Arweave 永存層 (ArDrive Turbo SDK)
 *
 * IPFS(Pinata) 是「租約式」儲存 — 停止 pin 資料就會消失;Arweave 是一次
 * 付費、協議背書的永久儲存 (儲存捐贈基金設計目標 200 年以上),更符合塔位
 * 「永久安放」的產品語意。這裡把 Arweave 當 best-effort 的第二儲存層:
 * IPFS 為主要服務層 (快、既有流程不動),Arweave 為永存備份;上傳失敗只記
 * log、絕不擋主流程。
 *
 * 實作重點:
 *   - 簽名者直接用 Ethereum 私鑰 (TURBO_PRIVATE_KEY),不用另外管 AR 錢包
 *   - ~100KiB 以下上傳免費 — metadata JSON / story JSON 全都在此範圍
 *   - 大檔 (相片) 需先在 https://turbo.ar.io 為同一地址儲值 Turbo Credits,
 *     未儲值時大檔上傳會失敗 → 回 null,IPFS 照常
 *   - 每筆上傳掛 App-Name/Type/Token-Id tags,之後可用 Arweave GraphQL
 *     (goldsky/arweave.net) 依 tag 撈回全部資料,不依賴我們的 DB
 *
 * 未設 TURBO_PRIVATE_KEY 時整層停用,所有 helper 回 null。
 */
import { Readable } from "node:stream";
import { TurboFactory } from "@ardrive/turbo-sdk";
import { env } from "./env.js";

type TurboClient = ReturnType<typeof TurboFactory.authenticated>;

/** undefined = 尚未初始化;null = 未設定或初始化失敗 (停用) */
let client: TurboClient | null | undefined;

function getTurbo(): TurboClient | null {
  if (client !== undefined) return client;
  if (!env.TURBO_PRIVATE_KEY) {
    client = null;
    return client;
  }
  try {
    client = TurboFactory.authenticated({
      privateKey: env.TURBO_PRIVATE_KEY,
      token: "ethereum",
    });
    console.log("[arweave] Turbo 客戶端已啟用 (ethereum signer)");
  } catch (err) {
    console.error("[arweave] Turbo 初始化失敗,永存層停用:", err);
    client = null;
  }
  return client;
}

export function arweaveEnabled(): boolean {
  return getTurbo() !== null;
}

export interface ArweaveUploadResult {
  /** Arweave transaction id */
  id: string;
  /** ar://<id> — gatewayUrl() 已支援解析成 https://arweave.net/<id> */
  uri: string;
}

/**
 * 上傳一個 Buffer 到 Arweave。回 null = 停用或上傳失敗 (已記 log)。
 * extraTags 例:[{ name: "Token-Id", value: "8" }]
 */
export async function uploadBufferToArweave(
  buf: Buffer,
  contentType: string,
  name: string,
  extraTags: Array<{ name: string; value: string }> = [],
): Promise<ArweaveUploadResult | null> {
  const turbo = getTurbo();
  if (!turbo) return null;
  try {
    const res = await turbo.uploadFile({
      fileStreamFactory: () => Readable.from(buf),
      fileSizeFactory: () => buf.length,
      dataItemOpts: {
        tags: [
          { name: "Content-Type", value: contentType },
          { name: "App-Name", value: "DSAS" },
          { name: "File-Name", value: name },
          ...extraTags,
        ],
      },
    });
    return { id: res.id, uri: `ar://${res.id}` };
  } catch (err) {
    // 常見失敗:大檔未儲值 Turbo Credits (insufficient balance)。
    // 視為 best-effort,不往上拋 — IPFS 主流程照常。
    console.warn(
      `[arweave] 上傳失敗 (${name}, ${buf.length}B):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** 上傳任意 JSON 物件到 Arweave (metadata / story 等小 payload,免費範圍)。 */
export async function uploadJSONToArweave(
  obj: unknown,
  name: string,
  extraTags: Array<{ name: string; value: string }> = [],
): Promise<ArweaveUploadResult | null> {
  return uploadBufferToArweave(
    Buffer.from(JSON.stringify(obj)),
    "application/json",
    name,
    extraTags,
  );
}
