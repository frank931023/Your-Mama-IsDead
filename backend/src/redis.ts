import IORedis, { type Redis } from "ioredis";
import { env } from "./lib/env.js";

declare global {
  // eslint-disable-next-line no-var
  var __dsasRedis: Redis | undefined;
}

function build(): Redis {
  // BullMQ requires maxRetriesPerRequest=null on the underlying connection.
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

export const redis: Redis = globalThis.__dsasRedis ?? build();

if (env.NODE_ENV !== "production") {
  globalThis.__dsasRedis = redis;
}
