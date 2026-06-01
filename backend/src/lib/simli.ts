/**
 * Simli compose-session helper
 *
 * Simli (https://docs.simli.com) is a speech-to-video service: feed it PCM /
 * MediaStreamTrack audio and it streams back a lip-synced talking-head video.
 *
 * We use the **compose** path (POST /compose/token), not auto, because the
 * existing chat flow already owns LLM streaming + TTS — we only need Simli to
 * lip-sync the TTS output. Auto path would put Simli in charge of LLM + TTS
 * and bypass our persona system prompt.
 *
 * The API key never leaves the server; the per-session token is minted here
 * and handed to the browser, which uses simli-client to open the WebRTC pipe.
 */
import axios, { AxiosError } from "axios";
import FormData from "form-data";
import { env } from "./env.js";

const SIMLI_API_BASE = "https://api.simli.ai";

export interface SimliComposeOptions {
  faceId?: string;
  maxSessionLength?: number;
  maxIdleTime?: number;
  handleSilence?: boolean;
}

/** A single ICE/TURN server entry as returned by Simli's GET /compose/ice. */
export interface SimliIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SimliSessionResult {
  sessionToken: string;
  faceId: string;
  maxSessionLength: number;
  maxIdleTime: number;
  /** ICE/TURN servers for the browser's RTCPeerConnection. Without these the
   *  P2P WebRTC handshake times out ("CONNECTION TIMED OUT") on networks that
   *  need NAT traversal. Empty array if the ICE lookup failed — the client can
   *  still attempt a direct connection, it just won't traverse NAT. */
  iceServers: SimliIceServer[];
}

export class SimliError extends Error {
  readonly status: number;
  readonly upstream: unknown;
  constructor(message: string, status: number, upstream: unknown) {
    super(message);
    this.name = "SimliError";
    this.status = status;
    this.upstream = upstream;
  }
}

export function simliConfigured(): boolean {
  return typeof env.SIMLI_API_KEY === "string" && env.SIMLI_API_KEY.length > 0;
}

/**
 * Mint a short-lived compose session token. The returned token is bound to a
 * single avatar (`faceId`) and a hard wall-clock limit (`maxSessionLength`),
 * so it is safe to hand to the browser.
 */
export async function createComposeSessionToken(
  opts: SimliComposeOptions = {},
): Promise<SimliSessionResult> {
  if (!env.SIMLI_API_KEY) {
    throw new SimliError("simli_not_configured", 503, null);
  }
  const faceId = opts.faceId ?? env.SIMLI_DEFAULT_FACE_ID;
  const maxSessionLength = opts.maxSessionLength ?? env.SIMLI_MAX_SESSION_SECONDS;
  const maxIdleTime = opts.maxIdleTime ?? env.SIMLI_MAX_IDLE_SECONDS;

  try {
    const res = await axios.post<{ session_token?: string; detail?: string }>(
      `${SIMLI_API_BASE}/compose/token`,
      {
        faceId,
        apiVersion: "v2",
        handleSilence: opts.handleSilence ?? false,
        maxSessionLength,
        maxIdleTime,
        audioInputFormat: "pcm16",
      },
      {
        headers: {
          "x-simli-api-key": env.SIMLI_API_KEY,
          "content-type": "application/json",
        },
        timeout: 15_000,
        validateStatus: () => true,
      },
    );

    // Simli signals failure with HTTP 400 *and* a sentinel token "FAIL TOKEN".
    const token = res.data?.session_token;
    if (res.status >= 400 || !token || token === "FAIL TOKEN") {
      const detail = res.data?.detail ?? `Simli ${res.status}`;
      throw new SimliError(detail, res.status, res.data);
    }

    // Fetch ICE/TURN servers so the browser can traverse NAT. Best-effort:
    // an ICE failure must not block handing out the (valid) session token, so
    // we swallow it and return an empty list — the client falls back to a
    // direct connection attempt.
    const iceServers = await fetchIceServers().catch(() => []);

    return { sessionToken: token, faceId, maxSessionLength, maxIdleTime, iceServers };
  } catch (err) {
    if (err instanceof SimliError) throw err;
    if (err instanceof AxiosError) {
      throw new SimliError(
        err.message,
        err.response?.status ?? 502,
        err.response?.data ?? null,
      );
    }
    throw new SimliError(err instanceof Error ? err.message : "simli_unknown_error", 502, null);
  }
}

/**
 * Fetch ICE/TURN servers (GET /compose/ice) for the browser's
 * RTCPeerConnection. Verified live: returns Cloudflare STUN + TURN (udp/tcp/
 * turns) entries. The simli-client SDK ships a `generateIceServers` helper that
 * does the same call, but it needs the API key in the browser — so we proxy it
 * here and hand the result to the client alongside the session token.
 */
export async function fetchIceServers(): Promise<SimliIceServer[]> {
  if (!env.SIMLI_API_KEY) throw new SimliError("simli_not_configured", 503, null);
  const res = await axios.get<SimliIceServer[]>(`${SIMLI_API_BASE}/compose/ice`, {
    headers: { "x-simli-api-key": env.SIMLI_API_KEY, "content-type": "application/json" },
    timeout: 15_000,
    validateStatus: () => true,
  });
  if (res.status >= 400 || !Array.isArray(res.data)) {
    throw new SimliError(`Simli ice ${res.status}`, res.status, res.data);
  }
  return res.data;
}

// ───────────────────────────────────────────────────────────────────────────
// Custom avatar generation — turn an uploaded portrait into a personal faceId.
//
// IMPORTANT: there are TWO generation paths on Simli and they have SEPARATE
// quotas. We probed both against the live API with this account's real key:
//
//   • Trinity / "GS" faces  (POST /faces/trinity)
//       The newer, higher-fidelity path. The free tier's GS quota is 0 —
//       /faces/trinity returns 403 "reached the max number of GS Faces" no
//       matter how many *legacy* faces you delete (the quotas don't share).
//       So this path is unusable until the account upgrades. Left here for
//       when that happens (set useTrinity:true), but NOT the default.
//
//   • Legacy faces  (POST /generateFaceID)   ← what we actually use
//       → 200 { message, character_uid, warnings }  — character_uid is the
//         faceId, usable for compose/token IMMEDIATELY while still "pending".
//       Works on the free tier and is NOT capped by the GS quota, so no
//       eviction dance is needed.
//
// Shared / verified endpoints:
//   GET    /faces                              → 200 [{ id, created_at, simli_version }]
//   GET    /faces/legacy/generation_status?face_id=...
//                                              → 200 { status, face_id }
//   DELETE /faces/legacy/{faceId}              → 200 (legacy faces)
//   DELETE /faces/trinity/{faceId}             → 200 (trinity/GS faces)
// ───────────────────────────────────────────────────────────────────────────

export interface SimliFace {
  id: string;
  createdAt?: string;
  simliVersion?: number;
}

export interface SimliFaceGeneration {
  faceId: string;
  /** Generation status snapshot at submit time (e.g. "pending"). Non-authoritative. */
  status?: string;
  /** True when we had to delete the oldest custom face to free a quota slot. */
  evicted?: { faceId: string } | null;
}

export interface SimliFaceStatus {
  faceId: string;
  status: string; // "not_found" | "pending" | "processing" | "completed" | ...
  queuePosition?: number;
}

function simliHeaders(): Record<string, string> {
  if (!env.SIMLI_API_KEY) throw new SimliError("simli_not_configured", 503, null);
  return { "x-simli-api-key": env.SIMLI_API_KEY };
}

/** List the custom faces owned by the account behind SIMLI_API_KEY. */
export async function listFaces(): Promise<SimliFace[]> {
  try {
    const res = await axios.get<
      Array<{ id: string; created_at?: string; simli_version?: number }>
    >(`${SIMLI_API_BASE}/faces`, {
      headers: simliHeaders(),
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (res.status >= 400 || !Array.isArray(res.data)) {
      throw new SimliError(`Simli list faces ${res.status}`, res.status, res.data);
    }
    return res.data.map((f) => ({
      id: f.id,
      createdAt: f.created_at,
      simliVersion: f.simli_version,
    }));
  } catch (err) {
    throw toSimliError(err);
  }
}

/**
 * Delete a custom face. The delete endpoint differs by face version
 * (legacy → /faces/legacy/{id}, trinity → /faces/trinity/{id}); pass `kind`
 * accordingly. We generate legacy faces, so "legacy" is the default.
 */
export async function deleteFace(
  faceId: string,
  kind: "legacy" | "trinity" = "legacy",
): Promise<void> {
  try {
    const res = await axios.delete(`${SIMLI_API_BASE}/faces/${kind}/${faceId}`, {
      headers: simliHeaders(),
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      throw new SimliError(`Simli delete face ${res.status}`, res.status, res.data);
    }
  } catch (err) {
    throw toSimliError(err);
  }
}

/** Query generation progress for a legacy faceId. */
export async function getFaceStatus(faceId: string): Promise<SimliFaceStatus> {
  try {
    const res = await axios.get<{
      status?: string;
      queue_position?: number;
      face_id?: string;
    }>(`${SIMLI_API_BASE}/faces/legacy/generation_status`, {
      params: { face_id: faceId },
      headers: simliHeaders(),
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      throw new SimliError(`Simli face status ${res.status}`, res.status, res.data);
    }
    return {
      faceId: res.data?.face_id ?? faceId,
      status: res.data?.status ?? "unknown",
      queuePosition: res.data?.queue_position,
    };
  } catch (err) {
    throw toSimliError(err);
  }
}

export interface GenerateFaceOptions {
  fileName?: string;
  contentType?: string;
  faceName?: string;
  /**
   * Use the Trinity/GS path (POST /faces/trinity) instead of legacy. Only set
   * this once the account's GS quota is > 0 — on the free tier it 403s. When
   * true and the GS quota is full, `evictWhenFull` can free the oldest face.
   */
  useTrinity?: boolean;
  /** Trinity-only: on GS-quota 403, delete the oldest custom face and retry once. */
  evictWhenFull?: boolean;
}

/**
 * Generate a personal faceId from an uploaded portrait.
 *
 * Defaults to the legacy path (POST /generateFaceID), which is what works on
 * this account's free tier and is NOT capped by the GS quota — so generation
 * just succeeds, no eviction needed. The returned faceId is usable immediately
 * (compose/token accepts it while generation is still "pending"); lip-sync
 * quality firms up once the async generation reaches "completed".
 */
export async function generateFaceFromImage(
  image: Buffer,
  opts: GenerateFaceOptions = {},
): Promise<SimliFaceGeneration> {
  if (!opts.useTrinity) {
    return submitLegacyFace(image, opts);
  }

  // Trinity/GS path with optional quota eviction. Kept for post-upgrade use.
  const evictWhenFull = opts.evictWhenFull ?? true;
  let evicted: { faceId: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await submitTrinityFace(image, opts);
      return { ...result, evicted };
    } catch (err) {
      if (err instanceof SimliError && isQuotaFull(err) && evictWhenFull && attempt === 0) {
        const faces = await listFaces();
        if (faces.length === 0) throw err;
        const oldest = pickOldest(faces);
        // Pick the right delete endpoint for the face's version (1 = legacy).
        await deleteFace(oldest.id, oldest.simliVersion === 1 ? "legacy" : "trinity");
        evicted = { faceId: oldest.id };
        continue;
      }
      throw err;
    }
  }
  throw new SimliError("simli_face_generation_failed", 502, null);
}

/** POST /generateFaceID — the legacy generation path (free-tier friendly). */
async function submitLegacyFace(
  img: Buffer,
  o: GenerateFaceOptions,
): Promise<SimliFaceGeneration> {
  const form = new FormData();
  form.append("image", img, {
    filename: o.fileName ?? "portrait.jpg",
    contentType: o.contentType ?? "image/jpeg",
  });
  const res = await axios.post<{
    message?: string;
    character_uid?: string;
    face_id?: string;
    faceId?: string;
    warnings?: unknown[];
    detail?: string;
  }>(`${SIMLI_API_BASE}/generateFaceID`, form, {
    params: { face_name: o.faceName ?? "dsas_avatar" },
    headers: { ...simliHeaders(), ...form.getHeaders() },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 120_000,
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    const detail = res.data?.detail ?? `Simli ${res.status}`;
    throw new SimliError(typeof detail === "string" ? detail : `Simli ${res.status}`, res.status, res.data);
  }

  const faceId = res.data?.character_uid ?? res.data?.face_id ?? res.data?.faceId;
  if (!faceId || typeof faceId !== "string") {
    throw new SimliError("simli returned no faceId", 502, res.data);
  }
  // Legacy generation enqueues async; the face is "pending" right after submit.
  return { faceId, status: "pending", evicted: null };
}

/** POST /faces/trinity — the newer GS path (requires GS quota > 0). */
async function submitTrinityFace(
  img: Buffer,
  o: GenerateFaceOptions,
): Promise<SimliFaceGeneration> {
  const form = new FormData();
  form.append("image", img, {
    filename: o.fileName ?? "portrait.jpg",
    contentType: o.contentType ?? "image/jpeg",
  });
  const res = await axios.post<{
    character_uid?: string;
    faceId?: string;
    face_id?: string;
    id?: string;
    status?: string;
    detail?: string;
  }>(`${SIMLI_API_BASE}/faces/trinity`, form, {
    params: { face_name: o.faceName ?? "dsas_avatar" },
    headers: { ...simliHeaders(), ...form.getHeaders() },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 120_000,
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    const detail = res.data?.detail ?? `Simli ${res.status}`;
    throw new SimliError(typeof detail === "string" ? detail : `Simli ${res.status}`, res.status, res.data);
  }

  const faceId =
    res.data?.character_uid ?? res.data?.faceId ?? res.data?.face_id ?? res.data?.id;
  if (!faceId || typeof faceId !== "string") {
    throw new SimliError("simli returned no faceId", 502, res.data);
  }
  return { faceId, status: res.data?.status ?? "pending", evicted: null };
}

function isQuotaFull(err: SimliError): boolean {
  if (err.status !== 403) return false;
  const detail =
    typeof err.upstream === "object" && err.upstream !== null
      ? (err.upstream as { detail?: unknown }).detail
      : undefined;
  const text = typeof detail === "string" ? detail : err.message;
  return /max number of GS|upgrade your subscription|reached the max/i.test(text);
}

function pickOldest(faces: SimliFace[]): SimliFace {
  // created_at is ISO-8601; lexicographic compare on the string is chronological.
  return faces.reduce((oldest, f) =>
    (f.createdAt ?? "") < (oldest.createdAt ?? "") ? f : oldest,
  );
}

function toSimliError(err: unknown): SimliError {
  if (err instanceof SimliError) return err;
  if (err instanceof AxiosError) {
    return new SimliError(err.message, err.response?.status ?? 502, err.response?.data ?? null);
  }
  return new SimliError(err instanceof Error ? err.message : "simli_unknown_error", 502, null);
}
