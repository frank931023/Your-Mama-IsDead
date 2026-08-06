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
import { simliRoutes } from "./routes/simli.js";
import { avatarRoutes, avatarSessionRoutes } from "./routes/avatar.js";
import { attachAvatarWsProxy } from "./lib/ws-proxy.js";
import { attachCeremonyHub } from "./lib/ceremony-hub.js";
import { tributeRoutes } from "./routes/tributes.js";
import { storyRoutes } from "./routes/stories.js";
import { adminRoutes } from "./routes/admin.js";
import { getPublicConfig } from "./lib/runtime-config.js";
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
    ...(await getPublicConfig()),
  }));

  // 公開 runtime 設定:前端據此決定打哪條鏈/哪個合約(admin 切換即時生效)
  app.get("/api/config", async () => getPublicConfig());

  // 各模組路由掛載:統一以 /api/<domain> 為前綴
  await app.register(authRoutes, { prefix: "/api/auth" });        // SIWE nonce + JWT 簽發
  await app.register(tabletRoutes, { prefix: "/api/tablets" });   // 塔位查詢 / sync / 家族樹
  await app.register(uploadRoutes, { prefix: "/api/uploads" });   // 檔案中繼上傳到 IPFS
  await app.register(jobRoutes, { prefix: "/api/jobs" });         // 訓練 job 排程與回報
  await app.register(personaRoutes, { prefix: "/api/personas" }); // 對話/語音/影像/短片
  await app.register(simliRoutes, { prefix: "/api/simli" });      // (舊) Simli 雲端生成專屬 avatar 臉
  await app.register(avatarRoutes, { prefix: "/api/avatar" });    // (新) 自建 LAM 渲染機:上傳照片/音頻建 3DGS avatar/克隆聲音
  await app.register(avatarSessionRoutes, { prefix: "/api/personas" }); // (新) /:tokenId/avatar-session 簽 WS token
  await app.register(tributeRoutes, { prefix: "/api/tributes" }); // 線上靈堂留言板
  await app.register(storyRoutes, { prefix: "/api/stories" });    // 哀悼版回憶 (story)
  await app.register(adminRoutes, { prefix: "/api/admin" });      // 單密碼 admin:模式切換 / anvil 餵 gas

  return app;
}

/**
 * 進程入口:啟動 server + 訓練 worker,並註冊 SIGINT/SIGTERM 優雅關機。
 */
async function main(): Promise<void> {
  const app = await buildServer();
  startTrainingWorker();

  // ── Process 層保命網 ─────────────────────────────────────────────────────
  // 任何漏網的同步例外 / 未處理的 promise rejection,都大聲記 log 而不是讓整個
  // backend 無聲死掉 (曾發生:ws 對端異常斷線把非法 close code 丟進 ws.close()
  // 直接炸掉 process → 前端全面 Failed to fetch)。個別壞掉的請求/連線就讓它壞,
  // 服務本體要活著。
  process.on("uncaughtException", (err) => {
    app.log.error({ err }, "[FATAL-caught] uncaughtException — server kept alive");
  });
  process.on("unhandledRejection", (reason) => {
    app.log.error({ reason }, "[FATAL-caught] unhandledRejection — server kept alive");
  });

  const close = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  // 把 avatar WebSocket 代理掛到底層 http server (浏览器连同源 localhost,绕开
  // Chrome PNA 对私有 IP WS 的拦截;后端在 tailnet 转发到渲染机)。
  attachAvatarWsProxy(app.server, app.log);
  attachCeremonyHub(app.server, app.log);

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
