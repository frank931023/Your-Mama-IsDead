import type {
  IStorageProvider,
  PutResult,
  Tag,
} from "./IStorageProvider.js";
import { toGatewayUrl } from "../uri.js";

/**
 * web3.storage skeleton.
 *
 * The newer w3up SDK uses UCAN delegations and is heavier than what the
 * prototype needs, so we keep the contract here and fill it in once we
 * decide whether to ship `@web3-storage/w3up-client` or a thin REST wrapper.
 *
 * TODO(web3.storage): implement using `@web3-storage/w3up-client`.
 *   docs: https://web3.storage/docs/w3up-client/
 */
export class Web3StorageProvider implements IStorageProvider {
  public readonly name = "web3storage";
  private readonly gateway: string;

  constructor(opts: { gateway?: string } = {}) {
    this.gateway =
      opts.gateway ??
      process.env.IPFS_GATEWAY ??
      "https://w3s.link/ipfs/";
  }

  async putBlob(
    _data: Buffer | Uint8Array,
    _contentType: string,
    _tags?: Tag[],
  ): Promise<PutResult> {
    throw new Error("Web3StorageProvider.putBlob: Not implemented");
  }

  async putJSON(_obj: unknown, _tags?: Tag[]): Promise<PutResult> {
    throw new Error("Web3StorageProvider.putJSON: Not implemented");
  }

  async resolve(_uri: string): Promise<Buffer> {
    throw new Error("Web3StorageProvider.resolve: Not implemented");
  }

  gatewayUrl(uri: string): string {
    return toGatewayUrl(uri, { ipfsGateway: this.gateway });
  }
}
