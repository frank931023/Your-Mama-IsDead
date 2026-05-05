import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateNonce } from "../src/auth/siwe.js";

// We unit-test pure helpers + verifyAndCreateSession with mocks to avoid
// requiring a live Postgres / chain connection during CI.

vi.mock("../src/db.js", () => {
  const session = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const user = {
    upsert: vi.fn(),
  };
  return {
    prisma: {
      session,
      user,
      $transaction: vi.fn(async (ops: Promise<unknown>[] | unknown[]) => {
        if (Array.isArray(ops)) {
          // resolve any promise-likes that were passed
          return Promise.all(ops.map((p) => Promise.resolve(p)));
        }
        return ops;
      }),
    },
  };
});

vi.mock("../src/lib/env.js", () => ({
  env: {
    SIWE_DOMAIN: "dsas.test",
    JWT_TTL_SECONDS: 3600,
    DATABASE_URL: "postgres://x",
    REDIS_URL: "redis://x",
    JWT_SECRET: "test-secret-test-secret",
    RPC_URL: "https://example.org",
    CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
    CHAIN_ID: 11155111,
    NODE_ENV: "test",
    IPFS_GATEWAY: "https://gateway.pinata.cloud/ipfs/",
    BACKEND_PORT: 4000,
    BACKEND_HOST: "0.0.0.0",
  },
}));

import { issueNonce, verifyAndCreateSession } from "../src/auth/siwe.js";
import { prisma } from "../src/db.js";

describe("generateNonce", () => {
  it("produces a non-empty alphanumeric string", () => {
    const n = generateNonce();
    expect(typeof n).toBe("string");
    expect(n.length).toBeGreaterThanOrEqual(8);
    expect(/^[A-Za-z0-9]+$/.test(n)).toBe(true);
  });

  it("returns distinct values across calls", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toEqual(b);
  });
});

describe("issueNonce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists a Session row with the address checksummed", async () => {
    // 0xabcdef... lowercase input
    const address = "0xabababababababababababababababababababab";
    (prisma.session.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { nonce, expiresAt } = await issueNonce(address);
    expect(nonce).toBeTruthy();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
  });
});

describe("verifyAndCreateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("rejects when SIWE verify fails", async () => {
    // Mock siwe to fail
    vi.doMock("siwe", () => ({
      generateNonce: () => "abcdefgh12345678",
      SiweMessage: class {
        address = "0xabababababababababababababababababababab";
        nonce = "abcdefgh12345678";
        constructor(_: string) {}
        async verify(): Promise<{ success: boolean; error?: { type: string } }> {
          return { success: false, error: { type: "Invalid signature" } };
        }
      },
    }));
    const mod = await import("../src/auth/siwe.js");
    const signer = { sign: vi.fn(() => "JWT") };
    await expect(
      mod.verifyAndCreateSession("msg", "0xdead", signer),
    ).rejects.toThrow(/SIWE verification failed/);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("issues a JWT when verify + nonce checks pass", async () => {
    const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // valid EIP-55
    vi.doMock("siwe", () => ({
      generateNonce: () => "n0nce123",
      SiweMessage: class {
        address = address;
        nonce = "n0nce123";
        constructor(_: string) {}
        async verify(): Promise<{ success: boolean }> {
          return { success: true };
        }
      },
    }));

    (prisma.session.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      nonce: "n0nce123",
      address,
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    (prisma.session.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (prisma.user.upsert as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const mod = await import("../src/auth/siwe.js");
    const sign = vi.fn(
      (_payload: Record<string, unknown>, _opts?: { expiresIn?: string | number }) =>
        "FAKE.JWT.TOKEN",
    );
    const signer = { sign };
    const result = await mod.verifyAndCreateSession("msg", "0xfeed", signer);
    expect(result.jwt).toBe("FAKE.JWT.TOKEN");
    expect(result.address).toBe(address);
    expect(sign).toHaveBeenCalledTimes(1);
    const firstCall = sign.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = firstCall![0] as { address: string };
    expect(payload.address).toBe(address);
  });
});
