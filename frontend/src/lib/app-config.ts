"use client";

/**
 * Runtime app config — 從 backend GET /api/config 拉「現在該打哪條鏈、
 * 哪個合約、上傳走哪個 storage」。admin 頁切換模式後,全前端在一個
 * refetch 週期內自動跟上,不需要重啟或改 .env。
 *
 * Backend 還沒醒(或還沒起)時 fallback 到 NEXT_PUBLIC_* 環境變數,
 * 行為等同改造前的純靜態設定。
 */
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { BACKEND_URL } from "./api";

export interface AppConfig {
  chainMode: "real" | "local";
  chainId: number;
  contractAddress: Address;
  storageMode: "pinata" | "local";
}

const ENV_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";

export const FALLBACK_CONFIG: AppConfig = {
  chainMode: "real",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111"),
  contractAddress: (/^0x[0-9a-fA-F]{40}$/.test(ENV_ADDRESS)
    ? ENV_ADDRESS
    : "0x0000000000000000000000000000000000000000") as Address,
  storageMode: "pinata",
};

export const APP_CONFIG_QUERY_KEY = ["app-config"] as const;

async function fetchAppConfig(): Promise<AppConfig> {
  const res = await fetch(`${BACKEND_URL}/api/config`, { cache: "no-store" });
  if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
  return (await res.json()) as AppConfig;
}

/** 目前生效的 runtime 設定;backend 不可達時回 env fallback。 */
export function useAppConfig(): AppConfig {
  const { data } = useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: fetchAppConfig,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
  return data ?? FALLBACK_CONFIG;
}

/** 目前生效的合約地址(admin 切鏈後自動跟著換)。 */
export function useContractAddress(): Address {
  return useAppConfig().contractAddress;
}

/** 目前生效的 chainId(real=Sepolia、local=anvil)。 */
export function useActiveChainId(): number {
  return useAppConfig().chainId;
}
