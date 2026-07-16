"use client";

/**
 * 燈塔總覽頁 (/registry) — 公開哀悼版展示館
 *
 * 任何人都能在這裡瀏覽「已公開」的哀悼版,點進去就是該位逝者的追悼頁
 * (/memorial/[tokenId]):看生平、照片、親友回憶,獻上一炷香。
 *
 * 這頁刻意不放任何鏈上技術資訊 (合約地址 / CID / 持有者地址) — 這裡是
 * 給訪客緬懷的地方,不是區塊鏈瀏覽器。屋主在塔位編輯頁勾「公開追悼頁」
 * 後,燈塔才會出現在這裡;鏈上同步等管理動作在燈塔典藏 (/dashboard)。
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Wind, Flame } from "lucide-react";

import { Card, CardContent } from "@/components/ui/Card";
import { useError } from "@/components/ErrorDialog";
import { getPublicRegistry, type TabletRecord } from "@/lib/api";
import { displayName, formatDate, ipfsToHttps, shortName } from "@/lib/utils";

export default function RegistryPage(): React.ReactElement {
  const router = useRouter();
  const { showError } = useError();
  const [items, setItems] = React.useState<TabletRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    getPublicRegistry()
      .then((rs) => {
        if (!cancelled) setItems(rs);
      })
      .catch((e: unknown) => {
        if (!cancelled) showError("讀取哀悼版列表失敗", e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showError]);

  return (
    <div className="container-page py-10">
      <header className="mx-auto mb-8 max-w-2xl text-center">
        <p className="mb-2 text-xs uppercase tracking-[0.4em] text-gold-dark">公開哀悼版</p>
        <h1 className="font-serif text-3xl text-ink sm:text-4xl">燈塔總覽</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          這裡是所有家屬選擇公開的追悼頁。
          <br />
          每一座燈塔背後,都是一段願意被記得、也願意被分享的人生。
        </p>
      </header>

      {loading && !items ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
        </div>
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-ink-muted">
            <Wind className="h-8 w-8" aria-hidden />
            <p>目前還沒有任何公開的哀悼版。</p>
            <p className="text-xs">
              已建立燈塔的家人,可在燈塔頁編輯資料時勾選「公開追悼頁」,讓這座燈塔出現在這裡。
            </p>
            <Link href="/mint" className="underline underline-offset-2 hover:text-gold-dark">
              為某個人點亮第一座燈塔
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((t) => (
            <MemorialCard
              key={t.tokenId}
              tablet={t}
              onOpen={() => router.push(`/memorial/${t.tokenId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MemorialCard({
  tablet,
  onOpen,
}: {
  tablet: TabletRecord;
  onOpen: () => void;
}): React.ReactElement {
  const meta = tablet.metadata;
  const portrait = meta?.image ? ipfsToHttps(meta.image) : null;
  const birth = meta?.dsas.deceased.birth?.date;
  const death = meta?.dsas.deceased.death?.date;
  const epitaph = meta?.dsas.deceased.epitaph;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-lg border border-ink/10 bg-paper text-left transition-all hover:border-gold/50 hover:shadow-ritual"
    >
      <div className="relative h-52 w-full overflow-hidden bg-paper-soft">
        {portrait ? (
          <img
            src={portrait}
            alt={shortName(meta, tablet.tokenId)}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink-muted">
            尚無肖像
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2 text-paper">
          <div>
            <p className="font-serif text-lg leading-tight">{displayName(meta, tablet.tokenId)}</p>
            <p className="text-xs opacity-80">
              {formatDate(birth) || "?"} – {formatDate(death) || "?"}
            </p>
          </div>
          <Flame className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </div>
      </div>
      <div className="flex flex-1 flex-col px-4 py-3">
        {epitaph ? (
          <p className="line-clamp-2 font-serif text-xs italic text-ink">「{epitaph}」</p>
        ) : (
          <p className="text-xs text-ink-muted">點此進入追悼頁</p>
        )}
      </div>
    </button>
  );
}
