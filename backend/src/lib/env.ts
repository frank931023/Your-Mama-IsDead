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
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

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
