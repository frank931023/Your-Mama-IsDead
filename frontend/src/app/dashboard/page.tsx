"use client";

import * as React from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ChainGuard } from "@/components/ChainGuard";
import { getOwned, type TabletRecord } from "@/lib/api";
import { formatDate, ipfsToHttps, truncateAddress } from "@/lib/utils";

export default function DashboardPage(): React.ReactElement {
  return (
    <div className="container-page py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl text-ink">我的塔位</h1>
          <p className="text-sm text-ink-muted">列出此錢包持有的所有 DSAS 塔位 NFT。</p>
        </div>
        <Link href="/mint">
          <Button>
            <Plus className="h-4 w-4" aria-hidden />
            鑄造新塔位
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
  const [items, setItems] = React.useState<TabletRecord[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOwned(address)
      .then((rs) => {
        if (!cancelled) setItems(rs);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "讀取失敗");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

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
  if (error) {
    return <p className="text-sm text-red-700">{error}</p>;
  }
  if (!items || items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-ink-muted">
            尚未持有塔位。前往「鑄造」開始為一段生命建立永不熄滅的燈塔。
          </p>
          <Link href="/mint">
            <Button>立即鑄造</Button>
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
      <Card className="flex h-full flex-col transition-shadow hover:shadow-ritual hover:border-gold/50">
        <CardHeader className="flex flex-col gap-2">
          {portrait ? (
            <img
              src={portrait}
              alt={meta?.name ?? `tablet #${tablet.tokenId}`}
              className="h-40 w-full rounded-md object-cover"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center rounded-md bg-paper-soft text-ink-muted">
              無圖
            </div>
          )}
          <div>
            <CardTitle>{meta?.name ?? `Tablet #${tablet.tokenId}`}</CardTitle>
            <p className="text-xs text-ink-muted">#{tablet.tokenId}</p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          <p className="text-xs text-ink-muted">
            {formatDate(birth) || "?"} – {formatDate(death) || "?"}
          </p>
          <p className="text-xs text-ink-muted">
            擁有者:{truncateAddress(tablet.owner)}
          </p>
          <span className={`mt-auto inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[status]}`}>
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
