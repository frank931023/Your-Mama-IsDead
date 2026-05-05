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
 * Minimal ABI fragments for DigitalTablet (ERC-721 + ERC-6150 + DSAS).
 * Only the read methods used by the backend are listed.
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

function resolveChain(chainId: number): Chain {
  switch (chainId) {
    case mainnet.id:
      return mainnet;
    case sepolia.id:
      return sepolia;
    case baseSepolia.id:
      return baseSepolia;
    default:
      // Define an ad-hoc chain when an unknown id is supplied (e.g. local anvil).
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

export async function getOwnerOf(tokenId: bigint): Promise<`0x${string}`> {
  const owner = (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  })) as `0x${string}`;
  return owner;
}

export async function getTokenURI(tokenId: bigint): Promise<string> {
  return (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "tokenURI",
    args: [tokenId],
  })) as string;
}

export async function getArtifactURI(tokenId: bigint): Promise<string> {
  return (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "artifactURI",
    args: [tokenId],
  })) as string;
}

export async function getParentOf(tokenId: bigint): Promise<bigint> {
  return (await publicClient.readContract({
    address: CONTRACT,
    abi: DIGITAL_TABLET_ABI,
    functionName: "parentOf",
    args: [tokenId],
  })) as bigint;
}

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
