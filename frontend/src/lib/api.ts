/**
 * Frontend ↔ Backend HTTP API client
 *
 * 集中所有對 /api/* 的請求,讓元件不必重複處理 base URL / JWT header / 錯誤解析。
 *
 * 約定:
 *   - 不在這裡彈 ErrorDialog,讓呼叫方 try/catch 後決定要不要彈
 *   - 失敗一律 throw ApiError(包含 status + body),呼叫方拿 e.message 顯示即可
 *   - JWT 由 useSiweLogin() 取得後傳入 (不全域存放)
 */
import type { TabletMetadata } from "@shared/types/tablet";

const RAW_BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
export const BACKEND_URL = RAW_BACKEND.replace(/\/+$/, "");

export interface UploadedAsset {
  uri: string; // ipfs://... or ar://...
  cid: string;
  name: string;
  contentType: string;
  size?: number;
}

export interface TabletRecord {
  tokenId: string; // bigint as string
  owner: string;
  parentTokenId: string | null;
  tokenURI: string;
  artifactURI: string | null;
  metadata: TabletMetadata | null;
  createdAt: string;
}

export interface LineageNode {
  tokenId: string;
  parentTokenId: string | null;
  owner: string;
  name: string;
  portrait: string | null;
  birthDate: string | null;
  deathDate: string | null;
  generation: number;
  children: LineageNode[];
}

export interface JobStatus {
  id: string;
  tokenId: string;
  status: "QUEUED" | "RUNNING" | "UPLOADED" | "DONE" | "FAILED";
  artifactCid: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface PresignResponse {
  uploadUrl: string;
  fields?: Record<string, string>;
  expiresAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
    }
    const msg =
      (typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return (await res.json()) as T;
}

function authHeaders(jwt?: string): HeadersInit {
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export async function fetchTablet(tokenId: string | number): Promise<TabletRecord> {
  const res = await fetch(`${BACKEND_URL}/api/tablets/${tokenId}`, { cache: "no-store" });
  return handle<TabletRecord>(res);
}

export async function syncTablet(tokenId: string | number, jwt?: string): Promise<TabletRecord> {
  const res = await fetch(`${BACKEND_URL}/api/tablets/${tokenId}/sync`, {
    method: "POST",
    headers: authHeaders(jwt),
  });
  return handle<TabletRecord>(res);
}

export async function fetchLineage(rootId: string | number): Promise<LineageNode> {
  const res = await fetch(`${BACKEND_URL}/api/tablets/${rootId}/lineage`, {
    cache: "no-store",
  });
  return handle<LineageNode>(res);
}

export async function getOwned(owner: string): Promise<TabletRecord[]> {
  const res = await fetch(
    `${BACKEND_URL}/api/tablets?owner=${encodeURIComponent(owner)}`,
    { cache: "no-store" },
  );
  return handle<TabletRecord[]>(res);
}

export async function getRegistry(): Promise<TabletRecord[]> {
  const res = await fetch(`${BACKEND_URL}/api/tablets/registry`, { cache: "no-store" });
  return handle<TabletRecord[]>(res);
}

export async function scanRegistry(): Promise<{ found: number; tablets: TabletRecord[] }> {
  const res = await fetch(`${BACKEND_URL}/api/tablets/scan`, { method: "POST" });
  return handle<{ found: number; tablets: TabletRecord[] }>(res);
}

export interface CloudStatus {
  chat: boolean;
  voice: boolean;
  image: boolean;
  video: boolean;
  avatar: boolean;
  chatProvider: "anthropic" | "openai" | null;
  voiceProvider: "elevenlabs" | "openai" | null;
  imageProvider: "fal" | "openai" | null;
  videoProvider: "fal" | null;
  avatarProvider: "simli" | null;
}

export async function getCloudStatus(): Promise<CloudStatus> {
  const res = await fetch(`${BACKEND_URL}/api/personas/cloud-status`, { cache: "no-store" });
  return handle<CloudStatus>(res);
}

export interface SimliSession {
  sessionToken: string;
  faceId: string;
  maxSessionLength: number;
  maxIdleTime: number;
  /** ICE/TURN servers for the WebRTC peer connection (RTCIceServer-shaped).
   *  Empty if the backend's ICE lookup failed. */
  iceServers: RTCIceServer[];
}

export async function fetchSimliSession(
  tokenId: string | number,
  jwt: string,
): Promise<SimliSession> {
  const res = await fetch(`${BACKEND_URL}/api/personas/${tokenId}/simli-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(jwt) },
    // Send an empty JSON object so Fastify's content-type parser doesn't reject
    // the request with FST_ERR_CTP_EMPTY_JSON_BODY (400). This route takes no
    // body — faceId is resolved server-side from the tablet metadata — but the
    // Content-Type: application/json header above makes Fastify require a body.
    body: "{}",
  });
  return handle<SimliSession>(res);
}

export interface SimliFaceGeneration {
  faceId: string;
  /** 生成提交當下的狀態快照 (e.g. "pending")，非權威。 */
  status?: string;
  /** 配額已滿時後端刪掉的最舊一張臉 (騰名額)。 */
  evicted?: { faceId: string } | null;
}

export interface SimliFaceStatus {
  faceId: string;
  status: string; // "not_found" | "pending" | "processing" | "completed" | ...
  queuePosition?: number;
}

/**
 * 上傳逝者大頭照給 Simli 生成專屬 avatar 臉,回傳可立即使用的 faceId。
 *
 * 生成本身是非同步的 (Simli 文件說可能要數分鐘),但 faceId 提交當下就能拿到,
 * 也能立刻開 session。需要 SIWE 登入態 (避免匿名消耗 Simli 配額)。
 *
 * 失敗 (例如配額滿且無臉可刪) 會 throw ApiError,呼叫方可降級到預設臉。
 */
export async function generateSimliFace(
  image: File | Blob,
  jwt: string,
): Promise<SimliFaceGeneration> {
  const form = new FormData();
  const name = image instanceof File ? image.name : "portrait.jpg";
  form.append("image", image, name);
  const res = await fetch(`${BACKEND_URL}/api/simli/face`, {
    method: "POST",
    headers: authHeaders(jwt), // 不要手動設 Content-Type,讓瀏覽器帶上 multipart boundary
    body: form,
  });
  return handle<SimliFaceGeneration>(res);
}

/**
 * 麥克風語音轉文字 (STT)。把錄好的音訊 blob 丟給後端 → OpenAI Whisper,
 * 回傳辨識文字。供麥克風對話模式用,辨識結果接著走既有 chat 流程。
 */
export async function transcribeAudio(
  tokenId: string | number,
  audio: Blob,
  jwt: string,
): Promise<string> {
  const form = new FormData();
  // 給個帶副檔名的檔名,Whisper 靠它判斷格式;MediaRecorder 多輸出 webm。
  const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "mp4" : "webm";
  form.append("audio", audio, `speech.${ext}`);
  const res = await fetch(`${BACKEND_URL}/api/personas/${tokenId}/cloud-stt`, {
    method: "POST",
    headers: authHeaders(jwt), // 不要手動設 Content-Type,讓瀏覽器帶 multipart boundary
    body: form,
  });
  const { text } = await handle<{ text: string }>(res);
  return text;
}

/** 查 faceId 生成進度。 */
export async function getSimliFaceStatus(
  faceId: string,
  jwt: string,
): Promise<SimliFaceStatus> {
  const res = await fetch(
    `${BACKEND_URL}/api/simli/face/${encodeURIComponent(faceId)}/status`,
    { headers: authHeaders(jwt), cache: "no-store" },
  );
  return handle<SimliFaceStatus>(res);
}

export interface Tribute {
  id: string;
  tokenId: string;
  fromAddress: string | null;
  fromName: string | null;
  message: string;
  createdAt: string;
}

export async function listTributes(tokenId: string | number): Promise<Tribute[]> {
  const res = await fetch(`${BACKEND_URL}/api/tributes/${tokenId}`, { cache: "no-store" });
  return handle<Tribute[]>(res);
}

export async function createTribute(
  tokenId: string | number,
  body: { message: string; fromName?: string; fromAddress?: string },
): Promise<Tribute> {
  const res = await fetch(`${BACKEND_URL}/api/tributes/${tokenId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handle<Tribute>(res);
}

/**
 * 上傳檔案到 backend → 由 backend 釘到 IPFS。
 *
 * 走 XMLHttpRequest 是為了拿到 upload 進度事件 (fetch API 至今仍無法
 * 監聽上傳進度)。SSR / 測試環境沒有 XHR 時 fallback 到 fetch。
 */
export async function uploadRelay(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadedAsset> {
  const form = new FormData();
  form.append("file", file);
  form.append("name", file.name);
  form.append("contentType", file.type || "application/octet-stream");

  if (typeof XMLHttpRequest === "undefined") {
    const res = await fetch(`${BACKEND_URL}/api/uploads/relay`, {
      method: "POST",
      body: form,
    });
    return handle<UploadedAsset>(res);
  }

  return new Promise<UploadedAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BACKEND_URL}/api/uploads/relay`, true);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedAsset);
        } catch (err) {
          reject(new ApiError(xhr.status, "Invalid JSON from upload relay", err));
        }
      } else {
        reject(new ApiError(xhr.status, `Upload failed (${xhr.status})`, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload", null));
    xhr.send(form);
  });
}

export async function presignUpload(
  filename: string,
  contentType: string,
  jwt?: string,
): Promise<PresignResponse> {
  const res = await fetch(`${BACKEND_URL}/api/uploads/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(jwt) },
    body: JSON.stringify({ filename, contentType }),
  });
  return handle<PresignResponse>(res);
}

export interface CreateJobInput {
  tokenId: string;
  kind?: "training";
}

export async function createJob(input: CreateJobInput, jwt?: string): Promise<JobStatus> {
  const res = await fetch(`${BACKEND_URL}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(jwt) },
    body: JSON.stringify(input),
  });
  return handle<JobStatus>(res);
}

export async function getJob(id: string): Promise<JobStatus> {
  const res = await fetch(`${BACKEND_URL}/api/jobs/${id}`, { cache: "no-store" });
  return handle<JobStatus>(res);
}

export async function fetchAuthNonce(address: string): Promise<{ nonce: string; issuedAt: string }> {
  const res = await fetch(
    `${BACKEND_URL}/api/auth/nonce?address=${encodeURIComponent(address)}`,
    { cache: "no-store" },
  );
  return handle<{ nonce: string; issuedAt: string }>(res);
}

export async function verifySiwe(
  message: string,
  signature: string,
  tokenId?: string,
): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch(`${BACKEND_URL}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature, tokenId }),
  });
  return handle<{ token: string; expiresAt: string }>(res);
}
