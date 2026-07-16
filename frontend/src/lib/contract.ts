"use client";

/**
 * DigitalTablet 合約 ABI 與位址常數
 *
 * 這份 ABI 是給 frontend 的(包含 mint / setArtifactURI 等寫入方法)。
 * Backend 那邊有自己的最小化讀取 ABI 在 backend/src/chain.ts。
 *
 * NEXT_PUBLIC_CONTRACT_ADDRESS 部署完合約後要記得更新 .env,
 * 不然這裡會 throw "CONTRACT_ADDRESS not configured"。
 */
import {
  useReadContract,
  useWriteContract,
  type UseWriteContractParameters,
} from "wagmi";
import type { Abi, Address } from "viem";

import { FALLBACK_CONFIG, useContractAddress } from "./app-config";

// 靜態 fallback(backend /api/config 不可達時用);runtime 生效地址
// 請一律透過 useContractAddress() 取得,admin 切鏈後會自動跟上。
export const CONTRACT_ADDRESS: Address = FALLBACK_CONFIG.contractAddress;

/**
 * Minimal DigitalTablet ABI (ERC-721 + ERC-6150 subset + DSAS extras).
 * Mirrors `contracts/src/DigitalTablet.sol`.
 */
export const DIGITAL_TABLET_ABI = [
  {
    type: "function",
    name: "mintRoot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenURI_", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "safeMintWithParent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "parentId", type: "uint256" },
      { name: "tokenURI_", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setArtifactURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "uri", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setTokenURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "uri", type: "string" },
    ],
    outputs: [],
  },
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
  {
    type: "function",
    name: "isRoot",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isLeaf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
    anonymous: false,
  },
] as const satisfies Abi;

export type DigitalTabletReadFn =
  | "ownerOf"
  | "tokenURI"
  | "artifactURI"
  | "parentOf"
  | "childrenOf"
  | "isRoot"
  | "isLeaf";

export type DigitalTabletWriteFn =
  | "mintRoot"
  | "safeMintWithParent"
  | "setArtifactURI"
  | "setTokenURI";

interface ReadOpts {
  functionName: DigitalTabletReadFn;
  args?: readonly unknown[];
  /** Pass `{ enabled: false }` etc. through to React Query. */
  query?: { enabled?: boolean; staleTime?: number; refetchInterval?: number };
}

/** Thin typed wrapper around wagmi's `useReadContract` for our ABI. */
export function useDigitalTabletRead(opts: ReadOpts) {
  const address = useContractAddress();
  // Cast through `unknown` so we can keep the helper generic across all read
  // function signatures without spelling out per-fn overloads. wagmi's stricter
  // tuple types are validated by the ABI at runtime call site.
  return useReadContract({
    abi: DIGITAL_TABLET_ABI,
    address,
    functionName: opts.functionName,
    args: opts.args as unknown as never,
    query: opts.query,
  });
}

/** Thin typed wrapper around wagmi's `useWriteContract`. */
export function useDigitalTabletWrite(opts?: UseWriteContractParameters) {
  return useWriteContract(opts);
}
