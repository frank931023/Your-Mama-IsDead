/**
 * 檔案上傳路由 (中繼 + 預簽名兩種策略)
 *
 * 兩種上傳模式:
 *   1. presign:Pinata V3 提供短時效簽名 JWT,瀏覽器直接 PUT 上去 (快)
 *   2. relay:後端代為釘到 IPFS (穩,但流量過後端)
 *
 * presign 失敗 (帳號太舊 / endpoint 變動) 會自動 fallback 到 relay。
 * Frontend 預設用 relay (POST /api/uploads/relay),簡單可靠。
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import path from "node:path";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import axios, { AxiosError } from "axios";
import FormData from "form-data";
import { env } from "../lib/env.js";
import { getStorageMode } from "../lib/runtime-config.js";

const PresignBody = z.object({
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(128),
  size: z.number().int().positive().max(2 * 1024 * 1024 * 1024), // 2 GiB hard cap
});

const PINATA_PIN_FILE = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_V3_SIGN = "https://api.pinata.cloud/v3/files/sign";

interface PinataPinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

interface LocalFileMeta {
  filename: string;
  contentType: string;
  size: number;
}

/**
 * Storage mode = "local" 的落地實作:串流寫入 LOCAL_UPLOAD_DIR,邊寫邊算
 * sha256,以雜湊為檔名(天然去重),旁邊放 <hash>.json 記 content-type。
 * 回傳的 URI 是 backend 自己的 HTTP 路由 — 瀏覽器(localhost:4000)與
 * backend 容器內(自己)都解析得到;鏈上 tokenURI 存這個字串也完全合法。
 */
async function saveLocalFile(
  stream: NodeJS.ReadableStream,
  meta: { filename: string; contentType: string },
): Promise<{ hash: string; size: number }> {
  await mkdir(env.LOCAL_UPLOAD_DIR, { recursive: true });
  const tmpPath = path.join(env.LOCAL_UPLOAD_DIR, `.tmp-${randomUUID()}`);
  const hasher = createHash("sha256");
  let size = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hasher.update(chunk);
      size += chunk.length;
      cb(null, chunk);
    },
  });
  try {
    await pipeline(stream, tap, createWriteStream(tmpPath));
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
  const hash = hasher.digest("hex");
  const finalPath = path.join(env.LOCAL_UPLOAD_DIR, hash);
  await rename(tmpPath, finalPath);
  const sidecar: LocalFileMeta = { filename: meta.filename, contentType: meta.contentType, size };
  await writeFile(`${finalPath}.json`, JSON.stringify(sidecar));
  return { hash, size };
}

export const uploadRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/uploads/presign
   *
   * Architectural decision:
   *   Pinata's V3 `POST /v3/files/sign` is supported (when PINATA_JWT is set);
   *   we attempt to ask Pinata for a short-lived signed JWT so the browser can
   *   upload directly. If the API rejects (older accounts / endpoint churn),
   *   we degrade to a server-side relay flow by returning a backend uploadId
   *   the frontend then POSTs to /api/uploads/relay.
   */
  app.post("/presign", async (request, reply) => {
    const parsed = PresignBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }

    // 本地模式沒有「瀏覽器直傳」可言,一律導去 relay
    if ((await getStorageMode()) === "local") {
      return reply.send({
        mode: "relay",
        uploadId: randomUUID(),
        relayUrl: "/api/uploads/relay",
        reason: "storage_mode_local",
      });
    }

    if (!env.PINATA_JWT) {
      return reply.send({
        mode: "relay",
        uploadId: randomUUID(),
        relayUrl: "/api/uploads/relay",
        reason: "PINATA_JWT not configured",
      });
    }

    try {
      const res = await axios.post<{
        data?: { jwt?: string; url?: string; expires?: string };
      }>(
        PINATA_V3_SIGN,
        {
          filename: parsed.data.filename,
          contentType: parsed.data.contentType,
          size: parsed.data.size,
        },
        {
          headers: {
            Authorization: `Bearer ${env.PINATA_JWT}`,
            "Content-Type": "application/json",
          },
          timeout: 10_000,
          validateStatus: (s) => s >= 200 && s < 300,
        },
      );
      const data = res.data?.data;
      if (!data?.jwt || !data?.url) {
        throw new Error("malformed pinata sign response");
      }
      return reply.send({
        mode: "presign",
        provider: "pinata",
        uploadJwt: data.jwt,
        uploadUrl: data.url,
        expiresAt: data.expires ?? null,
      });
    } catch (err) {
      const detail =
        err instanceof AxiosError ? `${err.response?.status ?? "?"} ${err.message}` : String(err);
      request.log.warn({ detail }, "Pinata presign failed; falling back to relay");
      return reply.send({
        mode: "relay",
        uploadId: randomUUID(),
        relayUrl: "/api/uploads/relay",
        reason: "presign_failed",
      });
    }
  });

  /**
   * POST /api/uploads/relay
   * multipart/form-data with a single `file` field. Server-side forwards
   * to Pinata pinFileToIPFS using PINATA_JWT and returns { cid, uri, size }.
   *
   * Requires @fastify/multipart to be registered on the parent instance.
   */
  app.post("/relay", async (request, reply) => {
    const storageMode = await getStorageMode();
    if (storageMode === "pinata" && !env.PINATA_JWT) {
      return reply.code(503).send({ error: "pinata_not_configured" });
    }

    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "expected_multipart" });
    }

    const filePart = await request.file();
    if (!filePart) {
      return reply.code(400).send({ error: "no_file" });
    }

    const filename = filePart.filename;
    const contentType = filePart.mimetype || "application/octet-stream";

    if (storageMode === "local") {
      try {
        const { hash, size } = await saveLocalFile(filePart.file, { filename, contentType });
        return reply.send({
          cid: hash,
          uri: `${env.PUBLIC_BACKEND_ORIGIN}/api/uploads/local/${hash}`,
          name: filename,
          contentType,
          size,
          storage: "local",
        });
      } catch (err) {
        request.log.error({ err }, "local upload failed");
        return reply.code(500).send({ error: "local_upload_failed" });
      }
    }

    const form = new FormData();
    form.append("file", filePart.file, {
      filename,
      contentType,
    });
    form.append(
      "pinataMetadata",
      JSON.stringify({ name: filename, keyvalues: { app: "DSAS" } }),
    );

    try {
      const res = await axios.post<PinataPinResponse>(PINATA_PIN_FILE, form, {
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${env.PINATA_JWT}`,
        },
        timeout: 120_000,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      return reply.send({
        cid: res.data.IpfsHash,
        uri: `ipfs://${res.data.IpfsHash}`,
        name: filename,
        contentType,
        size: res.data.PinSize,
      });
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : undefined;
      request.log.error({ err, status }, "Pinata relay upload failed");
      return reply
        .code(502)
        .send({ error: "pinata_upload_failed", upstreamStatus: status ?? null });
    }
  });

  /**
   * GET /api/uploads/local/:hash
   * 讀回本地模式存的檔案。無論目前 storage mode 為何都可讀 —
   * 切回 pinata 模式後,先前用本地 URI 鑄的塔位 metadata 仍要能解析。
   */
  app.get("/local/:hash", async (request, reply) => {
    const { hash } = request.params as { hash: string };
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return reply.code(400).send({ error: "invalid_hash" });
    }
    const filePath = path.join(env.LOCAL_UPLOAD_DIR, hash);
    try {
      await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
    let meta: LocalFileMeta | null = null;
    try {
      meta = JSON.parse(await readFile(`${filePath}.json`, "utf8")) as LocalFileMeta;
    } catch {
      // sidecar 遺失就用泛型 content-type,不擋下載
    }
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.type(meta?.contentType ?? "application/octet-stream").send(createReadStream(filePath));
  });
};
