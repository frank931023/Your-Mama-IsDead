import axios, { type AxiosInstance } from "axios";
import FormData from "form-data";
import { Buffer } from "node:buffer";
import type {
  IStorageProvider,
  PutResult,
  Tag,
} from "./IStorageProvider.js";
import { toGatewayUrl } from "../uri.js";

const PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

interface PinataPinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

export interface PinataProviderOptions {
  /** JWT token from https://app.pinata.cloud/keys (env: PINATA_JWT). */
  jwt?: string;
  /** Public IPFS gateway prefix (env: IPFS_GATEWAY). */
  gateway?: string;
  /** Override axios instance for tests. */
  http?: AxiosInstance;
}

/**
 * IPFS pinning via Pinata's REST API.
 *
 * Pinata is the prototype default because its free tier (1 GB) is enough for
 * demos and the resulting `ipfs://<cid>` URI is portable to any other IPFS
 * gateway / pinning service.
 */
export class PinataProvider implements IStorageProvider {
  public readonly name = "pinata";
  private readonly jwt: string;
  private readonly gateway: string;
  private readonly http: AxiosInstance;

  constructor(opts: PinataProviderOptions = {}) {
    const jwt = opts.jwt ?? process.env.PINATA_JWT;
    if (!jwt) {
      throw new Error(
        "PinataProvider: missing JWT (set PINATA_JWT env var or pass opts.jwt)",
      );
    }
    this.jwt = jwt;
    this.gateway =
      opts.gateway ??
      process.env.IPFS_GATEWAY ??
      "https://gateway.pinata.cloud/ipfs/";
    this.http = opts.http ?? axios.create({ timeout: 60_000 });
  }

  async putBlob(
    data: Buffer | Uint8Array,
    contentType: string,
    tags?: Tag[],
  ): Promise<PutResult> {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const form = new FormData();
    const filename = inferFilename(contentType);
    form.append("file", buf, { filename, contentType });

    const keyvalues = tagsToKeyValues(tags);
    if (keyvalues) {
      form.append(
        "pinataMetadata",
        JSON.stringify({ name: filename, keyvalues }),
      );
    }
    form.append(
      "pinataOptions",
      JSON.stringify({ cidVersion: 1, wrapWithDirectory: false }),
    );

    const res = await this.http.post<PinataPinResponse>(PIN_FILE_URL, form, {
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${this.jwt}`,
      },
    });

    return {
      uri: `ipfs://${res.data.IpfsHash}`,
      cid: res.data.IpfsHash,
      size: res.data.PinSize ?? buf.byteLength,
    };
  }

  async putJSON(obj: unknown, tags?: Tag[]): Promise<PutResult> {
    const keyvalues = tagsToKeyValues(tags);
    const body: Record<string, unknown> = {
      pinataContent: obj,
      pinataOptions: { cidVersion: 1 },
    };
    if (keyvalues) {
      body.pinataMetadata = { keyvalues };
    }

    const res = await this.http.post<PinataPinResponse>(PIN_JSON_URL, body, {
      headers: {
        Authorization: `Bearer ${this.jwt}`,
        "Content-Type": "application/json",
      },
    });

    const serialized = Buffer.byteLength(JSON.stringify(obj), "utf8");
    return {
      uri: `ipfs://${res.data.IpfsHash}`,
      cid: res.data.IpfsHash,
      size: res.data.PinSize ?? serialized,
    };
  }

  async resolve(uri: string): Promise<Buffer> {
    const url = this.gatewayUrl(uri);
    const res = await this.http.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
    });
    return Buffer.from(res.data);
  }

  gatewayUrl(uri: string): string {
    return toGatewayUrl(uri, { ipfsGateway: this.gateway });
  }
}

function tagsToKeyValues(
  tags: Tag[] | undefined,
): Record<string, string> | undefined {
  if (!tags || tags.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const t of tags) out[t.name] = t.value;
  return out;
}

function inferFilename(contentType: string): string {
  const sub = contentType.split("/")[1] ?? "bin";
  return `blob.${sub.split(";")[0]}`;
}
