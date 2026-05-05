import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import axios, { AxiosError } from "axios";
import FormData from "form-data";
import { env } from "../lib/env.js";

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
    if (!env.PINATA_JWT) {
      return reply.code(503).send({ error: "pinata_not_configured" });
    }

    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "expected_multipart" });
    }

    const filePart = await request.file();
    if (!filePart) {
      return reply.code(400).send({ error: "no_file" });
    }

    const form = new FormData();
    form.append("file", filePart.file, {
      filename: filePart.filename,
      contentType: filePart.mimetype,
    });
    form.append(
      "pinataMetadata",
      JSON.stringify({ name: filePart.filename, keyvalues: { app: "DSAS" } }),
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
};
