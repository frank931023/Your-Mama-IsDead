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
