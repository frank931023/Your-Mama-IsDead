"use client";

/**
 * 線上靈堂 (/baibai)
 *
 * 兩階段體驗:
 *   1. 選擇要祭拜的逝者(從 registry 拉所有塔位列出讓使用者選)
 *   2. 進入 3D 靈堂:中央祖位掛肖像、四周漂浮著本人留下的照片、
 *      檯前線香裊裊、燭光微弱閃爍。OrbitControls 讓使用者繞著
 *      靈堂走、按「三鞠躬」會觸發鏡頭低首動畫。
 *
 * 設計取捨:
 *   - 用 OrbitControls 不做第一人稱,因為第一人稱要碰撞偵測 +
 *     場景建模,工作量翻倍且和記憶燈塔的「靜觀」氣氛違和
 *   - 沒上 GLB 模型,用 Three.js primitive 組牌位 / 供桌 / 香爐,
 *     避免新增 ~10MB asset 拖累載入
 *   - 燭光閃爍用 sin 波 + 隨機抖動,呼吸感比常數 emissive 自然
 */
import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Wind, Flame } from "lucide-react";

import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useError } from "@/components/ErrorDialog";
import { getRegistry, type TabletRecord } from "@/lib/api";
import { displayName, formatDate, ipfsToHttps, shortName } from "@/lib/utils";
import { MemorialHall } from "@/components/baibai/MemorialHall";

export default function BaiBaiPage(): React.ReactElement {
  const { showError } = useError();
  const [items, setItems] = React.useState<TabletRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [chosen, setChosen] = React.useState<TabletRecord | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getRegistry()
      .then((rs) => {
        if (!cancelled) setItems(rs);
      })
      .catch((e: unknown) => {
        if (!cancelled) showError("讀取塔位列表失敗", e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showError]);

  if (chosen) {
    return <MemorialHall tablet={chosen} onExit={() => setChosen(null)} />;
  }

  return (
    <div className="container-page py-12">
      <header className="mx-auto mb-8 max-w-2xl text-center">
        <p className="mb-2 text-xs uppercase tracking-[0.4em] text-gold-dark">線上靈堂</p>
        <h1 className="font-serif text-3xl text-ink sm:text-4xl">
          願您此刻安靜地坐下。
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          選擇您想祭拜的家人,我們會為您打開一座屬於他的靈堂。
          那裡有他的肖像、他生前留下的影子,以及您可以靜靜獻上的一炷香。
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
        </div>
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-ink-muted">
            <Wind className="h-8 w-8" aria-hidden />
            <p>目前還沒有任何塔位被點亮。</p>
            <Link href="/mint" className="underline underline-offset-2 hover:text-gold-dark">
              為某個人點亮第一座燈塔
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <SelectCard key={t.tokenId} tablet={t} onPick={() => setChosen(t)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SelectCard({
  tablet,
  onPick,
}: {
  tablet: TabletRecord;
  onPick: () => void;
}): React.ReactElement {
  const meta = tablet.metadata;
  const portrait = meta?.image ? ipfsToHttps(meta.image) : null;
  const birth = meta?.dsas.deceased.birth?.date;
  const death = meta?.dsas.deceased.death?.date;

  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex flex-col overflow-hidden rounded-lg border border-ink/10 bg-paper text-left transition-all hover:border-gold/50 hover:shadow-ritual"
    >
      <div className="relative h-56 w-full overflow-hidden bg-paper-soft">
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
        {/* 黑色蒙層 + 中央燭光圖示,進入時的儀式感 */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />
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
      <p className="px-4 py-3 text-xs text-ink-muted">點此進入靈堂祭拜</p>
    </button>
  );
}
