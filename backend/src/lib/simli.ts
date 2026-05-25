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
import { env } from "./env.js";

const SIMLI_API_BASE = "https://api.simli.ai";

export interface SimliComposeOptions {
  faceId?: string;
  maxSessionLength?: number;
  maxIdleTime?: number;
  handleSilence?: boolean;
}

export interface SimliSessionResult {
  sessionToken: string;
  faceId: string;
  maxSessionLength: number;
  maxIdleTime: number;
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

    return { sessionToken: token, faceId, maxSessionLength, maxIdleTime };
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
