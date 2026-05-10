/**
 * Sign-In With Ethereum (SIWE / EIP-4361) 驗證流程
 *
 * 流程概覽:
 *   1. 前端打 GET /api/auth/nonce?address=0x... → 後端產生 nonce 寫進 DB
 *   2. 前端用 nonce 組 SIWE message,請使用者在錢包簽名
 *   3. 前端打 POST /api/auth/verify { message, signature }
 *   4. 後端驗證簽名 + 比對 nonce 為一次性 + 簽發 JWT
 *
 * 安全要點:
 *   - nonce 必須一次性 (used 欄位 + transaction)
 *   - nonce TTL = 10 分鐘
 *   - JWT 內 claim 只放 address,後續 owner 檢查再從鏈上查
 */
import { randomBytes } from "node:crypto";
import { SiweMessage, generateNonce as siweGenerateNonce } from "siwe";
import { getAddress } from "viem";
import { prisma } from "../db.js";
import { env } from "../lib/env.js";

const NONCE_TTL_MS = 10 * 60 * 1000; // nonce 有效期 10 分鐘

/**
 * 產生符合 SIWE 規範的 nonce(英數字、至少 8 字元)。
 * 優先用 siwe 套件的 helper,失敗則 fallback 到 16 byte hex。
 */
export function generateNonce(): string {
  // Prefer the package's helper, fall back to a 16-byte hex token.
  try {
    return siweGenerateNonce();
  } catch {
    return randomBytes(8).toString("hex");
  }
}

export interface IssuedNonce {
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Persist a freshly issued nonce so we can verify single-use later. */
export async function issueNonce(address: string): Promise<IssuedNonce> {
  const checksummed = getAddress(address);
  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
  await prisma.session.create({
    data: { nonce, address: checksummed, expiresAt, used: false, issuedAt },
  });
  return { nonce, issuedAt, expiresAt };
}

export interface SignerForJwt {
  sign(payload: Record<string, unknown>, opts?: { expiresIn?: string | number }): string;
}

export interface VerifyResult {
  address: string;
  jwt: string;
  expiresIn: number;
}

/**
 * Verify a SIWE message + signature, ensure the nonce was issued by us and
 * has not been redeemed, mark it used, and return a freshly minted JWT.
 *
 * `signer` is injected so unit tests can stub fastify-jwt without booting a
 * full Fastify instance.
 */
export async function verifyAndCreateSession(
  message: string,
  signature: `0x${string}`,
  signer: SignerForJwt,
): Promise<VerifyResult> {
  const siwe = new SiweMessage(message);

  // 1. Cryptographic + structural validation (siwe v2 returns { data, success }).
  const verification = await siwe.verify({
    signature,
    domain: env.SIWE_DOMAIN,
  });
  if (!verification.success) {
    throw new Error(
      `SIWE verification failed: ${verification.error?.type ?? "unknown error"}`,
    );
  }

  // 2. Nonce must be one we issued, unused, unexpired, and bound to this address.
  const session = await prisma.session.findUnique({ where: { nonce: siwe.nonce } });
  if (!session) throw new Error("Unknown nonce");
  if (session.used) throw new Error("Nonce already used");
  if (session.expiresAt.getTime() < Date.now()) throw new Error("Nonce expired");

  const address = getAddress(siwe.address);
  if (getAddress(session.address) !== address) {
    throw new Error("Nonce/address mismatch");
  }

  // 3. Burn the nonce + upsert the user atomically.
  await prisma.$transaction([
    prisma.session.update({ where: { nonce: siwe.nonce }, data: { used: true } }),
    prisma.user.upsert({
      where: { address },
      update: { lastSeen: new Date() },
      create: { address },
    }),
  ]);

  // 4. Mint JWT with `address` claim.
  const expiresIn = env.JWT_TTL_SECONDS;
  const jwt = signer.sign({ address }, { expiresIn });

  return { address, jwt, expiresIn };
}

/** Shape of the JWT payload we issue. */
export interface DsasJwtPayload {
  address: string;
  iat: number;
  exp: number;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { address: string };
    user: DsasJwtPayload;
  }
}
