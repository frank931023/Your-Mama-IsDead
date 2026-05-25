"use client";

/**
 * 家族樹頁 (/lineage/[rootId])
 *
 * 從某座記憶燈塔作為根節點往下展開整個家族脈絡,
 * 深度上限 6 層 (由 backend 控制 BFS,避免無限遞迴與 RPC 過載)。
 *
 * 視覺化使用 React Flow,
 * 支援節點拖拉、縮放與迷你地圖。
 * 點選任一節點即可前往對應的燈塔頁面。
 */

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ChevronLeft } from "lucide-react";

import { FamilyTree } from "@/components/FamilyTree";
import { useError } from "@/components/ErrorDialog";
import { fetchLineage, type LineageNode } from "@/lib/api";

export default function LineagePage(): React.ReactElement {
  const params = useParams<{ rootId: string }>();
  const rootId = params.rootId;

  const { showError } = useError();

  const [root, setRoot] = React.useState<LineageNode | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    setLoading(true);

    fetchLineage(rootId)
      .then((r) => {
        if (!cancelled) setRoot(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;

        showError(
          "讀取家族記錄失敗",
          e instanceof Error ? e.message : String(e),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rootId, showError]);

  return (
    <div className="container-page py-10">
      <Link
        href={`/tablet/${rootId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        回到燈塔
      </Link>

      <h1 className="mb-1 font-serif text-2xl text-ink">
        家族記錄 · 起自 #{rootId}
      </h1>

      <p className="mb-6 text-sm text-ink-muted">
        點選任一節點即可查看對應的記憶燈塔。
      </p>

      {loading ? (
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
        </div>
      ) : !root ? (
        <p className="text-sm text-ink-muted">
          無法載入家族記錄資料,請稍後再試。
        </p>
      ) : (
        <FamilyTree root={root} />
      )}
    </div>
  );
}
