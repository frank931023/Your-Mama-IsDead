/**
 * 集中式環境變數載入 + 驗證
 *
 * 所有設定值都在這個檔案的 zod schema 集中,避免散落在各模組各自讀
 * process.env 而出錯。啟動時若 schema 驗證失敗會直接 throw 並列出
 * 缺失的欄位,讓開發者一眼看到該補哪些 .env 設定。
 *
 * 載入順序:
 *   1. dotenv 自動讀根目錄 .env 寫入 process.env
 *   2. zod schema 驗證並轉型 (e.g. CHAIN_ID 從字串 coerce 成 number)
 *   3. 結果快取在 cached,後續 import { env } 直接拿
 */
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  // required
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  RPC_URL: z.string().url("RPC_URL must be a valid URL"),
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "CONTRACT_ADDRESS must be a 0x address"),
  CHAIN_ID: z.coerce.number().int().positive(),
  SIWE_DOMAIN: z.string().min(1),

  // optional
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  BACKEND_HOST: z.string().default("0.0.0.0"),
  FRONTEND_URL: z.string().url().optional(),
  PINATA_JWT: z.string().optional(),
  COMPUTE_URL: z.string().url().optional(),
  IPFS_GATEWAY: z.string().url().default("https://gateway.pinata.cloud/ipfs/"),
  TRAINER_API_KEY: z.string().optional(),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Cloud-mode persona providers (optional). When set, the /cloud-* endpoints
  // can answer chat / voice / portrait without needing the offline training
  // pipeline + on-chain artifactURI.
  // Chat: Anthropic preferred when both keys present (more reliable, cheaper),
  // falls back to OpenAI. Voice/image still need OPENAI_API_KEY.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_CHAT_MODEL: z.string().default("claude-sonnet-4-6"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_TTS_MODEL: z.string().default("tts-1"),
  OPENAI_TTS_VOICE: z.string().default("shimmer"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),

  // fal.ai — diffusion + video providers (Kling / Hailuo / Veo / FLUX). Used
  // when set as alternative to / fallback for OpenAI image gen, and as the
  // primary path for short-video generation (`/cloud-video`).
  FAL_API_KEY: z.string().optional(),
  FAL_IMAGE_MODEL: z.string().default("fal-ai/flux/schnell"),
  FAL_VIDEO_MODEL: z.string().default("fal-ai/kling-video/v1.6/standard/text-to-video"),

  // Simli — realtime lip-synced talking-head avatar. When SIMLI_API_KEY is set,
  // the frontend can request a per-session compose token and render a live
  // avatar in the chat view. The face ID is the Simli avatar identifier
  // (created via dashboard or POST /faces/trinity); falls back to Simli's
  // public preset face so the integration works out-of-the-box during dev.
  SIMLI_API_KEY: z.string().optional(),
  SIMLI_DEFAULT_FACE_ID: z.string().default("tmp9i8bbq7c"),
  SIMLI_MAX_SESSION_SECONDS: z.coerce.number().int().positive().default(600),
  SIMLI_MAX_IDLE_SECONDS: z.coerce.number().int().positive().default(180),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * 第一次呼叫時讀取並驗證 process.env,後續呼叫直接回傳快取結果。
 * 驗證失敗會 throw,把所有缺失欄位列在錯誤訊息裡。
 */
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env: Env = loadEnv();
