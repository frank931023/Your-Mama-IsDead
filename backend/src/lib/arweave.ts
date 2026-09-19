/**
 * Arweave 永存層
 *
 * 檔案經 bundler 打包成 ANS-104 data item 送上 Arweave,回傳 ar://<txid>。
 * Arweave 是一次付費、協議背書的永久儲存(儲存捐贈基金設計目標 200 年以上),
 * 符合塔位「永久安放」的產品語意。
 *
 * 兩個 bundler,產出的都是同一條 Arweave 上的交易:
 *   - irys (主要):@irys/sdk,以 Ethereum 私鑰簽名,費用從該地址在 IRYS_NODE
 *     上的預存餘額扣,需先用主網 ETH fund。
 *     ⚠ Irys 公告舊版 Arweave bundler 端點(node1 / mainnet.arweave)
 *       2026-11-01 退役,屆時請把 ARWEAVE_BUNDLER 改成 turbo。
 *   - turbo (備援):ArDrive Turbo,<100KiB 免費,大檔需在 turbo.ar.io 為
 *     同一地址儲值 Turbo Credits。
 * 主要 bundler 失敗(未 fund、節點不可用)時自動改走另一個。
 *
 * 兩種用法:
 *   uploadBufferToArweaveOrThrow — storage mode = arweave 的主儲存路徑,失敗 throw
 *   uploadBufferToArweave        — pinata 模式下的永存備份,best-effort,失敗回 null
 *
 * 每筆上傳掛 App-Name / File-Name 等 tags,之後可用 Arweave GraphQL 依 tag
 * 撈回全部資料,不依賴我們的 DB。
 */
import { Readable } from "node:stream";
import Irys from "@irys/sdk";
import { TurboFactory } from "@ardrive/turbo-sdk";
import { env } from "./env.js";

export type ArweaveBundler = "irys" | "turbo";
type Tag = { name: string; value: string };

export interface ArweaveUploadResult {
  /** Arweave transaction (data item) id */
  id: string;
  /** ar://<id> — gatewayUrl() 會解析成 {ARWEAVE_GATEWAY}/<id> */
  uri: string;
  /** 實際完成上傳的 bundler */
  bundler: ArweaveBundler;
}

export class ArweaveUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArweaveUploadError";
  }
}

// docker env_file 會把空白欄位傳成 "",所以用 || 而不是 ??。
function irysKey(): string | undefined {
  return env.IRYS_PRIVATE_KEY || env.TURBO_PRIVATE_KEY || undefined;
}

function turboKey(): string | undefined {
  return env.TURBO_PRIVATE_KEY || undefined;
}

/** 至少有一個 bundler 的簽名金鑰可用。 */
export function arweaveConfigured(): boolean {
  return Boolean(irysKey() || turboKey());
}

// ── Irys ─────────────────────────────────────────────────────────────────

let irysPromise: Promise<Irys> | null = null;

async function getIrys(): Promise<Irys> {
  const key = irysKey();
  if (!key) throw new ArweaveUploadError("irys_not_configured");
  if (!irysPromise) {
    irysPromise = (async () => {
      const client = new Irys({
        url: env.IRYS_NODE,
        token: "ethereum",
        key,
        ...(env.IRYS_PROVIDER_URL ? { config: { providerUrl: env.IRYS_PROVIDER_URL } } : {}),
      });
      await client.ready();
      console.log(`[arweave] Irys 已啟用 (${env.IRYS_NODE}, 付款地址 ${client.address})`);
      return client;
    })();
    // 初始化失敗(節點暫時連不上)不要永久快取,下次上傳再重試。
    irysPromise.catch(() => {
      irysPromise = null;
    });
  }
  return irysPromise;
}

async function uploadViaIrys(buf: Buffer, tags: Tag[]): Promise<string> {
  const irys = await getIrys();
  const receipt = await irys.upload(buf, { tags });
  return receipt.id;
}

// ── Turbo ────────────────────────────────────────────────────────────────

type TurboClient = ReturnType<typeof TurboFactory.authenticated>;
let turboClient: TurboClient | null = null;

function getTurbo(): TurboClient {
  const key = turboKey();
  if (!key) throw new ArweaveUploadError("turbo_not_configured");
  if (!turboClient) {
    turboClient = TurboFactory.authenticated({ privateKey: key, token: "ethereum" });
    console.log("[arweave] Turbo 已啟用 (ethereum signer)");
  }
  return turboClient;
}

async function uploadViaTurbo(buf: Buffer, tags: Tag[]): Promise<string> {
  const res = await getTurbo().uploadFile({
    fileStreamFactory: () => Readable.from(buf),
    fileSizeFactory: () => buf.length,
    dataItemOpts: { tags },
  });
  return res.id;
}

// ── 對外 API ─────────────────────────────────────────────────────────────

function bundlerOrder(): ArweaveBundler[] {
  return env.ARWEAVE_BUNDLER === "turbo" ? ["turbo", "irys"] : ["irys", "turbo"];
}

/**
 * 上傳一個 Buffer 到 Arweave,失敗 throw ArweaveUploadError(訊息含各 bundler 的失敗原因)。
 * extraTags 例:[{ name: "Token-Id", value: "8" }]
 */
export async function uploadBufferToArweaveOrThrow(
  buf: Buffer,
  contentType: string,
  name: string,
  extraTags: Tag[] = [],
): Promise<ArweaveUploadResult> {
  if (!arweaveConfigured()) throw new ArweaveUploadError("arweave_not_configured");
  const tags: Tag[] = [
    { name: "Content-Type", value: contentType },
    { name: "App-Name", value: "DSAS" },
    { name: "File-Name", value: name },
    ...extraTags,
  ];
  const failures: string[] = [];
  const order = bundlerOrder();
  for (const bundler of order) {
    try {
      const id =
        bundler === "irys" ? await uploadViaIrys(buf, tags) : await uploadViaTurbo(buf, tags);
      if (bundler !== order[0]) {
        console.warn(`[arweave] ${order[0]} 上傳失敗,已改由 ${bundler} 完成 (${name})`);
      }
      return { id, uri: `ar://${id}`, bundler };
    } catch (err) {
      failures.push(`${bundler}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new ArweaveUploadError(`arweave_upload_failed (${failures.join(" | ")})`);
}

/**
 * best-effort 版本:未設定或上傳失敗回 null(已記 log),不往上拋。
 * 給 pinata 模式的永存備份用 — IPFS 主流程照常。
 */
export async function uploadBufferToArweave(
  buf: Buffer,
  contentType: string,
  name: string,
  extraTags: Tag[] = [],
): Promise<ArweaveUploadResult | null> {
  if (!arweaveConfigured()) return null;
  try {
    return await uploadBufferToArweaveOrThrow(buf, contentType, name, extraTags);
  } catch (err) {
    console.warn(
      `[arweave] 上傳失敗 (${name}, ${buf.length}B):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** 上傳 JSON 物件到 Arweave,失敗 throw。 */
export async function uploadJSONToArweaveOrThrow(
  obj: unknown,
  name: string,
  extraTags: Tag[] = [],
): Promise<ArweaveUploadResult> {
  return uploadBufferToArweaveOrThrow(
    Buffer.from(JSON.stringify(obj)),
    "application/json",
    name,
    extraTags,
  );
}

/** 上傳 JSON 物件到 Arweave,best-effort。 */
export async function uploadJSONToArweave(
  obj: unknown,
  name: string,
  extraTags: Tag[] = [],
): Promise<ArweaveUploadResult | null> {
  return uploadBufferToArweave(
    Buffer.from(JSON.stringify(obj)),
    "application/json",
    name,
    extraTags,
  );
}
