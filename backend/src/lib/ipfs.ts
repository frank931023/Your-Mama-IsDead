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
