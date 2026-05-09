"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Cloud, Cpu } from "lucide-react";

import { ChatInterface } from "@/components/ChatInterface";
import { ChainGuard } from "@/components/ChainGuard";
import { fetchTablet, type TabletRecord } from "@/lib/api";
import { displayName } from "@/lib/utils";

export default function ChatPage(): React.ReactElement {
  const params = useParams<{ tokenId: string }>();
  const search = useSearchParams();
  const tokenId = params.tokenId;
  const mode: "local" | "cloud" = search.get("mode") === "cloud" ? "cloud" : "local";
  const [tablet, setTablet] = React.useState<TabletRecord | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchTablet(tokenId)
      .then((r) => {
        if (!cancelled) setTablet(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  const heading = displayName(tablet?.metadata, tokenId);

  return (
    <div className="container-page py-10">
      <Link
        href={`/tablet/${tokenId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        回到塔位
      </Link>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="font-serif text-2xl text-ink">與 {heading} 對談</h1>
        <span
          className={[
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
            mode === "cloud"
              ? "bg-gold/20 text-gold-dark"
              : "bg-sky-100 text-sky-900",
          ].join(" ")}
        >
          {mode === "cloud" ? (
            <Cloud className="h-3 w-3" aria-hidden />
          ) : (
            <Cpu className="h-3 w-3" aria-hidden />
          )}
          {mode === "cloud" ? "雲端即時模式" : "本地模式"}
        </span>
      </div>
      <p className="mb-6 text-sm text-ink-muted">
        互動需先以錢包簽署一次數位身份,確認您是這份記憶的家人。簽名不會花 gas。
      </p>
      <ChainGuard>
        <ChatInterface tokenId={tokenId} mode={mode} />
      </ChainGuard>
    </div>
  );
}
