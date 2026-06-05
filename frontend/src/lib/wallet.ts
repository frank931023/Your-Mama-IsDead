"use client";

/**
 * 錢包相關 React hooks 集中地
 *
 * 提供四個情境的 hook:
 *   1. useSiweLogin       SIWE 登入,簽名後拿 JWT 存 sessionStorage
 *   2. useMintTablet      鑄造塔位 NFT (mintRoot / safeMintWithParent)
 *   3. useSetArtifactURI  訓練完後寫入 artifact CID 到鏈上
 *   4. useDeriveEncryptionKey  EIP-712 簽名導出 AES-GCM 金鑰 (本地加密用)
 *
 * 還有一個 useIsCorrectChain helper 給 ChainGuard 元件用。
 */
import { useCallback, useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  useSignMessage,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import type { Address, Hex } from "viem";

import { CONTRACT_ADDRESS, DIGITAL_TABLET_ABI } from "./contract";
import { fetchAuthNonce, verifySiwe } from "./api";
import { ACTIVE_CHAIN_ID } from "./wagmi";

/**
 * 手工組 EIP-4361 SIWE 訊息字串。
 *
 * 不直接用 siwe 套件是因為它在 client.js 引用 ethers,但專案用的是
 * viem,沒裝 ethers,Next.js 打包會炸 "Module not found: ethers"。
 * 既然 SIWE 訊息格式是固定的 spec,自己組字串比裝 ~250KB 的 ethers
 * 划算。後端驗證仍由 siwe (Node 端) 處理。
 *
 * 規範: https://eips.ethereum.org/EIPS/eip-4361
 */
function buildSiweMessage(opts: {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  version?: string;
}): string {
  const lines = [
    `${opts.domain} wants you to sign in with your Ethereum account:`,
    opts.address,
    "",
    opts.statement,
    "",
    `URI: ${opts.uri}`,
    `Version: ${opts.version ?? "1"}`,
    `Chain ID: ${opts.chainId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt}`,
  ];
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario #1 — connect wallet (re-export from RainbowKit, see WalletConnect.tsx)
// ────────────────────────────────────────────────────────────────────────────

export { ConnectButton as ConnectWalletButton } from "@rainbow-me/rainbowkit";

// ────────────────────────────────────────────────────────────────────────────
// Scenario #2 — SIWE login
// ────────────────────────────────────────────────────────────────────────────

const TOKEN_KEY_PREFIX = "dsas:siwe-jwt";

interface SiweLoginState {
  login: () => Promise<string>;
  logout: () => void;
  isLoggingIn: boolean;
  token: string | null;
  error: Error | null;
}

function tokenKey(address: string | undefined, tokenId: string | number | undefined): string {
  return `${TOKEN_KEY_PREFIX}:${(address ?? "anon").toLowerCase()}:${tokenId ?? "global"}`;
}

function readToken(address: string | undefined, tokenId: string | number | undefined): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(tokenKey(address, tokenId));
  } catch {
    return null;
  }
}

function writeToken(
  address: string | undefined,
  tokenId: string | number | undefined,
  token: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    if (token === null) {
      window.sessionStorage.removeItem(tokenKey(address, tokenId));
    } else {
      window.sessionStorage.setItem(tokenKey(address, tokenId), token);
    }
  } catch {
    /* ignore */
  }
}

/**
 * SIWE 登入 hook。token 拿到後存 sessionStorage,key 含 address + tokenId,
 * 這樣換錢包或換塔位會各自獨立 token,不會混。
 *
 * @param tokenId 對哪個塔位驗證(讓 backend 可以做 owner check)
 */
export function useSiweLogin(tokenId?: string | number): SiweLoginState {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(() => readToken(address, tokenId));
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Re-hydrate when account or tokenId changes
  useEffect(() => {
    setToken(readToken(address, tokenId));
  }, [address, tokenId]);

  const login = useCallback(async (): Promise<string> => {
    if (!address) throw new Error("Wallet not connected");
    const cid = chainId ?? ACTIVE_CHAIN_ID;
    setIsLoggingIn(true);
    setError(null);
    try {
      const { nonce } = await fetchAuthNonce(address);
      const prepared = buildSiweMessage({
        domain: typeof window !== "undefined" ? window.location.host : "dsas.app",
        address,
        statement: "Sign in to DSAS (Digital Tablet)",
        uri: typeof window !== "undefined" ? window.location.origin : "https://dsas.app",
        version: "1",
        chainId: cid,
        nonce,
        issuedAt: new Date().toISOString(),
      });
      const signature = await signMessageAsync({ message: prepared });
      const tokenIdStr = tokenId !== undefined ? String(tokenId) : undefined;
      const { token: jwt } = await verifySiwe(prepared, signature, tokenIdStr);
      writeToken(address, tokenId, jwt);
      setToken(jwt);
      return jwt;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setIsLoggingIn(false);
    }
  }, [address, chainId, signMessageAsync, tokenId]);

  const logout = useCallback(() => {
    writeToken(address, tokenId, null);
    setToken(null);
  }, [address, tokenId]);

  return { login, logout, isLoggingIn, token, error };
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario #1 (cont.) — mint
// ────────────────────────────────────────────────────────────────────────────

export interface MintResult {
  hash: Hex;
}

/**
 * 鑄造塔位 hook。提供兩種:
 *   - mintRoot         鑄造新家族的根節點 (parent = 0)
 *   - mintWithParent   在既有家族下鑄造子節點,需要父節點的 owner 簽署
 */
export function useMintTablet(): {
  mintRoot: (to: Address, metadataUri: string) => Promise<MintResult>;
  mintWithParent: (to: Address, parentId: bigint, metadataUri: string) => Promise<MintResult>;
  isPending: boolean;
  error: Error | null;
} {
  const { writeContractAsync, isPending, error } = useWriteContract();

  const mintRoot = useCallback(
    async (to: Address, metadataUri: string): Promise<MintResult> => {
      const hash = await writeContractAsync({
        abi: DIGITAL_TABLET_ABI,
        address: CONTRACT_ADDRESS,
        functionName: "mintRoot",
        args: [to, metadataUri],
      });
      return { hash };
    },
    [writeContractAsync],
  );

  const mintWithParent = useCallback(
    async (to: Address, parentId: bigint, metadataUri: string): Promise<MintResult> => {
      const hash = await writeContractAsync({
        abi: DIGITAL_TABLET_ABI,
        address: CONTRACT_ADDRESS,
        functionName: "safeMintWithParent",
        args: [to, parentId, metadataUri],
      });
      return { hash };
    },
    [writeContractAsync],
  );

  return { mintRoot, mintWithParent, isPending, error: (error as Error | null) ?? null };
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario #3 — set artifact URI
// ────────────────────────────────────────────────────────────────────────────

export function useSetArtifactURI(tokenId: bigint | string | number): {
  setArtifactURI: (uri: string) => Promise<Hex>;
  isPending: boolean;
  error: Error | null;
} {
  const { writeContractAsync, isPending, error } = useWriteContract();

  const setArtifactURI = useCallback(
    async (uri: string): Promise<Hex> => {
      return writeContractAsync({
        abi: DIGITAL_TABLET_ABI,
        address: CONTRACT_ADDRESS,
        functionName: "setArtifactURI",
        args: [BigInt(tokenId), uri],
      });
    },
    [writeContractAsync, tokenId],
  );

  return { setArtifactURI, isPending, error: (error as Error | null) ?? null };
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario #3b — update tokenURI (補傳:重組 metadata → pin IPFS → 上鏈更新)
// 合約 setTokenURI(tokenId, uri) 允許 owner 或 MINTER 更新基礎 metadata URI。
// 用於鑄造後補傳生平/照片/影音/子孫/對話紀錄/克隆聲音 label。
// ────────────────────────────────────────────────────────────────────────────

export function useSetTokenURI(tokenId: bigint | string | number): {
  setTokenURI: (uri: string) => Promise<Hex>;
  isPending: boolean;
  error: Error | null;
} {
  const { writeContractAsync, isPending, error } = useWriteContract();

  const setTokenURI = useCallback(
    async (uri: string): Promise<Hex> => {
      return writeContractAsync({
        abi: DIGITAL_TABLET_ABI,
        address: CONTRACT_ADDRESS,
        functionName: "setTokenURI",
        args: [BigInt(tokenId), uri],
      });
    },
    [writeContractAsync, tokenId],
  );

  return { setTokenURI, isPending, error: (error as Error | null) ?? null };
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario #4 — derive E2E encryption key (EIP-712 → HKDF)
// ────────────────────────────────────────────────────────────────────────────

const KEY_DOMAIN = {
  name: "DSAS Encryption Key Derivation",
  version: "1",
} as const;

const KEY_TYPES = {
  Derivation: [
    { name: "purpose", type: "string" },
    { name: "tokenId", type: "uint256" },
    { name: "context", type: "string" },
  ],
} as const;

/**
 * 從錢包簽名導出 256-bit AES-GCM 對稱金鑰。
 *
 * 流程:EIP-712 typed data → 錢包簽名 → 簽名當 IKM → HKDF-SHA256 → AES-GCM key
 *
 * 用途:本地素材加密 (家屬不希望某些對話/影音放公開 IPFS 也能讀)。
 * 私鑰永遠不離開錢包,所以這個對稱金鑰也是衍生而來、不會落地。
 *
 * 注意:同一錢包 + 同 tokenId + 同 context 會推出同一把金鑰 (deterministic)。
 */
export function useDeriveEncryptionKey(): {
  deriveKey: (tokenId: bigint | string | number, context?: string) => Promise<CryptoKey>;
  isDeriving: boolean;
  error: Error | null;
} {
  const { signTypedDataAsync } = useSignTypedData();
  const [isDeriving, setIsDeriving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const deriveKey = useCallback(
    async (tokenId: bigint | string | number, context = "default"): Promise<CryptoKey> => {
      setIsDeriving(true);
      setError(null);
      try {
        const signature = await signTypedDataAsync({
          domain: KEY_DOMAIN,
          types: KEY_TYPES,
          primaryType: "Derivation",
          message: {
            purpose: "asset-encryption",
            tokenId: BigInt(tokenId),
            context,
          },
        });
        const ikm = hexToBytes(signature);
        return await hkdfAesKey(ikm, context, BigInt(tokenId));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsDeriving(false);
      }
    },
    [signTypedDataAsync],
  );

  return { deriveKey, isDeriving, error };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function hkdfAesKey(ikm: Uint8Array, context: string, tokenId: bigint): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SubtleCrypto unavailable");
  // TS 5.7+ tightened Uint8Array generic args; SubtleCrypto wants BufferSource.
  const baseKey = await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveKey"]);
  const info = new TextEncoder().encode(`dsas:${tokenId.toString()}:${context}`) as BufferSource;
  const salt = new TextEncoder().encode("dsas-hkdf-salt-v1") as BufferSource;
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", info, salt },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: chain match
// ────────────────────────────────────────────────────────────────────────────

export function useIsCorrectChain(): { isCorrect: boolean; expected: number; current: number | undefined } {
  const current = useChainId();
  return { isCorrect: current === ACTIVE_CHAIN_ID, expected: ACTIVE_CHAIN_ID, current };
}
