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

  app.get("/health", async () => ({
    ok: true,
    service: "@dsas/backend",
    chainId: env.CHAIN_ID,
    contract: env.CONTRACT_ADDRESS,
  }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(tabletRoutes, { prefix: "/api/tablets" });
  await app.register(uploadRoutes, { prefix: "/api/uploads" });
  await app.register(jobRoutes, { prefix: "/api/jobs" });
  await app.register(personaRoutes, { prefix: "/api/personas" });

  return app;
}

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
