/**
 * Runtime 可切換的雙模式設定(由 /admin 頁控制)
 *
 * 兩個開關存 Redis,跨重啟持久:
 *   dsas:mode:storage = "pinata" | "local"  上傳釘 Pinata 還是存本地磁碟
 *   dsas:mode:chain   = "real"   | "local"  鏈上互動打真測試網還是本地 anvil
 *
 * 預設值由 env 推導:沒填 PINATA_JWT → storage local;
 * CHAIN_ID=31337 → chain local。讀取帶 2 秒 in-process cache,
 * 避免每個請求都打一次 Redis。
 *
 * 鏈設定檔(profile):
 *   real  → env.CHAIN_ID / env.RPC_URL / env.CONTRACT_ADDRESS(沿用既有欄位)
 *   local → env.LOCAL_CHAIN_ID / env.LOCAL_RPC_URL / env.LOCAL_CONTRACT_ADDRESS
 */
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type PublicClient,
} from "viem";
import { baseSepolia, mainnet, sepolia } from "viem/chains";
import { env } from "./env.js";
import { redis } from "../redis.js";

export type StorageMode = "pinata" | "local";
export type ChainMode = "real" | "local";

const STORAGE_MODE_KEY = "dsas:mode:storage";
const CHAIN_MODE_KEY = "dsas:mode:chain";
const CACHE_TTL_MS = 2_000;

interface ChainProfile {
  chainId: number;
  rpcUrl: string;
  contractAddress: Address;
}

export interface ChainContext extends ChainProfile {
  mode: ChainMode;
  publicClient: PublicClient;
}

function defaultStorageMode(): StorageMode {
  return env.PINATA_JWT ? "pinata" : "local";
}

function defaultChainMode(): ChainMode {
  return env.CHAIN_ID === env.LOCAL_CHAIN_ID ? "local" : "real";
}

function chainProfile(mode: ChainMode): ChainProfile {
  return mode === "local"
    ? {
        chainId: env.LOCAL_CHAIN_ID,
        rpcUrl: env.LOCAL_RPC_URL,
        contractAddress: env.LOCAL_CONTRACT_ADDRESS as Address,
      }
    : {
        chainId: env.CHAIN_ID,
        rpcUrl: env.RPC_URL,
        contractAddress: env.CONTRACT_ADDRESS as Address,
      };
}

/** env.CHAIN_ID 對應 viem Chain;未知 id(anvil)即時定義。 */
function resolveChain(chainId: number, rpcUrl: string): Chain {
  switch (chainId) {
    case mainnet.id:
      return mainnet;
    case sepolia.id:
      return sepolia;
    case baseSepolia.id:
      return baseSepolia;
    default:
      return defineChain({
        id: chainId,
        name: `chain-${chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });
  }
}

// ── Redis 開關讀寫(帶短 cache)──────────────────────────────────────────

let storageCache: { value: StorageMode; at: number } | null = null;
let chainCache: { value: ChainMode; at: number } | null = null;

export async function getStorageMode(): Promise<StorageMode> {
  if (storageCache && Date.now() - storageCache.at < CACHE_TTL_MS) return storageCache.value;
  const raw = await redis.get(STORAGE_MODE_KEY);
  const value: StorageMode = raw === "pinata" || raw === "local" ? raw : defaultStorageMode();
  storageCache = { value, at: Date.now() };
  return value;
}

export async function setStorageMode(mode: StorageMode): Promise<void> {
  await redis.set(STORAGE_MODE_KEY, mode);
  storageCache = { value: mode, at: Date.now() };
}

export async function getChainMode(): Promise<ChainMode> {
  if (chainCache && Date.now() - chainCache.at < CACHE_TTL_MS) return chainCache.value;
  const raw = await redis.get(CHAIN_MODE_KEY);
  const value: ChainMode = raw === "real" || raw === "local" ? raw : defaultChainMode();
  chainCache = { value, at: Date.now() };
  return value;
}

export async function setChainMode(mode: ChainMode): Promise<void> {
  await redis.set(CHAIN_MODE_KEY, mode);
  chainCache = { value: mode, at: Date.now() };
}

// ── 鏈 context(viem client 依 mode 各 cache 一份)────────────────────────

const clientCache = new Map<ChainMode, PublicClient>();

export async function getChainContext(): Promise<ChainContext> {
  const mode = await getChainMode();
  const profile = chainProfile(mode);
  let publicClient = clientCache.get(mode);
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: resolveChain(profile.chainId, profile.rpcUrl),
      transport: http(profile.rpcUrl),
    });
    clientCache.set(mode, publicClient);
  }
  return { mode, ...profile, publicClient };
}

/** 前端(不需 admin 權限)看的公開設定:目前模式 + 該打哪個合約。 */
export async function getPublicConfig(): Promise<{
  chainMode: ChainMode;
  chainId: number;
  contractAddress: Address;
  storageMode: StorageMode;
}> {
  const [chainMode, storageMode] = await Promise.all([getChainMode(), getStorageMode()]);
  const profile = chainProfile(chainMode);
  return {
    chainMode,
    chainId: profile.chainId,
    contractAddress: profile.contractAddress,
    storageMode,
  };
}
