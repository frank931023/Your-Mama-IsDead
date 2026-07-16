/**
 * 鏈上互動層
 *
 * 封裝後端對 DigitalTablet 合約的所有唯讀呼叫。寫入 (mint / setArtifactURI)
 * 一律由前端錢包簽署,後端不持有任何能寫鏈的私鑰(除了訓練 worker 的
 * setArtifactURI,那個獨立另外處理)。
 *
 * 使用 viem 的 PublicClient;RPC/合約地址由 runtime chain mode 決定
 * (real=Sepolia、local=anvil,經 /admin 頁切換,見 lib/runtime-config.ts)。
 */
import { getChainContext } from "./lib/runtime-config.js";

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

/**
 * 依 runtime chain mode(real/local anvil,admin 頁可切)動態取用
 * viem client 與合約地址。client 在 runtime-config 內按 mode cache。
 */
async function readTablet<T>(functionName: string, args: readonly unknown[]): Promise<T> {
  const { publicClient, contractAddress } = await getChainContext();
  return (await publicClient.readContract({
    address: contractAddress,
    abi: DIGITAL_TABLET_ABI,
    functionName: functionName as never,
    args: args as never,
  })) as T;
}

/** 查詢某個 tokenId 目前的擁有者地址。Token 不存在會 throw。 */
export async function getOwnerOf(tokenId: bigint): Promise<`0x${string}`> {
  return readTablet<`0x${string}`>("ownerOf", [tokenId]);
}

/** 取得塔位的 ERC-721 metadata URI(通常是 ipfs://Qm...)。 */
export async function getTokenURI(tokenId: bigint): Promise<string> {
  return readTablet<string>("tokenURI", [tokenId]);
}

/** 取得訓練後的 artifact URI (LoRA + voice + RAG manifest)。未訓練則為空字串。 */
export async function getArtifactURI(tokenId: bigint): Promise<string> {
  return readTablet<string>("artifactURI", [tokenId]);
}

/** ERC-6150:取父節點 tokenId。回 0 代表是家族根節點。 */
export async function getParentOf(tokenId: bigint): Promise<bigint> {
  return readTablet<bigint>("parentOf", [tokenId]);
}

/** ERC-6150:取所有子節點 tokenId。回空陣列代表是葉節點。 */
export async function getChildrenOf(tokenId: bigint): Promise<bigint[]> {
  const result = await readTablet<readonly bigint[]>("childrenOf", [tokenId]);
  return [...result];
}
