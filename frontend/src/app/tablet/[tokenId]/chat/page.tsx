"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { ChatInterface } from "@/components/ChatInterface";
import { ChainGuard } from "@/components/ChainGuard";

export default function ChatPage(): React.ReactElement {
  const params = useParams<{ tokenId: string }>();
  const tokenId = params.tokenId;

  return (
    <div className="container-page py-10">
      <Link
        href={`/tablet/${tokenId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        回到塔位
      </Link>
      <h1 className="mb-2 font-serif text-2xl text-ink">與 #{tokenId} 對話</h1>
      <p className="mb-6 text-sm text-ink-muted">
        互動需先以錢包簽署 SIWE 訊息驗證持有,簽名不會花 gas。
      </p>
      <ChainGuard>
        <ChatInterface tokenId={tokenId} />
      </ChainGuard>
    </div>
  );
}
