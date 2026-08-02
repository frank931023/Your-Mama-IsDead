"use client";

/**
 * wagmi + RainbowKit 設定
 *
 * 支援的鏈:Sepolia 與 Base Sepolia (兩個都是測試網)。
 * 想加主網支援只要把 mainnet 加進 SUPPORTED_CHAINS 即可,但別忘了
 * NEXT_PUBLIC_CONTRACT_ADDRESS 要對應的部署在那條鏈上。
 *
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID 沒設不影響功能(MetaMask 等
 * 注入式錢包仍能用),只是 console 會噴 Reown 403 警告。
 */
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
  appName: "Aeterlux · 數位記憶燈塔",
  projectId: PROJECT_ID || "dsas-prototype-no-walletconnect",
  chains: [sepolia, baseSepolia],
  ssr: true,
});

export const ACTIVE_CHAIN_ID = CHAIN_ID;
