"use client";

/**
 * 鏈保護元件:Children 只在「錢包已連線且網路正確」時才 render。
 *
 * 三種狀態的 fallback:
 *   1. 錢包未連線    顯示「請連接錢包」+ Connect 按鈕
 *   2. 錢包在錯的鏈  顯示「請切換到 Sepolia」+ 一鍵切鏈按鈕
 *   3. 一切正常      直接 render children
 *
 * 用法:把需要鏈互動的頁面內容包進來,例如 /mint /dashboard /chat。
 */
import { type ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useIsCorrectChain } from "@/lib/wallet";
import { ACTIVE_CHAIN_ID, SUPPORTED_CHAINS } from "@/lib/wagmi";

interface ChainGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function ChainGuard({ children, fallback }: ChainGuardProps): React.ReactElement {
  const { isConnected } = useAccount();
  const { isCorrect } = useIsCorrectChain();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) {
    return (
      <>
        {fallback ?? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertCircle className="h-8 w-8 text-ink-muted" aria-hidden />
              <p className="text-sm text-ink-muted">請先連接錢包以繼續。</p>
            </CardContent>
          </Card>
        )}
      </>
    );
  }

  if (!isCorrect) {
    const expectedName =
      SUPPORTED_CHAINS.find((c) => c.id === ACTIVE_CHAIN_ID)?.name ?? "Sepolia";
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-amber-700" aria-hidden />
          <p className="text-sm text-ink">
            請切換至 <strong>{expectedName}</strong> 後才能執行此操作。
          </p>
          <Button
            variant="secondary"
            loading={isPending}
            onClick={() => switchChain({ chainId: ACTIVE_CHAIN_ID })}
          >
            切換網路
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
