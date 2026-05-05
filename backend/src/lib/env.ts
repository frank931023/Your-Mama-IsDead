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
