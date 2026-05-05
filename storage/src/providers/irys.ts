import type {
  IStorageProvider,
  PutResult,
  Tag,
} from "./IStorageProvider.js";
import { toGatewayUrl } from "../uri.js";

/**
 * Irys (formerly Bundlr) skeleton — for the future Arweave migration.
 *
 * Irys is intentionally not wired up in the prototype because:
 *   - mainnet Irys is paid (AR), and
 *   - Irys devnet wipes data periodically, breaking demos.
 *
 * TODO(irys): implement using `@irys/sdk`.
 *   docs: https://docs.irys.xyz/developer-docs/sdk
 *   - upload returns `{ id }` → wrap as `ar://${id}`
 *   - tags map directly: tags.forEach(t => uploader.tags.push(t))
 */
export class IrysProvider implements IStorageProvider {
  public readonly name = "irys";
  private readonly gateway: string;

  constructor(opts: { gateway?: string } = {}) {
    this.gateway =
      opts.gateway ??
      process.env.ARWEAVE_GATEWAY ??
      "https://arweave.net/";
  }

  async putBlob(
    _data: Buffer | Uint8Array,
    _contentType: string,
    _tags?: Tag[],
  ): Promise<PutResult> {
    throw new Error("IrysProvider.putBlob: Not implemented");
  }

  async putJSON(_obj: unknown, _tags?: Tag[]): Promise<PutResult> {
    throw new Error("IrysProvider.putJSON: Not implemented");
  }

  async resolve(_uri: string): Promise<Buffer> {
    throw new Error("IrysProvider.resolve: Not implemented");
  }

  gatewayUrl(uri: string): string {
    return toGatewayUrl(uri, { arweaveGateway: this.gateway });
  }
}
