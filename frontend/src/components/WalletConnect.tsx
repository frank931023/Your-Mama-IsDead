"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useIsCorrectChain } from "@/lib/wallet";
import { ACTIVE_CHAIN_ID, SUPPORTED_CHAINS } from "@/lib/wagmi";
import { cn } from "@/lib/utils";

interface WalletConnectProps {
  className?: string;
  compact?: boolean;
}

export function WalletConnect({ className, compact }: WalletConnectProps): React.ReactElement {
  const { isCorrect, expected, current } = useIsCorrectChain();
  const { switchChain, isPending } = useSwitchChain();
  const expectedName =
    SUPPORTED_CHAINS.find((c) => c.id === expected)?.name ?? `chain ${expected}`;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ConnectButton
        showBalance={!compact}
        accountStatus={compact ? "address" : "full"}
        chainStatus={compact ? "icon" : "full"}
      />
      {!isCorrect && current !== undefined ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            連線網路錯誤,請切到 <strong>{expectedName}</strong>
          </span>
          <Button
            size="sm"
            variant="secondary"
            loading={isPending}
            onClick={() => switchChain({ chainId: ACTIVE_CHAIN_ID })}
          >
            切換網路
          </Button>
        </div>
      ) : null}
    </div>
  );
}
