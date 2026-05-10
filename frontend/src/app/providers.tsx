"use client";

/**
 * 全站 Provider 組合
 *
 * 巢狀順序 (外 → 內):
 *   WagmiProvider          ─ wagmi 鏈上互動 context
 *     QueryClientProvider  ─ React Query (wagmi/RainbowKit 內部用)
 *       RainbowKitProvider ─ 錢包連線 UI
 *         ErrorDialogProvider ─ 全域錯誤 modal,放最內層,所有頁面共用
 *
 * 注意 ErrorDialogProvider 必須在最內層(離 children 最近),這樣它的
 * modal overlay 才會 render 在最上層 z-index,蓋過所有 page 內容。
 */
import * as React from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";

import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "@/lib/wagmi";
import { ErrorDialogProvider } from "@/components/ErrorDialog";

export function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={{
            lightMode: lightTheme({
              accentColor: "#b08a3e",
              accentColorForeground: "#1a1814",
              borderRadius: "medium",
              fontStack: "system",
            }),
            darkMode: darkTheme({
              accentColor: "#d4b265",
              accentColorForeground: "#1a1814",
              borderRadius: "medium",
              fontStack: "system",
            }),
          }}
          modalSize="compact"
        >
          <ErrorDialogProvider>{children}</ErrorDialogProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
