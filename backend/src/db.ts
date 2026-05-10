/**
 * Prisma Client Singleton
 *
 * dev 模式下 tsx watch 會頻繁 reload,如果每次 reload 都建立新 PrismaClient
 * 會耗盡 Postgres 連線池。把 client 存在 globalThis 上重用可避免此問題。
 * production 走正常單一 process,不需要這個 hack。
 */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __dsasPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__dsasPrisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__dsasPrisma = prisma;
}
