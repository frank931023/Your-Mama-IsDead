"use client";

/**
 * 燈塔管理頁 (/dashboard/[tokenId]) — 燈塔典藏內的屋主後台
 *
 * 哀悼版的「策展權」集中在這裡,公開追悼頁 (/memorial) 維持純展示:
 *   - 回憶審核:訪客投稿的 story 在這裡通過 / 隱藏 / 刪除;
 *     已通過的可「批次上鏈」寫進 metadata.dsas.stories (簽 setTokenURI)
 *   - 留言管理:檢視留言板,移除不當留言
 *
 * 審核會同步 AI 記憶:核可的回憶即進入對話檢索 (RAG),隱藏 / 刪除即移除
 * (後端在審核當下自動處理)。
 *
 * 權限:頁面以連線錢包比對鏈上 owner;所有寫操作走 SIWE owner jwt,
 * 後端 requireOwner 再驗一次鏈上持有。
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import {
  ChevronLeft,
  Loader2,
  Check,
  EyeOff,
  Trash2,
  UploadCloud,
  Flame,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { ChainGuard } from "@/components/ChainGuard";
import { useError } from "@/components/ErrorDialog";
import {
  fetchTablet,
  listAllStories,
  moderateStory,
  deleteStory,
  commitStories,
  listTributes,
  deleteTribute,
  reindexMemory,
  ApiError,
  type ReindexResult,
  type StoryRecord,
  type StoryStatus,
  type Tribute,
  type TributeKind,
  type TabletRecord,
} from "@/lib/api";
import { useSetTokenURI, useSiweLogin, useWaitForReceipt } from "@/lib/wallet";
import { buildAndSaveTabletMetadata, type TabletSaveStage } from "@/lib/tablet-save";
import { displayName, formatDate, ipfsToHttps, truncateAddress } from "@/lib/utils";
import type { Story } from "@shared/types/tablet";

export default function TabletManagePage(): React.ReactElement {
  const params = useParams<{ tokenId: string }>();
  return (
    <div className="container-page py-10">
      <ChainGuard>
        <ManageInner tokenId={params.tokenId} />
      </ChainGuard>
    </div>
  );
}

function ManageInner({ tokenId }: { tokenId: string }): React.ReactElement {
  const { address } = useAccount();
  const { showError } = useError();

  const [tablet, setTablet] = React.useState<TabletRecord | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetchTablet(tokenId)
      .then((t) => {
        if (!cancelled) setTablet(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) showError("讀取燈塔失敗", e instanceof Error ? e.message : String(e));
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
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
      </div>
    );
  }

  if (!tablet) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-ink-muted">
          找不到這座燈塔。
        </CardContent>
      </Card>
    );
  }

  const isOwner =
    !!address && !!tablet.owner && address.toLowerCase() === tablet.owner.toLowerCase();

  if (!isOwner) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-ink-muted">
          <AlertCircle className="h-6 w-6" aria-hidden />
          <p>只有這座燈塔的持有者能進入管理頁。</p>
          <Link
            href={`/tablet/${tokenId}`}
            className="underline underline-offset-2 hover:text-gold-dark"
          >
            前往燈塔頁
          </Link>
        </CardContent>
      </Card>
    );
  }

  return <ManageBody tablet={tablet} />;
}

// ── 管理主體 (確認是 owner 後才渲染) ────────────────────────────────────────

function ManageBody({ tablet }: { tablet: TabletRecord }): React.ReactElement {
  const tokenId = tablet.tokenId;

  return (
    <>
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/dashboard"
            className="mb-1 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            回燈塔典藏
          </Link>
          <h1 className="font-serif text-3xl text-ink">
            管理:{displayName(tablet.metadata, tokenId)}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            審核哀悼版的回憶投稿、管理留言板。通過的回憶會公開展示,並成為他記憶的一部分。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/memorial/${tokenId}`}>
            <Button variant="outline" size="sm">
              <Flame className="h-3.5 w-3.5" aria-hidden />
              查看哀悼版
            </Button>
          </Link>
          <Link href={`/tablet/${tokenId}`}>
            <Button variant="outline" size="sm">
              燈塔頁
            </Button>
          </Link>
        </div>
      </header>

      <Tabs defaultValue="stories">
        <TabsList>
          <TabsTrigger value="stories">回憶審核</TabsTrigger>
          <TabsTrigger value="tributes">留言管理</TabsTrigger>
        </TabsList>
        <TabsContent value="stories">
          <StoryManager tablet={tablet} />
        </TabsContent>
        <TabsContent value="tributes">
          <TributeManager tokenId={tokenId} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ── 回憶審核 ────────────────────────────────────────────────────────────────

type StoryFilter = "ALL" | StoryStatus;

const STORY_FILTERS: Array<{ id: StoryFilter; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "PENDING", label: "待審核" },
  { id: "APPROVED", label: "已公開" },
  { id: "REJECTED", label: "已隱藏" },
  { id: "ONCHAIN", label: "已上鏈" },
];

const STORY_STATUS_META: Record<StoryStatus, { label: string; cls: string }> = {
  PENDING: { label: "待審核", cls: "bg-amber-100 text-amber-900" },
  APPROVED: { label: "已公開", cls: "bg-emerald-100 text-emerald-900" },
  REJECTED: { label: "已隱藏", cls: "bg-ink/10 text-ink-muted" },
  ONCHAIN: { label: "已上鏈", cls: "bg-gold/20 text-gold-dark" },
};

function StoryManager({ tablet }: { tablet: TabletRecord }): React.ReactElement {
  const tokenId = tablet.tokenId;
  const { showError } = useError();
  const { login, logout, token } = useSiweLogin(tokenId);
  const { setTokenURI } = useSetTokenURI(tokenId);
  const waitForReceipt = useWaitForReceipt();

  const [stories, setStories] = React.useState<StoryRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<StoryFilter>("ALL");
  const [committing, setCommitting] = React.useState<TabletSaveStage | null>(null);
  // 最新 metadata (批次上鏈要 merge 進現有 metadata;上鏈後刷新)。
  const [metadata, setMetadata] = React.useState(tablet.metadata);
  // 重建記憶索引 (回填既有已核可回憶 + 對話紀錄進 RAG)。
  const [reindexing, setReindexing] = React.useState(false);
  const [reindexDone, setReindexDone] = React.useState<ReindexResult | null>(null);

  // owner jwt 包裝:過期 401 自動重簽一次。
  const withOwnerJwt = React.useCallback(
    async <T,>(fn: (jwt: string) => Promise<T>): Promise<T> => {
      try {
        const jwt = token ?? (await login());
        return await fn(jwt);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          const jwt = await login();
          return await fn(jwt);
        }
        throw err;
      }
    },
    // login/logout/token 是穩定 hook 回傳;token 變動時重建即可
    [token, login, logout],
  );

  const reload = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await withOwnerJwt((jwt) => listAllStories(tokenId, jwt));
      setStories(rows);
    } catch (e) {
      showError("讀取回憶失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tokenId, withOwnerJwt, showError]);

  React.useEffect(() => {
    void reload();
    // 進頁載入一次;之後靠操作就地更新 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModerate = async (id: string, status: "APPROVED" | "REJECTED"): Promise<void> => {
    try {
      const updated = await withOwnerJwt((jwt) => moderateStory(tokenId, id, status, jwt));
      setStories((prev) => (prev ? prev.map((s) => (s.id === id ? updated : s)) : prev));
    } catch (e) {
      showError("審核失敗", e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await withOwnerJwt((jwt) => deleteStory(tokenId, id, jwt));
      setStories((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    } catch (e) {
      showError("刪除失敗", e instanceof Error ? e.message : String(e));
    }
  };

  // 批次上鏈:把 APPROVED 合併進 metadata,簽 setTokenURI,成功後翻成 ONCHAIN。
  const approved = (stories ?? []).filter((s) => s.status === "APPROVED");

  const handleCommitOnChain = async (): Promise<void> => {
    if (!metadata) {
      showError("無法上鏈", "這座燈塔缺少 metadata,請先到燈塔頁補資料。");
      return;
    }
    if (approved.length === 0) return;

    const addStories: Story[] = approved.map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      ...(s.authorName ? { author: s.authorName } : {}),
      ...(s.authorAddress ? { authorAddress: s.authorAddress } : {}),
      ...(s.photoUri ? { photo: s.photoUri } : {}),
      ...(s.refDate ? { date: s.refDate } : {}),
      createdAt: s.createdAt,
      contentCid: s.contentCid,
    }));

    try {
      const jwt = token ?? (await login());
      const result = await buildAndSaveTabletMetadata(
        metadata,
        { addStories },
        { tokenId, setTokenURI, waitForReceipt, jwt, onStage: setCommitting },
      );
      await commitStories(tokenId, approved.map((s) => s.id), jwt);
      setMetadata(result.metadata);
      setCommitting(null);
      await reload();
    } catch (e) {
      setCommitting(null);
      const msg =
        e instanceof ApiError && e.status === 401
          ? "需要簽署登入訊息才能上鏈 (請在錢包中確認簽名)。"
          : e instanceof Error
            ? e.message
            : "批次上鏈失敗";
      showError("批次上鏈失敗", msg);
    }
  };

  const visible = (stories ?? []).filter((s) => filter === "ALL" || s.status === filter);
  const pendingCount = (stories ?? []).filter((s) => s.status === "PENDING").length;

  // 整庫重建記憶索引:拉對話紀錄 + 已核可回憶 → 切片 → embed → 向量庫。
  // 平常不需要 (核可當下自動進);用在「升級後回填舊資料」或索引疑似不同步時。
  const handleReindex = async (): Promise<void> => {
    setReindexing(true);
    setReindexDone(null);
    try {
      const result = await withOwnerJwt((jwt) => reindexMemory(tokenId, jwt));
      setReindexDone(result);
    } catch (e) {
      showError("重建記憶索引失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 批次上鏈 + 記憶索引條 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3">
        <p className="text-sm text-ink-muted">
          {pendingCount > 0 ? (
            <>
              有 <strong className="text-ink">{pendingCount}</strong> 則回憶等待審核。
            </>
          ) : (
            "目前沒有待審核的回憶。"
          )}
          通過的回憶會公開在哀悼版、進入他的記憶;按「批次上鏈」可永久寫進鏈上。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={reindexing}
            onClick={() => void handleReindex()}
            title="把對話紀錄與所有已通過的回憶重新寫入對話檢索 (RAG) 索引"
          >
            {reindexing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {reindexing ? "重建中…" : "重建記憶索引"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={approved.length === 0 || committing !== null}
            onClick={() => void handleCommitOnChain()}
          >
            {committing !== null ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <UploadCloud className="h-4 w-4" aria-hidden />
            )}
            {committing !== null ? commitLabel(committing) : `批次上鏈 (${approved.length})`}
          </Button>
        </div>
        {reindexDone ? (
          <p className="w-full text-xs text-emerald-700">
            記憶索引已重建:{reindexDone.chatlogsProcessed} 份對話紀錄
            {typeof reindexDone.storiesProcessed === "number"
              ? `、${reindexDone.storiesProcessed} 則回憶`
              : ""}
            ,共 {reindexDone.piecesIndexed} 段記憶。
          </p>
        ) : null}
      </div>

      {/* 狀態過濾 */}
      <div className="flex flex-wrap gap-1.5">
        {STORY_FILTERS.map((f) => {
          const count =
            f.id === "ALL"
              ? (stories ?? []).length
              : (stories ?? []).filter((s) => s.status === f.id).length;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === f.id
                  ? "border-gold bg-gold/15 text-gold-dark"
                  : "border-ink/15 text-ink-muted hover:border-gold/40"
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {/* 列表 */}
      {loading && !stories ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-ink-muted" aria-hidden />
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-ink-muted">
            這個分類目前沒有回憶。
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((s) => (
            <ManagedStoryRow
              key={s.id}
              story={s}
              onApprove={() => void handleModerate(s.id, "APPROVED")}
              onReject={() => void handleModerate(s.id, "REJECTED")}
              onDelete={() => void handleDelete(s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function commitLabel(stage: TabletSaveStage): string {
  switch (stage) {
    case "building":
      return "重組中…";
    case "uploading":
      return "上傳中…";
    case "signing":
      return "請在錢包簽名…";
    case "confirming":
      return "等待上鏈確認…";
    case "syncing":
      return "同步中…";
    case "indexing":
      return "建索引中…";
    default:
      return "完成";
  }
}

/** Tiptap HTML → 純文字摘要 (管理列表不需要完整富文本,重點是快速決策)。 */
function htmlExcerpt(html: string, max = 200): string {
  const text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function ManagedStoryRow({
  story,
  onApprove,
  onReject,
  onDelete,
}: {
  story: StoryRecord;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const meta = STORY_STATUS_META[story.status];
  const author =
    story.authorName || (story.authorAddress ? truncateAddress(story.authorAddress) : "訪客");
  const when = formatDate(story.createdAt) || story.createdAt.slice(0, 10);

  return (
    <li className="flex gap-3 rounded-lg border border-ink/10 bg-paper p-3">
      {story.photoUri ? (
        <a
          href={ipfsToHttps(story.photoUri)}
          target="_blank"
          rel="noreferrer"
          className="block shrink-0"
        >
          <img
            src={ipfsToHttps(story.photoUri)}
            alt={story.title}
            loading="lazy"
            className="h-20 w-20 rounded-md object-cover"
          />
        </a>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-serif text-base text-ink">{story.title}</h3>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${meta.cls}`}>
            {meta.label}
          </span>
        </div>
        <p className="text-sm text-ink-muted">{htmlExcerpt(story.body)}</p>
        <p className="text-xs text-ink-muted">
          — {author}
          {story.refDate ? ` · ${story.refDate}` : ""} · 投稿於 {when}
        </p>

        <div className="mt-1 flex flex-wrap gap-2">
          {story.status !== "APPROVED" && story.status !== "ONCHAIN" ? (
            <Button variant="outline" size="sm" onClick={onApprove}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              通過
            </Button>
          ) : null}
          {story.status !== "REJECTED" && story.status !== "ONCHAIN" ? (
            <Button variant="ghost" size="sm" onClick={onReject}>
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
              隱藏
            </Button>
          ) : null}
          {story.status !== "ONCHAIN" ? (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              刪除
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

// ── 留言管理 ────────────────────────────────────────────────────────────────

const TRIBUTE_KIND_LABEL: Record<TributeKind, string> = {
  incense: "獻香",
  lotus: "紙蓮花",
  fruit: "鮮果",
  tea: "清茶",
  candle: "燭",
  note: "留言",
};

function TributeManager({ tokenId }: { tokenId: string }): React.ReactElement {
  const { showError } = useError();
  const { login, logout, token } = useSiweLogin(tokenId);

  const [tributes, setTributes] = React.useState<Tribute[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    listTributes(tokenId)
      .then((rows) => {
        if (!cancelled) setTributes(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) showError("讀取留言失敗", e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, showError]);

  const handleDelete = async (id: string): Promise<void> => {
    try {
      let jwt = token ?? (await login());
      try {
        await deleteTribute(tokenId, id, jwt);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          jwt = await login();
          await deleteTribute(tokenId, id, jwt);
        } else {
          throw err;
        }
      }
      setTributes((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
    } catch (e) {
      showError("刪除留言失敗", e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && !tributes) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-ink-muted" aria-hidden />
      </div>
    );
  }

  if (!tributes || tributes.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-ink-muted">
          還沒有任何留言。
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {tributes.map((t) => (
        <li
          key={t.id}
          className="flex items-start justify-between gap-3 rounded-lg border border-ink/10 bg-paper p-3"
        >
          <div className="min-w-0">
            <p className="text-sm text-ink">{t.message}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {TRIBUTE_KIND_LABEL[t.kind] ?? t.kind} ·{" "}
              {t.fromName || (t.fromAddress ? truncateAddress(t.fromAddress) : "匿名訪客")} ·{" "}
              {formatDate(t.createdAt) || t.createdAt.slice(0, 10)}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void handleDelete(t.id)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            移除
          </Button>
        </li>
      ))}
    </ul>
  );
}
