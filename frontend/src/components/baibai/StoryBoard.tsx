"use client";

/**
 * 哀悼版 (Memorial Stories) —— 公開展示 + 投稿。
 *
 * 任何人 (訪客或屋主) 都能投稿一段回憶 (標題＋內文＋可選照片＋作者＋日期)。
 * 投稿後內容由後端 pin 到 IPFS、狀態 PENDING,要屋主審核過才公開可見。
 *
 * 這裡只負責「看」與「投稿」:審核 (通過 / 隱藏 / 刪除) 與批次上鏈
 * 都集中在燈塔典藏的管理頁 (/dashboard/[tokenId]),哀悼版維持純展示
 * — 屋主在公開頁看到的內容與訪客一致,管理動作不混進追悼的氛圍裡。
 */
import * as React from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import DOMPurify from "dompurify";
import { Loader2, Send, ChevronDown, Settings2 } from "lucide-react";

import { RichTextEditor } from "./RichTextEditor";
import { getStoredInviteCode } from "@/lib/invite";

import { Button } from "@/components/ui/Button";
import { MediaUploader } from "@/components/MediaUploader";
import { useError } from "@/components/ErrorDialog";
import { ipfsToHttps, truncateAddress } from "@/lib/utils";
import {
  listStories,
  createStory,
  ApiError,
  type StoryRecord,
  type TabletRecord,
  type UploadedAsset,
} from "@/lib/api";

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
}

export function StoryBoard({ tablet, isOwner, theme }: StoryBoardProps): React.ReactElement {
  const tokenId = tablet.tokenId;
  const { address } = useAccount();
  const { showError } = useError();

  const [stories, setStories] = React.useState<StoryRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  // 公開列表 (APPROVED + ONCHAIN)。屋主視角也一樣 — 審核去管理頁。
  React.useEffect(() => {
    let cancelled = false;
    listStories(tokenId)
      .then((rows) => {
        if (!cancelled) setStories(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) showError("讀取回憶失敗", e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, showError]);

  return (
    <div className="flex flex-col gap-5">
      {/* 屋主:導向燈塔典藏的管理頁 */}
      {isOwner ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
          style={{ background: theme.card, borderColor: `${theme.accent}40` }}
        >
          <p className="text-sm" style={{ color: theme.textMuted }}>
            你是這座燈塔的家人。訪客投稿的回憶需要審核才會出現在這裡 —
            審核與上鏈請到燈塔典藏的管理頁。
          </p>
          <Link href={`/dashboard/${tokenId}`}>
            <Button size="sm" variant="secondary">
              <Settings2 className="h-4 w-4" aria-hidden />
              前往管理
            </Button>
          </Link>
        </div>
      ) : null}

      {/* 投稿表單 (所有人) */}
      <StoryComposer
        tokenId={tokenId}
        theme={theme}
        authorAddress={address ?? undefined}
        onCreated={() => undefined}
      />

      {/* 回憶列表 */}
      {loading && !stories ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: theme.textMuted }} aria-hidden />
        </div>
      ) : !stories || stories.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: theme.textMuted }}>
          還沒有公開的回憶。願您是第一位留下故事的人。
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {stories.map((s) => (
            <StoryCard key={s.id} story={s} theme={theme} />
          ))}
        </ul>
      )}
    </div>
  );
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
  const [submitted, setSubmitted] = React.useState(false);

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
      const created = await createStory(
        tokenId,
        {
          title: title.trim(),
          body: body.trim(),
          authorName: author.trim() || undefined,
          photoUri: photo[0]?.uri,
          refDate: refDate.trim() || undefined,
        },
        getStoredInviteCode(tokenId),
      );
      onCreated(created);
      reset();
      setOpen(false);
      setSubmitted(true);
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
      <div className="flex flex-col gap-2 self-start">
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setOpen(true)}
          style={{ borderColor: `${theme.accent}66`, color: theme.text }}
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
          分享一段回憶
        </Button>
        {submitted ? (
          <p className="text-xs" style={{ color: theme.textMuted }}>
            已收到您的回憶,家人審核後就會公開出現在這裡。謝謝您留下這段故事。
          </p>
        ) : null}
      </div>
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
}: {
  story: StoryRecord;
  theme: StoryBoardTheme;
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
        <h3 className="font-serif text-lg" style={{ color: theme.text }}>
          {story.title}
        </h3>
        <StoryBody html={story.body} accent={theme.accent} text={theme.text} />
        <p className="flex items-center justify-between text-xs" style={{ color: theme.textMuted }}>
          <span>
            — {author}
            {story.refDate ? ` · ${story.refDate}` : ""}
          </span>
          <span>{when}</span>
        </p>
      </div>
    </li>
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
