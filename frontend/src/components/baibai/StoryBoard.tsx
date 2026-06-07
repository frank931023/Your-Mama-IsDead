"use client";

/**
 * 哀悼版 (Memorial Stories) —— 2D 區塊。
 *
 * 任何人 (訪客或屋主) 都能投稿一段回憶 (標題＋內文＋可選照片＋作者＋日期)。
 * 投稿後內容由後端 pin 到 IPFS、狀態 PENDING,要屋主審核過才公開可見。
 *
 * 屋主 (isOwner) 額外看得到:
 *   - 待審 / 已隱藏的回憶,可「通過 / 隱藏 / 刪除」(需 SIWE owner jwt)
 *   - 「批次上鏈」把已核可 (APPROVED) 的回憶合併進 metadata、簽 setTokenURI 上鏈,
 *     成功後 commit 把它們標記成 ONCHAIN (避免重複批次)。
 *
 * 上鏈走共用的 buildAndSaveTabletMetadata(tablet-save.ts),與塔位編輯頁同一條路徑。
 */
import * as React from "react";
import { useAccount } from "wagmi";
import DOMPurify from "dompurify";
import { Loader2, Send, Check, EyeOff, Trash2, UploadCloud, ChevronDown } from "lucide-react";

import { RichTextEditor } from "./RichTextEditor";

import { Button } from "@/components/ui/Button";
import { MediaUploader } from "@/components/MediaUploader";
import { useError } from "@/components/ErrorDialog";
import { ipfsToHttps, truncateAddress } from "@/lib/utils";
import {
  listStories,
  listAllStories,
  createStory,
  moderateStory,
  deleteStory,
  commitStories,
  ApiError,
  type StoryRecord,
  type TabletRecord,
  type UploadedAsset,
} from "@/lib/api";
import { useSetTokenURI, useSiweLogin, useWaitForReceipt } from "@/lib/wallet";
import { buildAndSaveTabletMetadata, type TabletSaveStage } from "@/lib/tablet-save";
import type { Story } from "@shared/types/tablet";

export interface StoryBoardTheme {
  accent: string;
  text: string;
  textMuted: string;
  card: string;
  dark?: boolean;
}

interface StoryBoardProps {
  tablet: TabletRecord;
  isOwner: boolean;
  theme: StoryBoardTheme;
  /** 屋主批次上鏈成功後通知上層 reload (metadata 變了)。 */
  onChainUpdated?: () => void;
}

export function StoryBoard({
  tablet,
  isOwner,
  theme,
  onChainUpdated,
}: StoryBoardProps): React.ReactElement {
  const tokenId = tablet.tokenId;
  const { address } = useAccount();
  const { showError } = useError();
  const { login, logout, token } = useSiweLogin(tokenId);
  const { setTokenURI } = useSetTokenURI(tokenId);
  const waitForReceipt = useWaitForReceipt();

  const [stories, setStories] = React.useState<StoryRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [committing, setCommitting] = React.useState<TabletSaveStage | null>(null);

  // 屋主視角拉全部狀態,訪客視角只拉公開 (APPROVED+ONCHAIN)。
  const reload = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      if (isOwner) {
        // 需要 owner jwt;沒有就先登入。失敗則退回公開列表 (至少看得到已核可)。
        try {
          const jwt = token ?? (await login());
          setStories(await listAllStories(tokenId, jwt));
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            logout();
          }
          setStories(await listStories(tokenId));
        }
      } else {
        setStories(await listStories(tokenId));
      }
    } catch (e) {
      showError("讀取回憶失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // login/logout/token 故意不入依賴:避免每次 token 變動重抓;由 isOwner/tokenId 驅動。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, isOwner, showError]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  // ── 屋主:審核 (核可 / 隱藏) ──────────────────────────────────────────────
  const withOwnerJwt = async <T,>(fn: (jwt: string) => Promise<T>): Promise<T> => {
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
  };

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

  // ── 屋主:批次上鏈 (把 APPROVED 合併進 metadata 簽 setTokenURI) ────────────
  const approved = (stories ?? []).filter((s) => s.status === "APPROVED");

  const handleCommitOnChain = async (): Promise<void> => {
    if (!tablet.metadata) {
      showError("無法上鏈", "這座塔位缺少 metadata,請先到塔位頁補資料。");
      return;
    }
    if (approved.length === 0) return;

    // StoryRecord → Story (上鏈快照形狀)。id 共用作 dedup key。
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
      await buildAndSaveTabletMetadata(
        tablet.metadata,
        { addStories },
        { tokenId, setTokenURI, waitForReceipt, jwt, onStage: setCommitting },
      );
      // 上鏈成功 → 標記這批為 ONCHAIN。
      await commitStories(tokenId, approved.map((s) => s.id), jwt);
      setCommitting(null);
      await reload();
      onChainUpdated?.();
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

  const visibleStories = (stories ?? []).filter((s) =>
    isOwner ? true : s.status === "APPROVED" || s.status === "ONCHAIN",
  );

  return (
    <div className="flex flex-col gap-5">
      {/* 屋主:批次上鏈條 */}
      {isOwner ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
          style={{ background: theme.card, borderColor: `${theme.accent}40` }}
        >
          <p className="text-sm" style={{ color: theme.textMuted }}>
            你是這座塔位的家人。訪客投稿的回憶會先進「待審核」,通過後才會公開;
            按「批次上鏈」把已通過的回憶永久寫進鏈上。
          </p>
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
      ) : null}

      {/* 投稿表單 (所有人) */}
      <StoryComposer
        tokenId={tokenId}
        theme={theme}
        authorAddress={address ?? undefined}
        onCreated={(s) => setStories((prev) => (prev ? [s, ...prev] : [s]))}
      />

      {/* 回憶列表 */}
      {loading && !stories ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: theme.textMuted }} aria-hidden />
        </div>
      ) : visibleStories.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: theme.textMuted }}>
          還沒有人分享回憶。願您是第一位留下故事的人。
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {visibleStories.map((s) => (
            <StoryCard
              key={s.id}
              story={s}
              theme={theme}
              isOwner={isOwner}
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

// ── 投稿表單 ───────────────────────────────────────────────────────────────

function StoryComposer({
  tokenId,
  theme,
  authorAddress,
  onCreated,
}: {
  tokenId: string;
  theme: StoryBoardTheme;
  authorAddress?: string;
  onCreated: (s: StoryRecord) => void;
}): React.ReactElement {
  const { showError } = useError();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [refDate, setRefDate] = React.useState("");
  const [photo, setPhoto] = React.useState<UploadedAsset[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const reset = (): void => {
    setTitle("");
    setBody("");
    setAuthor("");
    setRefDate("");
    setPhoto([]);
  };

  const submit = async (): Promise<void> => {
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      const created = await createStory(tokenId, {
        title: title.trim(),
        body: body.trim(),
        authorName: author.trim() || undefined,
        photoUri: photo[0]?.uri,
        refDate: refDate.trim() || undefined,
      });
      onCreated(created);
      reset();
      setOpen(false);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 503
          ? "目前無法保存回憶 (IPFS 未設定),請稍後再試或聯絡管理者。"
          : e instanceof Error
            ? e.message
            : "投稿失敗";
      showError("分享回憶失敗", msg);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2";
  const inputStyle: React.CSSProperties = {
    background: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.7)",
    borderColor: theme.dark ? "rgba(255,255,255,0.18)" : "rgba(26,24,20,0.18)",
    color: theme.text,
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        className="self-start"
        onClick={() => setOpen(true)}
        style={{ borderColor: `${theme.accent}66`, color: theme.text }}
      >
        <ChevronDown className="h-4 w-4" aria-hidden />
        分享一段回憶
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-4"
      style={{ background: theme.card, borderColor: `${theme.accent}40` }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm font-medium" style={{ color: theme.text }}>
        分享一段關於他的回憶
      </p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="標題(例如:那年夏天的海邊)"
        maxLength={120}
        className={`h-9 ${inputClass}`}
        style={inputStyle}
      />
      <RichTextEditor
        value={body}
        onChange={setBody}
        placeholder="把這段回憶寫下來……"
        accent={theme.accent}
        text={theme.text}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="您的稱呼(可空白)"
          maxLength={80}
          className={`h-9 ${inputClass}`}
          style={inputStyle}
        />
        <input
          value={refDate}
          onChange={(e) => setRefDate(e.target.value)}
          placeholder="回憶的日期(可空白,例如 2010 夏)"
          maxLength={40}
          className={`h-9 ${inputClass}`}
          style={inputStyle}
        />
      </div>
      <div className="rounded-md border border-dashed p-3" style={{ borderColor: `${theme.accent}40` }}>
        <MediaUploader
          label="附一張照片(可選)"
          accept="image/*"
          multiple={false}
          value={photo}
          onChange={setPhoto}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: theme.textMuted }}>
          {authorAddress ? (
            <>
              以 <code className="font-mono">{truncateAddress(authorAddress)}</code> 投稿;
            </>
          ) : (
            "未連線錢包,將以訪客身份投稿;"
          )}
          投稿後需家人審核才會公開。
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim() || !body.trim() || submitting}>
            {submitting ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3 w-3" aria-hidden />
            )}
            送出
          </Button>
        </div>
      </div>
    </form>
  );
}

// ── 單則回憶卡片 ──────────────────────────────────────────────────────────

function StoryCard({
  story,
  theme,
  isOwner,
  onApprove,
  onReject,
  onDelete,
}: {
  story: StoryRecord;
  theme: StoryBoardTheme;
  isOwner: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const author = story.authorName || (story.authorAddress ? truncateAddress(story.authorAddress) : "訪客");
  const when = new Date(story.createdAt).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (
    <li
      className="overflow-hidden rounded-lg border"
      style={{ background: theme.card, borderColor: `${theme.accent}26` }}
    >
      {story.photoUri ? (
        <a href={ipfsToHttps(story.photoUri)} target="_blank" rel="noreferrer" className="block">
          <img
            src={ipfsToHttps(story.photoUri)}
            alt={story.title}
            className="max-h-80 w-full object-cover"
            loading="lazy"
          />
        </a>
      ) : null}
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-serif text-lg" style={{ color: theme.text }}>
            {story.title}
          </h3>
          <StatusBadge status={story.status} accent={theme.accent} muted={theme.textMuted} />
        </div>
        <StoryBody html={story.body} accent={theme.accent} text={theme.text} />
        <p className="flex items-center justify-between text-xs" style={{ color: theme.textMuted }}>
          <span>
            — {author}
            {story.refDate ? ` · ${story.refDate}` : ""}
          </span>
          <span>{when}</span>
        </p>

        {isOwner ? (
          <div className="mt-1 flex flex-wrap gap-2 border-t pt-2" style={{ borderColor: `${theme.accent}1f` }}>
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
        ) : null}
      </div>
    </li>
  );
}

function StatusBadge({
  status,
  accent,
  muted,
}: {
  status: StoryRecord["status"];
  accent: string;
  muted: string;
}): React.ReactElement | null {
  const map: Record<StoryRecord["status"], { label: string; color: string } | null> = {
    PENDING: { label: "待審核", color: "#c98a2e" },
    REJECTED: { label: "已隱藏", color: muted },
    APPROVED: { label: "已公開", color: accent },
    ONCHAIN: { label: "已上鏈", color: accent },
  };
  const entry = map[status];
  if (!entry) return null;
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 text-[10px]"
      style={{ color: entry.color, borderColor: `${entry.color}55` }}
    >
      {entry.label}
    </span>
  );
}

/**
 * 渲染 story 的富文本內容 (Tiptap 輸出的 HTML)。
 *
 * 安全:HTML 來自訪客投稿,渲染前一律用 DOMPurify 淨化 (擋 XSS)。
 * 只允許基本排版標籤;a 加 rel/target,img 允許但 srcset 等危險屬性被砍。
 */
function StoryBody({
  html,
  accent,
  text,
}: {
  html: string;
  accent: string;
  text: string;
}): React.ReactElement {
  const clean = React.useMemo(
    () =>
      DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          "p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li",
          "blockquote", "h2", "h3", "hr", "span", "img",
        ],
        ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "style"],
        ALLOWED_URI_REGEXP: /^(?:https?:|ipfs:|mailto:|#)/i,
      }),
    [html],
  );
  return (
    <>
      <div
        className="story-html break-words text-sm leading-relaxed"
        style={{ color: text }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      <style jsx global>{`
        .story-html p { margin: 0 0 0.5em; }
        .story-html ul { list-style: disc; padding-left: 1.4em; margin: 0.4em 0; }
        .story-html ol { list-style: decimal; padding-left: 1.4em; margin: 0.4em 0; }
        .story-html blockquote { border-left: 3px solid ${accent}; padding-left: 0.9em; margin: 0.5em 0; }
        .story-html h2 { font-size: 1.25em; font-weight: 600; margin: 0.5em 0 0.3em; }
        .story-html h3 { font-size: 1.1em; font-weight: 600; margin: 0.4em 0 0.3em; }
        .story-html a { color: ${accent}; text-decoration: underline; }
        .story-html hr { border: none; border-top: 1px solid ${accent}55; margin: 0.8em 0; }
        .story-html img { max-width: 100%; border-radius: 6px; margin: 0.4em 0; }
      `}</style>
    </>
  );
}
