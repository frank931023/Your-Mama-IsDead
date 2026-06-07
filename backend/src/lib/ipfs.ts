import axios from "axios";
import { env } from "./env.js";

/**
 * Resolve any storage URI to an HTTPS gateway URL.
 *  - ipfs://<cid>[/path]  -> {IPFS_GATEWAY}<cid>[/path]
 *  - ar://<txid>          -> https://arweave.net/<txid>
 *  - https?://...         -> identity
 */
export function gatewayUrl(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    const rest = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    const base = env.IPFS_GATEWAY.endsWith("/")
      ? env.IPFS_GATEWAY
      : `${env.IPFS_GATEWAY}/`;
    return `${base}${rest}`;
  }
  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice("ar://".length)}`;
  }
  return uri;
}

/**
 * Fetch a JSON resource pointed at by a storage URI.
 * Returns the parsed JSON or throws on non-2xx / parse failure.
 */
export async function fetchIPFS(uri: string): Promise<unknown> {
  const url = gatewayUrl(uri);
  const res = await axios.get(url, {
    timeout: 15_000,
    responseType: "json",
    validateStatus: (s) => s >= 200 && s < 300,
  });
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
