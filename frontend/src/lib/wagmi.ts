"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, sepolia } from "wagmi/chains";
import type { Chain } from "viem";

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");

export const SUPPORTED_CHAINS = [sepolia, baseSepolia] as const satisfies readonly Chain[];

export function getDefaultChain(): Chain {
  const found = SUPPORTED_CHAINS.find((c) => c.id === CHAIN_ID);
  return found ?? sepolia;
}

export const wagmiConfig = getDefaultConfig({
  appName: "DSAS · 數位塔位",
  projectId: PROJECT_ID || "dsas-prototype-no-walletconnect",
  chains: [sepolia, baseSepolia],
  ssr: true,
});

export const ACTIVE_CHAIN_ID = CHAIN_ID;
