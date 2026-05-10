"use client";

/**
 * 單一塔位詳情頁 (/tablet/[tokenId])
 *
 * 顯示:
 *   - 大頭照 + 姓名 + 生卒籍貫 + 墓誌銘
 *   - 啟動數位分身按鈕 (打開 PersonaActivationModal)
 *   - 家族樹連結
 *   - Tabs:生平 / 照片牆 / 影音 / 子孫快照 / 對話紀錄
 *
 * 進這頁會打 GET /api/tablets/:tokenId,如果 DB 還沒這筆 backend 會
 * lazy sync 從鏈上抓,所以剛 mint 完直接點進來也看得到。
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, Play, Volume2, MessagesSquare, ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { PersonaActivationModal } from "@/components/PersonaActivationModal";
import { fetchTablet, type TabletRecord } from "@/lib/api";
import { displayName, formatDate, ipfsToHttps, shortName, truncateAddress } from "@/lib/utils";
import { useError } from "@/components/ErrorDialog";

export default function TabletDetailPage(): React.ReactElement {
  const params = useParams<{ tokenId: string }>();
  const tokenId = params.tokenId;
  const { showError } = useError();
  const [record, setRecord] = React.useState<TabletRecord | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [activationOpen, setActivationOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTablet(tokenId)
      .then((r) => {
        if (!cancelled) setRecord(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        showError("找不到該塔位", e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, showError]);

  if (loading) {
    return (
      <div className="container-page flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="container-page py-20 text-center text-sm text-ink-muted">
        無法載入這座塔位的資料,請稍後再試。
      </div>
    );
  }

  const meta = record.metadata;
  const deceased = meta?.dsas.deceased;
  const assets = meta?.dsas.assets;
  const descendants = meta?.dsas.descendants ?? [];
  const portrait = meta?.image ? ipfsToHttps(meta.image) : null;

  return (
    <div className="container-page py-10">
      <Card className="mb-6 overflow-hidden">
        <div className="grid gap-6 p-6 sm:grid-cols-[200px_1fr]">
          <div className="flex justify-center">
            {portrait ? (
              <img
                src={portrait}
                alt={shortName(meta, tokenId)}
                className="h-48 w-48 rounded-md object-cover shadow-ritual"
              />
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded-md bg-paper-soft text-ink-muted">
                無圖
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gold-dark">
                數位塔位 · 第 {tokenId} 號
              </p>
              <h1 className="font-serif text-3xl text-ink">{displayName(meta, tokenId)}</h1>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <FactRow label="籍貫" value={deceased?.origin} />
              <FactRow
                label="生卒"
                value={`${formatDate(deceased?.birth?.date) || "?"} – ${formatDate(deceased?.death?.date) || "?"}`}
              />
              <FactRow label="出生地" value={deceased?.birth?.place} />
              <FactRow label="逝世地" value={deceased?.death?.place} />
              <FactRow label="家人" value={truncateAddress(record.owner)} />
              {record.parentTokenId ? (
                <FactRow
                  label="父節點"
                  value={
                    <Link
                      href={`/tablet/${record.parentTokenId}`}
                      className="text-gold-dark underline"
                    >
                      #{record.parentTokenId}
                    </Link>
                  }
                />
              ) : (
                <FactRow label="家族脈絡" value="根節點" />
              )}
            </dl>
            {deceased?.epitaph ? (
              <p className="rounded-md bg-paper-soft/60 px-3 py-2 font-serif text-sm italic text-ink">
                「{deceased.epitaph}」
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                size="lg"
                variant="secondary"
                onClick={() => setActivationOpen(true)}
              >
                <MessagesSquare className="h-5 w-5" aria-hidden />
                啟動數位分身互動
              </Button>
              {record.parentTokenId ? (
                <Link href={`/lineage/${record.parentTokenId}`}>
                  <Button size="lg" variant="outline">
                    查看家族樹
                  </Button>
                </Link>
              ) : (
                <Link href={`/lineage/${tokenId}`}>
                  <Button size="lg" variant="outline">
                    查看家族樹
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="bio">
        <TabsList>
          <TabsTrigger value="bio">生平</TabsTrigger>
          <TabsTrigger value="photos">照片牆</TabsTrigger>
          <TabsTrigger value="av">影音</TabsTrigger>
          <TabsTrigger value="descendants">子孫</TabsTrigger>
          <TabsTrigger value="chatlogs">對話紀錄</TabsTrigger>
        </TabsList>

        <TabsContent value="bio">
          <Card>
            <CardContent className="flex flex-col gap-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {deceased?.biography ? (
                <p>{deceased.biography}</p>
              ) : (
                <p className="text-ink-muted">尚未填寫生平。</p>
              )}
              {meta?.description ? (
                <p className="text-ink-muted">{meta.description}</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="photos">
          {assets?.photos && assets.photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {assets.photos.map((uri) => (
                <a
                  key={uri}
                  href={ipfsToHttps(uri)}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-md border border-ink/10 bg-paper"
                >
                  <img
                    src={ipfsToHttps(uri)}
                    alt=""
                    className="h-40 w-full object-cover transition-transform hover:scale-105"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ImageIcon className="h-6 w-6" aria-hidden />} text="尚無照片。" />
          )}
        </TabsContent>

        <TabsContent value="av">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">影片</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {assets?.videos?.length ? (
                  assets.videos.map((uri) => (
                    <video key={uri} src={ipfsToHttps(uri)} controls className="w-full rounded-md" />
                  ))
                ) : (
                  <EmptyState icon={<Play className="h-5 w-5" aria-hidden />} text="尚無影片。" small />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">錄音</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {assets?.audios?.length ? (
                  assets.audios.map((uri) => (
                    <audio key={uri} src={ipfsToHttps(uri)} controls className="w-full" />
                  ))
                ) : (
                  <EmptyState icon={<Volume2 className="h-5 w-5" aria-hidden />} text="尚無音檔。" small />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="descendants">
          {descendants.length === 0 ? (
            <EmptyState text="尚未紀錄陽世子孫。" />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {descendants.map((d, idx) => (
                <li
                  key={`${d.name}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-ink/10 bg-paper p-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-ink">{d.name}</span>
                    <span className="text-xs text-ink-muted">{d.relation}</span>
                    {d.wallet ? (
                      <span className="text-xs text-ink-muted">{truncateAddress(d.wallet)}</span>
                    ) : null}
                  </div>
                  {d.tokenId !== undefined ? (
                    <Link
                      href={`/tablet/${d.tokenId}`}
                      className="text-sm text-gold-dark underline"
                    >
                      #{d.tokenId}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="chatlogs">
          <Card>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm text-ink">
                共 <strong>{assets?.chatlogs?.length ?? 0}</strong> 份對話紀錄
              </p>
              {assets?.chatlogs?.length ? (
                <ul className="flex flex-col gap-1.5 text-xs text-ink-muted">
                  {assets.chatlogs.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium text-ink">{c.platform}</span> · {c.format} ·{" "}
                      <a
                        href={ipfsToHttps(c.uri)}
                        className="underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.uri}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-muted">尚未上傳對話紀錄。</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PersonaActivationModal
        tokenId={tokenId}
        metadata={meta}
        open={activationOpen}
        onClose={() => setActivationOpen(false)}
      />
    </div>
  );
}

function FactRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement | null {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted">{label}:</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function EmptyState({
  icon,
  text,
  small,
}: {
  icon?: React.ReactNode;
  text: string;
  small?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-md border border-dashed border-ink/15 ${
        small ? "py-4" : "py-10"
      } text-ink-muted`}
    >
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  );
}
