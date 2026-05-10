/**
 * DSAS Backend 主程式進入點
 *
 * 職責:
 * 1. 啟動 Fastify HTTP server
 * 2. 註冊核心 plugin (CORS / JWT / multipart)
 * 3. 掛載各路由 (auth / tablets / uploads / jobs / personas)
 * 4. 啟動 BullMQ 背景訓練 worker
 *
 * 與其他子系統的關係:
 *   - 鏈上資料 → backend/src/chain.ts (viem RPC)
 *   - DB        → backend/src/db.ts (Prisma + Postgres)
 *   - 雲端推理  → backend/src/cloud-persona.ts (OpenAI/Anthropic/fal.ai)
 *   - Compute   → backend/src/routes/personas.ts proxy 到 :8000 FastAPI
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { env } from "./lib/env.js";
import { authRoutes } from "./routes/auth.js";
import { tabletRoutes } from "./routes/tablets.js";
import { uploadRoutes } from "./routes/uploads.js";
import { jobRoutes } from "./routes/jobs.js";
import { personaRoutes } from "./routes/personas.js";
import { startTrainingWorker } from "./queue/training.js";

/**
 * 組裝 Fastify 應用實例,但不啟動監聽。
 *
 * 拆成 buildServer() / main() 兩個函式是為了讓單元測試可以
 * `await buildServer()` 後直接 inject 請求,不必真的 bind port。
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true, singleLine: false } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 32 * 1024 * 1024, // 32 MiB JSON cap; multipart handled separately.
  });

  await app.register(cors, {
    origin: env.FRONTEND_URL ?? true,
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_TTL_SECONDS },
  });

  await app.register(multipart, {
    limits: {
      fileSize: 1 * 1024 * 1024 * 1024, // 1 GiB per upload (relay)
      files: 1,
    },
  });

  // 健康檢查端點:給 docker compose / kubernetes 探測用,順便回傳鏈設定方便 debug
  app.get("/health", async () => ({
    ok: true,
    service: "@dsas/backend",
    chainId: env.CHAIN_ID,
    contract: env.CONTRACT_ADDRESS,
  }));

  // 各模組路由掛載:統一以 /api/<domain> 為前綴
  await app.register(authRoutes, { prefix: "/api/auth" });        // SIWE nonce + JWT 簽發
  await app.register(tabletRoutes, { prefix: "/api/tablets" });   // 塔位查詢 / sync / 家族樹
  await app.register(uploadRoutes, { prefix: "/api/uploads" });   // 檔案中繼上傳到 IPFS
  await app.register(jobRoutes, { prefix: "/api/jobs" });         // 訓練 job 排程與回報
  await app.register(personaRoutes, { prefix: "/api/personas" }); // 對話/語音/影像/短片

  return app;
}

/**
 * 進程入口:啟動 server + 訓練 worker,並註冊 SIGINT/SIGTERM 優雅關機。
 */
async function main(): Promise<void> {
  const app = await buildServer();
  startTrainingWorker();

  const close = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  try {
    await app.listen({ port: env.BACKEND_PORT, host: env.BACKEND_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Run when invoked directly (tsx / node dist/server.js), but not when imported by tests.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  /server\.(ts|js)$/.test(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  void main();
}
