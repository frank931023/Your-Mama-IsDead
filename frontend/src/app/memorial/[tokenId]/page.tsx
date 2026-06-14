"use client";

/**
 * 哀悼版獨立路由 (/memorial/[tokenId])
 *
 * 把 MemorialScroll (線上追悼頁) 從 /baibai 的內部 state 升級成可直連的網址:
 *   - /baibai 選人後導航過來 (網址可分享)
 *   - 燈塔典藏 (/dashboard) 的「哀悼版」入口直接開自己的追悼頁,
 *     不必繞公開列表 — 未公開的燈塔屋主也能進來預覽
 *
 * 公開與否只影響「會不會被列在 /baibai」;知道網址的人都能看 (與鏈上
 * metadata 本來就公開一致)。
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/Card";
import { useError } from "@/components/ErrorDialog";
import { fetchTablet, type TabletRecord } from "@/lib/api";
import { MemorialScroll } from "@/components/baibai/MemorialScroll";

export default function MemorialPage(): React.ReactElement {
  const params = useParams<{ tokenId: string }>();
  const router = useRouter();
  const { showError } = useError();
  const tokenId = params.tokenId;

  const [tablet, setTablet] = React.useState<TabletRecord | null>(null);
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(async (): Promise<void> => {
    try {
      setTablet(await fetchTablet(tokenId));
    } catch (e) {
      setFailed(true);
      showError("讀取追悼頁失敗", e instanceof Error ? e.message : String(e));
    }
  }, [tokenId, showError]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // 返回:從 baibai / dashboard 進來就回上一頁;直連網址 (無上一頁) 回 /baibai。
  const exit = (): void => {
    if (window.history.length > 1) router.back();
    else router.push("/baibai");
  };

  if (failed) {
    return (
      <div className="container-page py-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-ink-muted">
            <p>找不到這座燈塔的追悼頁。</p>
            <Link href="/baibai" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-gold-dark">
              <ChevronLeft className="h-4 w-4" aria-hidden />
              回線上紀念館
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tablet) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
      </div>
    );
  }

  return <MemorialScroll tablet={tablet} onExit={exit} />;
}
