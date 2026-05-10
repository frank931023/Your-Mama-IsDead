/**
 * 鏈上互動層
 *
 * 封裝後端對 DigitalTablet 合約的所有唯讀呼叫。寫入 (mint / setArtifactURI)
 * 一律由前端錢包簽署,後端不持有任何能寫鏈的私鑰(除了訓練 worker 的
 * setArtifactURI,那個獨立另外處理)。
 *
 * 使用 viem 的 PublicClient,RPC 由 env.RPC_URL 指定(預設 Sepolia)。
 */
import {
  createPublicClient,
  http,
  defineChain,
  type Address,
  type PublicClient,
  type Chain,
} from "viem";
import { mainnet, sepolia, baseSepolia } from "viem/chains";
import { env } from "./lib/env.js";

/**
 * DigitalTablet 合約最小 ABI 片段 (ERC-721 + ERC-6150 + DSAS)。
 * 只列出後端會呼叫的唯讀方法,寫入相關的留給 frontend/lib/contract.ts。
 */
export const DIGITAL_TABLET_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "artifactURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "parentOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "childrenOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
] as const;

const CONTRACT: Address = env.CONTRACT_ADDRESS as Address;

/**
 * 把 env.CHAIN_ID 對應到 viem 的 Chain 設定物件。
 * 已知鏈用內建定義,未知鏈 (例如本地 anvil) 即時用 RPC_URL 組一個。
 */
function resolveChain(chainId: number): Chain {
  switch (chainId) {
    case mainnet.id:
      return mainnet;
    case sepolia.id:
      return sepolia;
    case baseSepolia.id:
      return baseSepolia;
    default:
      // 未知 chainId(例如本地 anvil)即時定義一個 chain
      return defineChain({
        id: chainId,
        name: `chain-${chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [env.RPC_URL] } },
      });
  }
}

export const publicClient: PublicClient = createPublicClient({
  chain: resolveChain(env.CHAIN_ID),
  transport: http(env.RPC_URL),
});

/** 查詢某個 tokenId 目前的擁有者地址。Token 不存在會 throw。 */
export async function getOwnerOf(tokenId: bigint): Promise<`0x${string}`> {
  const owner = (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  })) as `0x${string}`;
  return owner;
}

/** 取得塔位的 ERC-721 metadata URI(通常是 ipfs://Qm...)。 */
export async function getTokenURI(tokenId: bigint): Promise<string> {
  return (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "tokenURI",
    args: [tokenId],
  })) as string;
}

/** 取得訓練後的 artifact URI (LoRA + voice + RAG manifest)。未訓練則為空字串。 */
export async function getArtifactURI(tokenId: bigint): Promise<string> {
  return (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "artifactURI",
    args: [tokenId],
  })) as string;
}

/** ERC-6150:取父節點 tokenId。回 0 代表是家族根節點。 */
export async function getParentOf(tokenId: bigint): Promise<bigint> {
  return (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "parentOf",
    args: [tokenId],
  })) as bigint;
}

/** ERC-6150:取所有子節點 tokenId。回空陣列代表是葉節點。 */
export async function getChildrenOf(tokenId: bigint): Promise<bigint[]> {
  const result = (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "childrenOf",
    args: [tokenId],
  })) as readonly bigint[];
  return [...result];
}

export const CONTRACT_ADDRESS: Address = CONTRACT;
