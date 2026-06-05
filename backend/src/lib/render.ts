/**
 * LAM 渲染机 (YMID-RENDER-API) 客户端
 *
 * 这台自建渲染机 (Tailscale 内网, e.g. http://100.122.149.34:8012) 负责:
 *   - LLM (vLLM Qwen3) · 声音克隆 (IndexTTS2) · audio2expression (LAM A2E)
 *   - 头部姿态 (ARTalk) · 从单图构建 3DGS avatar
 *
 * 后端的职责很轻:
 *   1. 用与渲染机**共享的** RENDER_JWT_SECRET 签一个短期 HS256 token,交给前端
 *      去开 WebSocket (ws://.../render?token=...) 直连渲染机做实时对话。
 *   2. 代理「一次性」的资产构建 (上传逝者照片 → 3DGS avatar / 上传音频 → 克隆声音),
 *      因为这两步要带文件且发生在 mint 阶段,放后端做鉴权更稳。
 *
 * 注意: 渲染机用的是它自己的 shared secret (RENDER_JWT_SECRET),与 @fastify/jwt
 * 给前端用户签 SIWE 会话用的 JWT_SECRET 是**两套不同的密钥**,别混。
 */
import crypto from "node:crypto";
import axios, { AxiosError } from "axios";
import FormData from "form-data";
import { env } from "./env.js";

export class RenderError extends Error {
  readonly status: number;
  readonly upstream: unknown;
  constructor(message: string, status: number, upstream: unknown) {
    super(message);
    this.name = "RenderError";
    this.status = status;
    this.upstream = upstream;
  }
}

/** 渲染机是否已配置 (RENDER_BASE 有值)。未配置时相关路由返回 503。 */
export function renderConfigured(): boolean {
  return typeof env.RENDER_BASE === "string" && env.RENDER_BASE.length > 0;
}

function renderBase(): string {
  if (!env.RENDER_BASE) throw new RenderError("render_not_configured", 503, null);
  return env.RENDER_BASE.replace(/\/+$/, "");
}

// ── HS256 JWT (手搓, 不引新依赖; 与渲染机共享 RENDER_JWT_SECRET) ──────────────
function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface RenderTokenClaims {
  /** 内部 user id (这里用钱包地址), 渲染机仅用于日志 */
  sub: string;
  /** 该 NFT tokenId = 哪个 persona */
  persona: string;
  /** 已上传的声音 label */
  voice?: string;
  /** avatar label */
  avatar?: string;
}

/**
 * 用共享密钥 RENDER_JWT_SECRET 签一个短期 HS256 token,给前端开 WS 用。
 * 渲染机会校验 aud / exp;若渲染机没设 secret 则它是 dev 模式 (auth off)。
 */
export function signRenderToken(claims: RenderTokenClaims): string {
  if (!env.RENDER_JWT_SECRET) {
    throw new RenderError("render_jwt_secret_missing", 503, null);
  }
  const now = Math.floor(Date.now() / 1000);
  // iat 往前回拨 60s:本機與渲染機的時鐘可能有幾秒漂移,若 iat 設成「現在」,
  // 渲染機收到時可能認為 token 還沒生效 (invalid token: not yet valid (iat)) 而拒。
  // 回拨一個寬裕值可避免這個時鐘漂移坑;exp 仍以真正的 now 計算。
  const CLOCK_SKEW_SEC = 60;
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: claims.sub,
    aud: env.RENDER_JWT_AUDIENCE,
    persona: claims.persona,
    ...(claims.voice ? { voice: claims.voice } : {}),
    ...(claims.avatar ? { avatar: claims.avatar } : {}),
    iat: now - CLOCK_SKEW_SEC,
    nbf: now - CLOCK_SKEW_SEC,
    exp: now + env.RENDER_TOKEN_TTL_SECONDS,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto
    .createHmac("sha256", env.RENDER_JWT_SECRET)
    .update(signingInput)
    .digest();
  return `${signingInput}.${b64url(sig)}`;
}

/** 给前端开 WS 用的连接信息。 */
export interface AvatarSessionInfo {
  /** 完整 WS URL: ws(s)://host/render?token=<jwt> */
  wsUrl: string;
  /** 短期 render token (也单独给出, 方便前端按需重连重签) */
  token: string;
  /** 渲染机的 http base, 前端下载 avatar zip / 列资源时用 */
  renderBase: string;
  /** 该 persona 绑定的 voice / avatar label (可能为空, 渲染机会用默认) */
  voice?: string;
  avatar?: string;
  /** 3DGS avatar zip 的完整可下载 URL (renderBase + metadata 里的相对路径)，
   *  前端 WebGL 渲染器直接用。avatar 还没生成时为 undefined。 */
  avatarUrl?: string;
  /** token 有效期 (秒) */
  ttlSec: number;
}

export function buildAvatarSession(
  claims: RenderTokenClaims,
  /** metadata.dsas.avatar.avatarUrl 的相对路径 (e.g. /static/avatars/x.zip)。 */
  avatarRelUrl?: string,
): AvatarSessionInfo {
  const token = signRenderToken(claims);
  const base = renderBase();
  const wsUrl = `${base.replace(/^http/, "ws")}/render?token=${encodeURIComponent(token)}`;
  return {
    wsUrl,
    token,
    renderBase: base,
    voice: claims.voice,
    avatar: claims.avatar,
    avatarUrl: avatarRelUrl ? `${base}${avatarRelUrl.startsWith("/") ? "" : "/"}${avatarRelUrl}` : undefined,
    ttlSec: env.RENDER_TOKEN_TTL_SECONDS,
  };
}

// ── 资产构建代理 (一次性, mint 阶段) ────────────────────────────────────────

export interface BuildAvatarResult {
  label: string;
  /** 渲染机上的相对路径, e.g. /static/avatars/<label>.zip */
  url: string;
  took_sec?: number;
  size?: number;
}

export interface BuildVoiceResult {
  label: string;
  path: string;
  size?: number;
}

/**
 * 上传一张照片 → 渲染机用 LAM 重建 3DGS avatar (POST /upload_avatar)。
 * 注意: 这个调用会**阻塞约 100 秒** (LAM 重建 + 渲染机内部 mutex 串行化),
 * 所以路由层和前端都要给足超时。
 */
export async function buildAvatar(
  image: Buffer,
  label: string,
  fileName: string,
  contentType: string,
): Promise<BuildAvatarResult> {
  const form = new FormData();
  form.append("label", label);
  form.append("file", image, { filename: fileName, contentType });
  try {
    const res = await axios.post<BuildAvatarResult>(`${renderBase()}/upload_avatar`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${signRenderToken({ sub: "backend", persona: label })}` },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 180_000, // LAM 重建 ~100s, 留余量
      validateStatus: () => true,
    });
    if (res.status >= 400 || !res.data?.label) {
      const errMsg = (res.data as unknown as { error?: string })?.error;
      throw new RenderError(
        typeof errMsg === "string" ? errMsg : `render ${res.status}`,
        res.status,
        res.data,
      );
    }
    return res.data;
  } catch (err) {
    throw toRenderError(err);
  }
}

/**
 * 上传一段逝者音频 → 渲染机用 IndexTTS2 建克隆声音 profile (POST /upload_voice)。
 */
export async function buildVoice(
  audio: Buffer,
  label: string,
  fileName: string,
  contentType: string,
): Promise<BuildVoiceResult> {
  const form = new FormData();
  form.append("label", label);
  form.append("file", audio, { filename: fileName, contentType });
  try {
    const res = await axios.post<BuildVoiceResult>(`${renderBase()}/upload_voice`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${signRenderToken({ sub: "backend", persona: label })}` },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 60_000,
      validateStatus: () => true,
    });
    if (res.status >= 400 || !res.data?.label) {
      throw new RenderError(`render ${res.status}`, res.status, res.data);
    }
    return res.data;
  } catch (err) {
    throw toRenderError(err);
  }
}

function toRenderError(err: unknown): RenderError {
  if (err instanceof RenderError) return err;
  if (err instanceof AxiosError) {
    return new RenderError(err.message, err.response?.status ?? 502, err.response?.data ?? null);
  }
  return new RenderError(err instanceof Error ? err.message : "render_unknown_error", 502, null);
}
