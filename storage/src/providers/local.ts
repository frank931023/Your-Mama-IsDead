import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { resolve as resolvePath, join, isAbsolute } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type {
  IStorageProvider,
  PutResult,
  Tag,
} from "./IStorageProvider.js";

export interface LocalProviderOptions {
  /** Root directory that holds blobs (default: ./.local-storage). */
  root?: string;
}

/**
 * Filesystem-backed provider, used for offline development and unit tests.
 *
 * Layout:
 *   <root>/<sha256>.bin       — payload
 *   <root>/<sha256>.meta.json — { contentType, tags } (optional, best-effort)
 *
 * URIs follow the `file://` scheme so they survive a JSON round trip and
 * can be distinguished from real CIDs.
 */
export class LocalProvider implements IStorageProvider {
  public readonly name = "local";
  private readonly root: string;

  constructor(opts: LocalProviderOptions = {}) {
    const r = opts.root ?? "./.local-storage";
    this.root = isAbsolute(r) ? r : resolvePath(process.cwd(), r);
  }

  async putBlob(
    data: Buffer | Uint8Array,
    contentType: string,
    tags?: Tag[],
  ): Promise<PutResult> {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await mkdir(this.root, { recursive: true });

    const digest = createHash("sha256").update(buf).digest("hex");
    const filePath = join(this.root, `${digest}.bin`);
    const metaPath = join(this.root, `${digest}.meta.json`);

    await writeFile(filePath, buf);
    await writeFile(
      metaPath,
      JSON.stringify({ contentType, tags: tags ?? [] }, null, 2),
      "utf8",
    );

    return {
      uri: pathToFileURL(filePath).toString(),
      cid: digest,
      size: buf.byteLength,
    };
  }

  async putJSON(obj: unknown, tags?: Tag[]): Promise<PutResult> {
    const json = Buffer.from(JSON.stringify(obj), "utf8");
    return this.putBlob(json, "application/json", tags);
  }

  async resolve(uri: string): Promise<Buffer> {
    if (!uri.startsWith("file://")) {
      throw new Error(
        `LocalProvider.resolve: only file:// URIs supported, got "${uri}"`,
      );
    }
    const path = fileURLToPath(uri);
    const s = await stat(path);
    if (!s.isFile()) {
      throw new Error(`LocalProvider.resolve: not a file: ${path}`);
    }
    return readFile(path);
  }

  gatewayUrl(uri: string): string {
    // No gateway for local files; return as-is so a dev tool that resolves
    // file:// URIs (e.g. an Electron preload) can still consume it.
    return uri;
  }
}
