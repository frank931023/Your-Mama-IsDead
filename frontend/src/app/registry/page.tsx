"use client";

/**
 * 燈塔總覽頁 (/registry)
 *
 * 列出 backend DB 已知的所有塔位,提供兩種視圖:
 *   - bento (預設) 卡片格,3~4 欄,適合瀏覽
 *   - table        表格,適合對 IPFS CID 等技術細節
 *
 * 兩個關鍵動作:
 *   - 重新整理       重讀 DB
 *   - 掃描鏈上新鑄造  打 POST /api/tablets/scan,backend 從 tokenId=1 開始
 *                   往上 probe,把鏈上有但 DB 沒的塔位 sync 進來
 */
import * as React from "react";
import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw, LayoutGrid, List } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useError } from "@/components/ErrorDialog";
import { getRegistry, scanRegistry, type TabletRecord } from "@/lib/api";
import { displayName, formatDate, ipfsToHttps, shortName, truncateAddress } from "@/lib/utils";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";

type ViewMode = "bento" | "table";

export default function RegistryPage(): React.ReactElement {
  const { showError } = useError();
  const [items, setItems] = React.useState<TabletRecord[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [lastScan, setLastScan] = React.useState<string | null>(null);
  const [view, setView] = React.useState<ViewMode>("bento");

  // Persist user preference
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("dsas:registry-view");
      if (saved === "bento" || saved === "table") setView(saved);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem("dsas:registry-view", view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const rs = await getRegistry();
      setItems(rs);
    } catch (e) {
      showError("讀取燈塔列表失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  const scan = async (): Promise<void> => {
    setScanning(true);
    try {
      const result = await scanRegistry();
      setItems(result.tablets);
      setLastScan(`掃描完成,鏈上找到 ${result.found} 筆。`);
    } catch (e) {
      showError("掃描鏈上失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="container-page py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl text-ink">燈塔總覽</h1>
          <p className="text-sm text-ink-muted">
            這座記憶燈塔已點亮的所有名字。每一張燈塔都對應一段被永久封存的故事。
          </p>
          {CONTRACT_ADDRESS && CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000" ? (
            <p className="mt-1 text-xs text-ink-muted">
              合約地址:
              <a
                href={etherscanAddressUrl(CONTRACT_ADDRESS)}
                target="_blank"
                rel="noreferrer"
                className="ml-1 underline underline-offset-2 hover:text-gold-dark"
              >
                {CONTRACT_ADDRESS}
                <ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden />
              </a>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            重新整理
          </Button>
          <Button onClick={() => void scan()} disabled={scanning}>
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            掃描鏈上新鑄造
          </Button>
        </div>
      </header>

      {lastScan ? (
        <p className="mb-4 text-xs text-emerald-800">{lastScan}</p>
      ) : null}

      {loading && !items ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
        </div>
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
            <p>目前還沒有任何燈塔被點亮。</p>
            <p>剛鑄造完?點上方「掃描鏈上新鑄造」把鏈上資料拉進來。</p>
          </CardContent>
        </Card>
      ) : view === "bento" ? (
        <BentoGrid items={items} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-ink/10 bg-paper">
          <table className="min-w-full divide-y divide-ink/10 text-sm">
            <thead className="bg-paper-soft/50 text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">姓名</th>
                <th className="px-3 py-2 text-left">擁有者</th>
                <th className="px-3 py-2 text-left">生卒</th>
                <th className="px-3 py-2 text-left">Metadata IPFS</th>
                <th className="px-3 py-2 text-left">大頭照 IPFS</th>
                <th className="px-3 py-2 text-left">Artifact IPFS</th>
                <th className="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {items.map((t) => (
                <RegistryRow key={t.tokenId} tablet={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}): React.ReactElement {
  return (
    <div className="inline-flex rounded-md border border-ink/15 bg-paper p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange("bento")}
        className={[
          "flex items-center gap-1 rounded px-2.5 py-1.5 transition-colors",
          view === "bento" ? "bg-ink text-paper" : "text-ink-muted hover:text-ink",
        ].join(" ")}
        aria-pressed={view === "bento"}
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
        卡片
      </button>
      <button
        type="button"
        onClick={() => onChange("table")}
        className={[
          "flex items-center gap-1 rounded px-2.5 py-1.5 transition-colors",
          view === "table" ? "bg-ink text-paper" : "text-ink-muted hover:text-ink",
        ].join(" ")}
        aria-pressed={view === "table"}
      >
        <List className="h-3.5 w-3.5" aria-hidden />
        清單
      </button>
    </div>
  );
}

function BentoGrid({ items }: { items: TabletRecord[] }): React.ReactElement {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((t) => (
        <BentoCard key={t.tokenId} tablet={t} />
      ))}
    </div>
  );
}

function BentoCard({ tablet }: { tablet: TabletRecord }): React.ReactElement {
  const meta = tablet.metadata;
  const name = displayName(meta, tablet.tokenId);
  const subtitle = shortName(meta, tablet.tokenId);
  const birth = meta?.dsas.deceased.birth?.date;
  const death = meta?.dsas.deceased.death?.date;
  const portraitURI = meta?.image ?? undefined;
  const epitaph = meta?.dsas.deceased.epitaph;

  // We can't wrap the whole card in <Link> because the owner-address /
  // CID badges are themselves <a> tags; nested anchors are invalid HTML and
  // cause a Next.js hydration error. Instead the portrait + name area links
  // to the detail page; badges link to their respective external targets.
  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-ink/10 bg-paper transition-shadow hover:shadow-ritual hover:border-gold/50">
      <Link href={`/tablet/${tablet.tokenId}`} className="block">
        <div className="relative h-44 w-full overflow-hidden bg-paper-soft">
          {portraitURI ? (
            <img
              src={ipfsToHttps(portraitURI)}
              alt={subtitle}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-ink-muted">
              尚無肖像
            </div>
          )}
          <span className="absolute right-2 top-2 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-xs text-paper">
            #{tablet.tokenId}
          </span>
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link href={`/tablet/${tablet.tokenId}`} className="block">
          <h3 className="font-serif text-lg leading-snug text-ink hover:text-gold-dark">
            {name}
          </h3>
          <p className="text-xs text-ink-muted">
            {formatDate(birth) || "?"} – {formatDate(death) || "?"}
          </p>
        </Link>
        {epitaph ? (
          <p className="line-clamp-2 rounded-md bg-paper-soft/60 px-2 py-1.5 font-serif text-xs italic text-ink">
            「{epitaph}」
          </p>
        ) : null}
        <div className="mt-auto flex flex-col gap-1 border-t border-ink/5 pt-2 text-[10px] text-ink-muted">
          <div className="flex items-center gap-1">
            <span className="text-ink">家人:</span>
            <a
              href={etherscanAddressUrl(tablet.owner)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline-offset-2 hover:underline"
            >
              {truncateAddress(tablet.owner)}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CIDBadge label="記事" uri={tablet.tokenURI} />
            <CIDBadge label="肖像" uri={portraitURI} />
            <CIDBadge label="記憶模型" uri={tablet.artifactURI ?? undefined} />
          </div>
        </div>
      </div>
    </article>
  );
}

function CIDBadge({ label, uri }: { label: string; uri: string | undefined }): React.ReactElement {
  if (!uri) {
    return (
      <span className="rounded bg-ink/5 px-1.5 py-0.5 text-ink-muted">{label} —</span>
    );
  }
  const cid = extractCID(uri);
  return (
    <a
      href={ipfsToHttps(uri)}
      target="_blank"
      rel="noreferrer"
      title={uri}
      className="rounded bg-gold/10 px-1.5 py-0.5 font-mono text-gold-dark hover:bg-gold/20"
    >
      {label} {cid ? truncateCID(cid) : "✓"}
    </a>
  );
}

function RegistryRow({ tablet }: { tablet: TabletRecord }): React.ReactElement {
  const meta = tablet.metadata;
  const name = displayName(meta, tablet.tokenId);
  const birth = meta?.dsas.deceased.birth?.date;
  const death = meta?.dsas.deceased.death?.date;
  const portraitURI = meta?.image ?? undefined;

  return (
    <tr className="hover:bg-paper-soft/40">
      <td className="px-3 py-2 font-mono text-xs">#{tablet.tokenId}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {portraitURI ? (
            <img
              src={ipfsToHttps(portraitURI)}
              alt={name}
              className="h-8 w-8 rounded object-cover"
            />
          ) : (
            <div className="h-8 w-8 rounded bg-paper-soft" />
          )}
          <span className="font-medium text-ink">{name}</span>
        </div>
      </td>
      <td className="px-3 py-2">
        <a
          href={etherscanAddressUrl(tablet.owner)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs underline underline-offset-2 hover:text-gold-dark"
          title={tablet.owner}
        >
          {truncateAddress(tablet.owner)}
        </a>
      </td>
      <td className="px-3 py-2 text-xs text-ink-muted">
        {formatDate(birth) || "?"} – {formatDate(death) || "?"}
      </td>
      <td className="px-3 py-2"><CIDLink uri={tablet.tokenURI} /></td>
      <td className="px-3 py-2"><CIDLink uri={portraitURI} /></td>
      <td className="px-3 py-2"><CIDLink uri={tablet.artifactURI ?? undefined} /></td>
      <td className="px-3 py-2">
        <Link
          href={`/tablet/${tablet.tokenId}`}
          className="text-xs underline underline-offset-2 hover:text-gold-dark"
        >
          開啟
        </Link>
      </td>
    </tr>
  );
}

function CIDLink({ uri }: { uri: string | undefined }): React.ReactElement {
  if (!uri) return <span className="text-ink-muted">—</span>;
  const cid = extractCID(uri);
  return (
    <a
      href={ipfsToHttps(uri)}
      target="_blank"
      rel="noreferrer"
      title={uri}
      className="font-mono text-xs underline underline-offset-2 hover:text-gold-dark"
    >
      {cid ? truncateCID(cid) : uri}
      <ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden />
    </a>
  );
}

function extractCID(uri: string): string | null {
  if (uri.startsWith("ipfs://")) return uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  if (uri.startsWith("ar://")) return uri.slice("ar://".length);
  return null;
}

function truncateCID(cid: string): string {
  if (cid.length <= 14) return cid;
  return `${cid.slice(0, 6)}...${cid.slice(-6)}`;
}

function etherscanAddressUrl(address: string): string {
  // 11155111 = Sepolia, 1 = mainnet, 84532 = Base Sepolia
  const base =
    CHAIN_ID === 1
      ? "https://etherscan.io"
      : CHAIN_ID === 84532
        ? "https://sepolia.basescan.org"
        : "https://sepolia.etherscan.io";
  return `${base}/address/${address}`;
}
