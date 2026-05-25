"use client";

/**
 * 燈塔典藏 (/dashboard)
 *
 * 列出當前連線錢包持有的所有記憶燈塔。
 *
 * 注意:這頁只查 DB(走 GET /api/tablets?owner=0x...),不會主動 sync 鏈上。
 * 如果剛建立燈塔但這頁看不到新資料,代表 backend 尚未同步,
 * 可前往 /registry 點選「掃描鏈上資料」或進入燈塔頁面觸發 lazy sync。
 */

import * as React from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ChainGuard } from "@/components/ChainGuard";
import { useError } from "@/components/ErrorDialog";
import { getOwned, type TabletRecord } from "@/lib/api";
import { displayName, formatDate, ipfsToHttps, shortName, truncateAddress } from "@/lib/utils";

export default function DashboardPage(): React.ReactElement {
  return (
    <div className="container-page py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl text-ink">燈塔典藏</h1>

          <p className="text-sm text-ink-muted">
            列出此錢包持有的所有 Aeterlux 記憶燈塔。
          </p>
        </div>

        <Link href="/mint">
          <Button>
            <Plus className="h-4 w-4" aria-hidden />
            建立新燈塔
          </Button>
        </Link>
      </header>

      <ChainGuard>
        <DashboardList />
      </ChainGuard>
    </div>
  );
}

function DashboardList(): React.ReactElement {
  const { address } = useAccount();

  const { showError } = useError();

  const [items, setItems] = React.useState<TabletRecord[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!address) return;

    let cancelled = false;

    setLoading(true);

    getOwned(address)
      .then((rs) => {
        if (!cancelled) setItems(rs);
      })
      .catch((e: unknown) => {
        if (cancelled) return;

        showError(
          "讀取燈塔資料失敗",
          e instanceof Error ? e.message : String(e),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, showError]);

  if (!address) {
    return <p className="text-sm text-ink-muted">請先連接錢包。</p>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-ink-muted">
            尚未建立任何燈塔。
            <br />
            為重要的人留下一道能被長久保存的光。
          </p>

          <Link href="/mint">
            <Button>建立第一座燈塔</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((t) => (
        <TabletCard key={t.tokenId} tablet={t} />
      ))}
    </div>
  );
}

function TabletCard({ tablet }: { tablet: TabletRecord }): React.ReactElement {
  const meta = tablet.metadata;

  const portrait = meta?.image ? ipfsToHttps(meta.image) : null;

  const death = meta?.dsas.deceased.death?.date;
  const birth = meta?.dsas.deceased.birth?.date;

  const status: TrainingStatus = inferTrainingStatus(tablet);

  return (
    <Link href={`/tablet/${tablet.tokenId}`}>
      <Card className="flex h-full flex-col transition-shadow hover:border-gold/50 hover:shadow-ritual">
        <CardHeader className="flex flex-col gap-2">
          {portrait ? (
            <img
              src={portrait}
              alt={shortName(meta, tablet.tokenId)}
              className="h-40 w-full rounded-md object-cover"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center rounded-md bg-paper-soft text-ink-muted">
              無圖
            </div>
          )}

          <div>
            <CardTitle>{displayName(meta, tablet.tokenId)}</CardTitle>

            <p className="text-xs text-ink-muted">
              第 {tablet.tokenId} 座燈塔
            </p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-2">
          <p className="text-xs text-ink-muted">
            {formatDate(birth) || "?"} – {formatDate(death) || "?"}
          </p>

          <p className="text-xs text-ink-muted">
            家人:{truncateAddress(tablet.owner)}
          </p>

          <span
            className={`mt-auto inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

type TrainingStatus = "untrained" | "queued" | "training" | "ready";

const STATUS_LABEL: Record<TrainingStatus, string> = {
  untrained: "未訓練",
  queued: "排程中",
  training: "訓練中",
  ready: "可互動",
};

const STATUS_STYLE: Record<TrainingStatus, string> = {
  untrained: "bg-ink/5 text-ink-muted",
  queued: "bg-amber-100 text-amber-900",
  training: "bg-sky-100 text-sky-900",
  ready: "bg-emerald-100 text-emerald-900",
};

function inferTrainingStatus(t: TabletRecord): TrainingStatus {
  if (t.artifactURI) return "ready";

  return "untrained";
}
