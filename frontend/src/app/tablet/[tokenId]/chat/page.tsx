"use client";

/**
 * 對話頁 (/tablet/[tokenId]/chat?ui=text|avatar|voice)
 *
 * URL query string 的 ui 決定互動形式 (PersonaActivationModal 選定後帶過來):
 *   - text:   純文字對談,無聲音無人像
 *   - avatar: 打字輸入,分身以聲音 + 3D 人像回應 (預設)
 *   - voice:  全螢幕人像,麥克風語音對話
 *
 * 另保留 legacy ?mode=local (走已廢棄的 compute service);未指定一律 cloud
 * (cloud 模式下若 render 渲染機可用,實際推理仍在自建機器上)。
 */
import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, MessageSquare, ScanFace, Mic } from "lucide-react";

import { ChatInterface, type ChatUiMode } from "@/components/ChatInterface";
import { ChainGuard } from "@/components/ChainGuard";
import { fetchTablet, type TabletRecord } from "@/lib/api";
import { displayName } from "@/lib/utils";

const UI_META: Record<ChatUiMode, { label: string; icon: React.ReactNode }> = {
  text: { label: "純文字對談", icon: <MessageSquare className="h-3 w-3" aria-hidden /> },
  avatar: { label: "文字對談・聲音人像", icon: <ScanFace className="h-3 w-3" aria-hidden /> },
  voice: { label: "語音對話・聲音人像", icon: <Mic className="h-3 w-3" aria-hidden /> },
};

export default function ChatPage(): React.ReactElement {
  const params = useParams<{ tokenId: string }>();
  const search = useSearchParams();
  const tokenId = params.tokenId;
  const rawUi = search.get("ui");
  const ui: ChatUiMode = rawUi === "text" ? "text" : rawUi === "voice" ? "voice" : "avatar";
  const mode: "local" | "cloud" = search.get("mode") === "local" ? "local" : "cloud";
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
  const uiMeta = UI_META[ui];

  return (
    <div className="container-page py-10">
      <Link
        href={`/tablet/${tokenId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        回到燈塔
      </Link>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="font-serif text-2xl text-ink">與 {heading} 對談</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-xs text-gold-dark">
          {uiMeta.icon}
          {uiMeta.label}
        </span>
      </div>
      <p className="mb-6 text-sm text-ink-muted">
        互動需先以錢包簽署一次數位身份,確認您是這份記憶的家人。簽名不會花 gas。
      </p>
      <ChainGuard>
        <ChatInterface tokenId={tokenId} mode={mode} ui={ui} />
      </ChainGuard>
    </div>
  );
}
