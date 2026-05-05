/**
 * Common storage-provider interface used by the DSAS prototype.
 *
 * All drivers (pinata / web3.storage / local / irys) implement this so that
 * the contract layer and the front-end only ever see opaque URIs:
 *   ipfs://<cid> | ar://<txid> | file://<sha256>.bin | https://...
 */

export interface Tag {
  name: string;
  value: string;
}

export interface PutResult {
  /** Canonical URI, e.g. `ipfs://bafy...`, `ar://abc...`, `file://...`. */
  uri: string;
  /** Content identifier when applicable (IPFS/Arweave). */
  cid?: string;
  /** Size in bytes of the stored payload. */
  size: number;
}

export interface IStorageProvider {
  /** Human-readable driver name (`pinata`, `web3storage`, `local`, `irys`). */
  readonly name: string;

  /**
   * Persist an arbitrary binary blob.
   * @param data        raw bytes
   * @param contentType MIME type, e.g. `image/jpeg`
   * @param tags        optional metadata; on IPFS these are folded into the
   *                    pin's metadata, on Arweave they become native tags.
   */
  putBlob(
    data: Buffer | Uint8Array,
    contentType: string,
    tags?: Tag[],
  ): Promise<PutResult>;

  /** Persist a JSON-serialisable object. */
  putJSON(obj: unknown, tags?: Tag[]): Promise<PutResult>;

  /** Fetch raw bytes for any supported URI scheme. */
  resolve(uri: string): Promise<Buffer>;

  /** Resolve any supported URI scheme to a https URL for use in `<img src>`. */
  gatewayUrl(uri: string): string;
}
