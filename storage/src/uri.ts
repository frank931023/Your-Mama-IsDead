/**
 * URI helpers for all storage schemes used in the DSAS stack.
 *
 *   ipfs://<cid>[/path]    — IPFS content hash (Pinata, web3.storage, local IPFS)
 *   ar://<txid>            — Arweave transaction
 *   file://<path>          — local filesystem (dev only)
 *   https://<...>          — already-resolved gateway URL
 */

export type URIScheme = "ipfs" | "ar" | "file" | "https" | "http";

export interface ParsedURI {
  scheme: URIScheme;
  /** For ipfs/ar: the CID/txid (plus optional sub-path). For file/https: the rest of the URI after the scheme. */
  id: string;
}

export interface GatewayOptions {
  /** Defaults to env IPFS_GATEWAY or https://gateway.pinata.cloud/ipfs/ */
  ipfsGateway?: string;
  /** Defaults to env ARWEAVE_GATEWAY or https://arweave.net/ */
  arweaveGateway?: string;
}

const KNOWN_SCHEMES: readonly URIScheme[] = [
  "ipfs",
  "ar",
  "file",
  "https",
  "http",
];

export function isStorageUri(s: unknown): s is string {
  if (typeof s !== "string" || s.length === 0) return false;
  const i = s.indexOf("://");
  if (i <= 0) return false;
  const scheme = s.slice(0, i).toLowerCase() as URIScheme;
  return (KNOWN_SCHEMES as readonly string[]).includes(scheme);
}

export function parseURI(uri: string): ParsedURI {
  const i = uri.indexOf("://");
  if (i <= 0) {
    throw new Error(`parseURI: missing scheme in "${uri}"`);
  }
  const schemeRaw = uri.slice(0, i).toLowerCase();
  const id = uri.slice(i + 3);
  if (!(KNOWN_SCHEMES as readonly string[]).includes(schemeRaw)) {
    throw new Error(`parseURI: unsupported scheme "${schemeRaw}"`);
  }
  if (id.length === 0) {
    throw new Error(`parseURI: empty body in "${uri}"`);
  }
  return { scheme: schemeRaw as URIScheme, id };
}

function ensureTrailingSlash(s: string): string {
  return s.endsWith("/") ? s : `${s}/`;
}

export function toGatewayUrl(uri: string, opts: GatewayOptions = {}): string {
  const ipfs = ensureTrailingSlash(
    opts.ipfsGateway ??
      process.env.IPFS_GATEWAY ??
      "https://gateway.pinata.cloud/ipfs/",
  );
  const ar = ensureTrailingSlash(
    opts.arweaveGateway ?? process.env.ARWEAVE_GATEWAY ?? "https://arweave.net/",
  );

  const parsed = parseURI(uri);
  switch (parsed.scheme) {
    case "ipfs":
      return `${ipfs}${parsed.id}`;
    case "ar":
      return `${ar}${parsed.id}`;
    case "https":
    case "http":
      return uri;
    case "file":
      // file:// URLs cannot be loaded by browsers from a remote origin,
      // but we still return them so dev tooling can decide what to do.
      return uri;
    default: {
      const _exhaustive: never = parsed.scheme;
      throw new Error(`toGatewayUrl: unhandled scheme ${String(_exhaustive)}`);
    }
  }
}
