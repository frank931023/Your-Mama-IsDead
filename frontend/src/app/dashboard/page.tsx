"use client";

/**
 * 燈塔典藏 (/dashboard)
 *
 * 列出當前連線錢包持有的所有記憶燈塔,並提供各座燈塔的「哀悼版 / 管理」入口。
 *
 * 注意:這頁只查 DB(走 GET /api/tablets?owner=0x...),不會主動 sync 鏈上。
 * 剛鑄造完看不到新燈塔時,按「掃描鏈上」把鏈上有、DB 沒有的燈塔同步進來
 * (backend 從 tokenId=1 往上 probe)。
 */

import * as React from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Loader2, Plus, Flame, Settings2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ChainGuard } from "@/components/ChainGuard";
import { useError } from "@/components/ErrorDialog";
import { getOwned, scanRegistry, type TabletRecord } from "@/lib/api";
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
  const [scanning, setScanning] = React.useState(false);

  const reload = React.useCallback(
    (addr: string): void => {
      setLoading(true);
      getOwned(addr)
        .then(setItems)
        .catch((e: unknown) => {
          showError("讀取燈塔資料失敗", e instanceof Error ? e.message : String(e));
        })
        .finally(() => setLoading(false));
    },
    [showError],
  );

  React.useEffect(() => {
    if (!address) return;
    reload(address);
  }, [address, reload]);

  // 掃描鏈上有、DB 沒有的燈塔 (剛鑄造完 lazy sync 還沒跑到時用)。
  const scan = async (): Promise<void> => {
    if (!address) return;
    setScanning(true);
    try {
      await scanRegistry();
      reload(address);
    } catch (e) {
      showError("掃描鏈上失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

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

          <div className="flex gap-2">
            <Link href="/mint">
              <Button>建立第一座燈塔</Button>
            </Link>
            <Button variant="outline" disabled={scanning} onClick={() => void scan()}>
              {scanning ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              掃描鏈上
            </Button>
          </div>
          <p className="text-xs text-ink-muted">剛鑄造完看不到?按「掃描鏈上」同步。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" disabled={scanning} onClick={() => void scan()}>
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          掃描鏈上新鑄造
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((t) => (
          <TabletCard key={t.tokenId} tablet={t} />
        ))}
      </div>
    </div>
  );
}

function TabletCard({ tablet }: { tablet: TabletRecord }): React.ReactElement {
  const meta = tablet.metadata;

  const portrait = meta?.image ? ipfsToHttps(meta.image) : null;

  const death = meta?.dsas.deceased.death?.date;
  const birth = meta?.dsas.deceased.birth?.date;

  const isPublic = tablet.public ?? meta?.dsas.public ?? false;

  return (
    <Card className="flex h-full flex-col transition-shadow hover:border-gold/50 hover:shadow-ritual">
      {/* 主要區域點進燈塔頁 */}
      <Link href={`/tablet/${tablet.tokenId}`} className="flex flex-col">
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
      </Link>

      <CardContent className="flex flex-1 flex-col gap-2">
        <p className="text-xs text-ink-muted">
          {formatDate(birth) || "?"} – {formatDate(death) || "?"}
        </p>

        <p className="text-xs text-ink-muted">
          家人:{truncateAddress(tablet.owner)}
        </p>

        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
            isPublic ? "bg-emerald-100 text-emerald-900" : "bg-ink/5 text-ink-muted"
          }`}
        >
          {isPublic ? "哀悼版公開中" : "哀悼版未公開"}
        </span>

        {/* 哀悼版 / 管理入口 */}
        <div className="mt-auto flex gap-2 border-t border-ink/10 pt-3">
          <Link href={`/memorial/${tablet.tokenId}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <Flame className="h-3.5 w-3.5" aria-hidden />
              哀悼版
            </Button>
          </Link>
          <Link href={`/dashboard/${tablet.tokenId}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              管理
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
