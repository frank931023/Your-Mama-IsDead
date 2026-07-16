/**
 * Admin API — 單密碼登入 + 測試模式切換
 *
 * 驗證模型:
 *   POST /api/admin/login { password } → 與 env.ADMIN_PASSWORD 比對
 *   (timing-safe),成功簽一顆 12h 的 JWT({ role: "admin" })。其後的
 *   admin 端點都用 requireAdmin 驗 Bearer token 的 role claim —
 *   SIWE 會話簽的 JWT 沒有 role,拿來打 admin API 會被擋。
 *
 * 可切換的東西(存 Redis,見 lib/runtime-config.ts):
 *   storageMode: pinata | local   上傳釘 IPFS 還是存本地磁碟
 *   chainMode:   real   | local   打 Sepolia 還是本地 anvil
 *
 * 另附 POST /fund:chain mode = local 時,用 anvil 的作弊 RPC
 * (anvil_setBalance)直接給任意地址餵 ETH,免 faucet。
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import axios from "axios";
import { parseEther, numberToHex } from "viem";
import { env } from "../lib/env.js";
import {
  getChainContext,
  getChainMode,
  getPublicConfig,
  getStorageMode,
  setChainMode,
  setStorageMode,
} from "../lib/runtime-config.js";

const LoginBody = z.object({ password: z.string().min(1).max(256) });

const ConfigBody = z.object({
  storageMode: z.enum(["pinata", "local"]).optional(),
  chainMode: z.enum(["real", "local"]).optional(),
});

const FundBody = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  eth: z.coerce.number().positive().max(10_000).default(100),
});

function passwordMatches(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  // timingSafeEqual 要求等長;長度不同時比對一份自己(耗時一致)後回 false
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const payload = request.user as { role?: string };
  if (payload.role !== "admin") {
    return reply.code(403).send({ error: "forbidden" });
  }
}

/** 探測一個 JSON-RPC endpoint 是否活著(1.5s 逾時),給 admin UI 顯示狀態燈。 */
async function probeRpc(rpcUrl: string): Promise<boolean> {
  try {
    const res = await axios.post(
      rpcUrl,
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { timeout: 1_500 },
    );
    return typeof res.data?.result === "string";
  } catch {
    return false;
  }
}

export const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post("/login", async (request, reply) => {
    if (!env.ADMIN_PASSWORD) {
      return reply.code(503).send({ error: "admin_disabled", hint: "set ADMIN_PASSWORD in .env" });
    }
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    if (!passwordMatches(parsed.data.password, env.ADMIN_PASSWORD)) {
      return reply.code(401).send({ error: "wrong_password" });
    }
    const token = await reply.jwtSign({ role: "admin" }, { expiresIn: "12h" });
    return reply.send({ token });
  });

  app.get("/config", { preHandler: requireAdmin }, async (_request, reply) => {
    const [storageMode, chainMode] = await Promise.all([getStorageMode(), getChainMode()]);
    const [realOk, localOk] = await Promise.all([probeRpc(env.RPC_URL), probeRpc(env.LOCAL_RPC_URL)]);
    return reply.send({
      storageMode,
      chainMode,
      pinataConfigured: Boolean(env.PINATA_JWT),
      chains: {
        real: {
          chainId: env.CHAIN_ID,
          rpcUrl: env.RPC_URL,
          contractAddress: env.CONTRACT_ADDRESS,
          rpcOk: realOk,
        },
        local: {
          chainId: env.LOCAL_CHAIN_ID,
          rpcUrl: env.LOCAL_RPC_URL,
          contractAddress: env.LOCAL_CONTRACT_ADDRESS,
          rpcOk: localOk,
        },
      },
    });
  });

  app.put("/config", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ConfigBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    if (parsed.data.storageMode) await setStorageMode(parsed.data.storageMode);
    if (parsed.data.chainMode) await setChainMode(parsed.data.chainMode);
    return reply.send(await getPublicConfig());
  });

  app.post("/fund", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = FundBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { mode } = await getChainContext();
    if (mode !== "local") {
      return reply.code(409).send({ error: "not_local_chain", hint: "先把 chainMode 切到 local" });
    }
    const wei = parseEther(String(parsed.data.eth));
    try {
      await axios.post(
        env.LOCAL_RPC_URL,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "anvil_setBalance",
          params: [parsed.data.address, numberToHex(wei)],
        },
        { timeout: 3_000 },
      );
      return reply.send({ ok: true, address: parsed.data.address, eth: parsed.data.eth });
    } catch (err) {
      request.log.error({ err }, "anvil_setBalance failed");
      return reply.code(502).send({ error: "anvil_unreachable" });
    }
  });
};
