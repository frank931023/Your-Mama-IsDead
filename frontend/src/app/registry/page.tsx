"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { getRegistry, scanRegistry, type TabletRecord } from "@/lib/api";
import { formatDate, ipfsToHttps, truncateAddress } from "@/lib/utils";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";

export default function RegistryPage(): React.ReactElement {
  const [items, setItems] = React.useState<TabletRecord[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastScan, setLastScan] = React.useState<string | null>(null);

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const rs = await getRegistry();
      setItems(rs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  const scan = async (): Promise<void> => {
    setScanning(true);
    setError(null);
    try {
      const result = await scanRegistry();
      setItems(result.tablets);
      setLastScan(`掃描完成,鏈上找到 ${result.found} 筆。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "掃描失敗");
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
          <h1 className="font-serif text-3xl text-ink">塔位總覽</h1>
          <p className="text-sm text-ink-muted">
            列出所有已鑄造的 DSAS 塔位 NFT,以及對應的 IPFS 內容識別碼。
          </p>
          {CONTRACT_ADDRESS && CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000" ? (
            <p className="mt-1 text-xs text-ink-muted">
              合約:
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
        <div className="flex gap-2">
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
      {error ? (
        <p className="mb-4 text-sm text-red-700">{error}</p>
      ) : null}

      {loading && !items ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
        </div>
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
            <p>目前 DB 沒有任何塔位紀錄。</p>
            <p>剛鑄造完?點上方「掃描鏈上新鑄造」把鏈上資料拉進來。</p>
          </CardContent>
        </Card>
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

function RegistryRow({ tablet }: { tablet: TabletRecord }): React.ReactElement {
  const meta = tablet.metadata;
  const name = meta?.name ?? `Tablet #${tablet.tokenId}`;
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
