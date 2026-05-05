"use client";

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
