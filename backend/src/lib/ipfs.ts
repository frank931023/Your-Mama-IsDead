import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { env } from "./env.js";

// Irys 自家閘道:剛經 Irys 上傳、尚未被 arweave.net 索引的 data item 也讀得到。
const IRYS_GATEWAY = "https://gateway.irys.xyz";

function withSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * Resolve any storage URI to an HTTPS gateway URL.
 *  - ipfs://<cid>[/path]  -> {IPFS_GATEWAY}<cid>[/path]
 *  - ar://<txid>          -> {ARWEAVE_GATEWAY}/<txid>
 *  - https?://...         -> identity
 */
export function gatewayUrl(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    const rest = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    return `${withSlash(env.IPFS_GATEWAY)}${rest}`;
  }
  if (uri.startsWith("ar://")) {
    return `${withSlash(env.ARWEAVE_GATEWAY)}${uri.slice("ar://".length)}`;
  }
  return uri;
}

/** 依序嘗試的閘道 URL;ar:// 在主閘道後面多一個 Irys 閘道當備援。 */
export function gatewayUrls(uri: string): string[] {
  if (uri.startsWith("ar://")) {
    return [gatewayUrl(uri), `${withSlash(IRYS_GATEWAY)}${uri.slice("ar://".length)}`];
  }
  return [gatewayUrl(uri)];
}

/**
 * 以 storage URI 抓取資源:依 gatewayUrls() 順序嘗試,回傳第一個 2xx 回應;
 * 全部失敗則拋出最後一個錯誤。config 會原樣傳給 axios(validateStatus 固定為 2xx)。
 */
export async function fetchFromStorage<T = unknown>(
  uri: string,
  config: AxiosRequestConfig = {},
): Promise<AxiosResponse<T>> {
  let lastErr: unknown;
  for (const url of gatewayUrls(uri)) {
    try {
      return await axios.get<T>(url, {
        ...config,
        validateStatus: (s) => s >= 200 && s < 300,
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Fetch a JSON resource pointed at by a storage URI.
 * Returns the parsed JSON or throws on non-2xx / parse failure.
 */
export async function fetchIPFS(uri: string): Promise<unknown> {
  const res = await fetchFromStorage(uri, { timeout: 15_000, responseType: "json" });
  return res.data as unknown;
}

const PINATA_PIN_JSON = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

interface PinataPinJsonResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

/**
 * Pin an arbitrary JSON object to IPFS via Pinata and return its CID.
 *
 * Used for small text payloads (e.g. a 哀悼版 story) where streaming a file
 * through /uploads/relay would be overkill. Throws "pinata_not_configured"
 * if PINATA_JWT is unset so callers can surface a 503.
 */
export async function pinJSON(
  obj: unknown,
  name = "dsas-json",
): Promise<{ cid: string; uri: string; size: number }> {
  if (!env.PINATA_JWT) {
    throw new Error("pinata_not_configured");
  }
  const res = await axios.post<PinataPinJsonResponse>(
    PINATA_PIN_JSON,
    {
      pinataContent: obj,
      pinataMetadata: { name, keyvalues: { app: "DSAS" } },
    },
    {
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${env.PINATA_JWT}`,
        "Content-Type": "application/json",
      },
      validateStatus: (s) => s >= 200 && s < 300,
    },
  );
  return {
    cid: res.data.IpfsHash,
    uri: `ipfs://${res.data.IpfsHash}`,
    size: res.data.PinSize,
  };
}
