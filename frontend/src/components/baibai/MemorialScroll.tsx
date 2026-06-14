"use client";

/**
 * 線上追悼頁 (ForeverMissed 版面復刻)。
 *
 * 結構:
 *   - Hero banner(上半部背景牆):heroBg 漸層/heroVideo 影片 + 動態粒子層(櫻花/燭光/星…)
 *     + 右側頭貼白框卡 + 姓名/生卒。只佔頂部,banner 之下回乾淨淺底。
 *   - 水平 Tab:About / Life / Gallery / Stories(FM 式底線分頁)。
 *       About    墓誌銘 + 基本資料 + 留言板(供品小物)+ 點香/三鞠躬儀式 + 與他對話
 *       Life     生平 biography
 *       Gallery  照片牆
 *       Stories  哀悼版(Tiptap 投稿 + 屋主審核 + 批次上鏈)
 *
 * 主題只套在 banner 與強調色;內容區維持乾淨淺底,確保可讀。
 */
import * as React from "react";
import { useAccount } from "wagmi";
import { ChevronLeft, MessagesSquare, Flame } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { PersonaActivationModal } from "@/components/PersonaActivationModal";
import { displayName, formatDate, ipfsToHttps, shortName } from "@/lib/utils";
import type { TabletRecord } from "@/lib/api";
import { getTheme } from "@/lib/memorial-themes";
import { playBell } from "./bell-sound";
import { TributeBoard } from "./TributeBoard";
import { StoryBoard } from "./StoryBoard";
import { MemorialParticles } from "./MemorialParticles";
import { MemorialHall } from "./MemorialHall";

type MemorialTab = "about" | "life" | "gallery" | "stories";

const TABS: Array<{ id: MemorialTab; label: string }> = [
  { id: "about", label: "ABOUT" },
  { id: "life", label: "LIFE" },
  { id: "gallery", label: "GALLERY" },
  { id: "stories", label: "STORIES" },
];

interface MemorialScrollProps {
  tablet: TabletRecord;
  onExit: () => void;
}

export function MemorialScroll({ tablet, onExit }: MemorialScrollProps): React.ReactElement {
  const { address } = useAccount();
  const meta = tablet.metadata;
  const deceased = meta?.dsas.deceased;
  const portraitUrl = meta?.image ? ipfsToHttps(meta.image) : null;
  const photos = (meta?.dsas.assets?.photos ?? []).map(ipfsToHttps);

  const theme = getTheme(meta?.dsas.background);
  const [tab, setTab] = React.useState<MemorialTab>("about");
  // 進入 3D 靈堂(舊版拜拜畫面):點香 / 三鞠躬 / 留言 / 紀念卡都在那裡做。
  const [hallOpen, setHallOpen] = React.useState(false);
  // 「與他對話」→ 跟燈塔頁同一個互動形式選擇 modal (純文字 / 文字+人像 / 語音)。
  const [activationOpen, setActivationOpen] = React.useState(false);

  const isOwner =
    !!address && !!tablet.owner && address.toLowerCase() === tablet.owner.toLowerCase();

  // 入場一聲鐘
  React.useEffect(() => {
    playBell(220, 5, 0.18);
  }, []);

  // 進入 3D 靈堂 → 全螢幕接管,返回回 2D 追悼頁。
  if (hallOpen) {
    return <MemorialHall tablet={tablet} onExit={() => setHallOpen(false)} />;
  }

  const boardTheme = {
    accent: theme.accent,
    text: theme.text,
    textMuted: theme.textMuted,
    card: theme.card,
    dark: theme.dark,
  };

  return (
    <div className="min-h-screen w-full" style={{ background: theme.background, color: theme.text }}>
      {/* 頂部細工具條 */}
      <div className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onExit}
          className="bg-black/15 backdrop-blur-sm hover:bg-black/25"
          style={{ color: theme.heroText }}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          返回
        </Button>
      </div>

      {/* ── Hero banner(上半部背景牆)──────────────────────────────────────── */}
      <header className="relative w-full overflow-hidden" style={{ minHeight: "44vh" }}>
        {/* 背景牆:影片 > 背景圖 (jpg/gif) > 漸層。圖載入前漸層墊底。 */}
        <div className="absolute inset-0" style={{ background: theme.heroBg }} aria-hidden />
        {theme.heroVideo ? (
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src={theme.heroVideo}
            autoPlay
            loop
            muted
            playsInline
            aria-hidden
          />
        ) : theme.heroImage ? (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${theme.heroImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            aria-hidden
          />
        ) : null}
        {/* 動態粒子層 */}
        <MemorialParticles kind={theme.particles} />
        {/* 罩紗:主題自帶 overlay (photo 背景保文字可讀),缺省用柔光暈 */}
        <div
          className="absolute inset-0"
          style={{
            background:
              theme.overlay ?? "linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0.12))",
          }}
          aria-hidden
        />

        <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between sm:py-20">
          <div className="order-2 text-center sm:order-1 sm:text-left">
            <h1 className="font-serif text-4xl sm:text-5xl" style={{ color: theme.heroText }}>
              {displayName(meta, tablet.tokenId)}
            </h1>
            <p className="mt-2 text-sm" style={{ color: theme.heroText, opacity: 0.85 }}>
              {formatDate(deceased?.birth?.date) || "?"} – {formatDate(deceased?.death?.date) || "?"}
              {deceased?.origin ? ` · ${deceased.origin}` : ""}
            </p>
          </div>

          {/* 頭貼白框卡 */}
          <div className="order-1 sm:order-2">
            {portraitUrl ? (
              <div className="overflow-hidden rounded-xl border-4 border-white/90 shadow-2xl">
                <img
                  src={portraitUrl}
                  alt={shortName(meta, tablet.tokenId)}
                  className="h-48 w-48 object-cover sm:h-56 sm:w-56"
                />
              </div>
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded-xl border-4 border-white/90 bg-white/70 text-sm text-ink-muted shadow-2xl sm:h-56 sm:w-56">
                尚無肖像
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── 水平 Tab 導覽 ─────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-20 border-b backdrop-blur-sm"
        style={{ background: "rgba(255,255,255,0.82)", borderColor: `${theme.accent}26` }}
      >
        <div className="mx-auto flex max-w-3xl items-stretch justify-center gap-1 px-3 sm:gap-6">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="relative px-3 py-3.5 text-sm font-semibold tracking-wide transition-colors sm:px-5"
                style={{ color: active ? theme.text : theme.textMuted }}
              >
                {t.label}
                <span
                  className="absolute inset-x-1 -bottom-px h-0.5 rounded-full transition-all"
                  style={{ background: active ? theme.accent : "transparent" }}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── 內容區(乾淨淺底)─────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-3xl px-5 py-10 pb-24">
        {tab === "about" ? (
          <div className="flex flex-col gap-8">
            {deceased?.epitaph ? (
              <p className="text-center font-serif text-xl italic" style={{ color: theme.text }}>
                「{deceased.epitaph}」
              </p>
            ) : null}

            {/* 基本資料 */}
            <div className="grid gap-2 rounded-xl border p-4 sm:grid-cols-2" style={{ borderColor: `${theme.accent}26`, background: theme.card }}>
              <Fact theme={theme} label="籍貫" value={deceased?.origin} />
              <Fact theme={theme} label="出生" value={`${formatDate(deceased?.birth?.date) || "?"}${deceased?.birth?.place ? ` · ${deceased.birth.place}` : ""}`} />
              <Fact theme={theme} label="辭世" value={`${formatDate(deceased?.death?.date) || "?"}${deceased?.death?.place ? ` · ${deceased.death.place}` : ""}`} />
            </div>

            {/* 進入 3D 靈堂 + 與他對話 */}
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  size="lg"
                  onClick={() => {
                    playBell(262, 4, 0.22);
                    setHallOpen(true);
                  }}
                  style={{ background: theme.accent, color: "#fff" }}
                >
                  <Flame className="h-5 w-5" aria-hidden />
                  進入靈堂祭拜
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setActivationOpen(true)}
                  style={{ borderColor: `${theme.accent}66`, color: theme.text }}
                >
                  <MessagesSquare className="h-5 w-5" aria-hidden />
                  與他對話
                </Button>
              </div>
              <p className="text-xs" style={{ color: theme.textMuted }}>
                進入靈堂可點香、行三鞠躬禮、獻上話語,並下載追思紀念卡。
              </p>
            </div>

            {/* 留言板(供品小物)*/}
            <section>
              <h2 className="mb-4 font-serif text-xl" style={{ color: theme.text }}>
                留言板
              </h2>
              <TributeBoard tokenId={tablet.tokenId} theme={boardTheme} />
            </section>
          </div>
        ) : null}

        {tab === "life" ? (
          deceased?.biography || meta?.description ? (
            <div className="flex flex-col gap-3 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: theme.text }}>
              {deceased?.biography ? <p>{deceased.biography}</p> : null}
              {meta?.description && meta.description !== deceased?.biography ? (
                <p style={{ color: theme.textMuted }}>{meta.description}</p>
              ) : null}
            </div>
          ) : (
            <Empty theme={theme} text="尚未填寫生平。" />
          )
        ) : null}

        {tab === "gallery" ? (
          photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-md"
                  style={{ border: `1px solid ${theme.accent}26` }}
                >
                  <img src={url} alt="" loading="lazy" className="h-40 w-full object-cover transition-transform hover:scale-105" />
                </a>
              ))}
            </div>
          ) : (
            <Empty theme={theme} text="尚無照片。" />
          )
        ) : null}

        {tab === "stories" ? (
          <StoryBoard tablet={tablet} isOwner={isOwner} theme={boardTheme} />
        ) : null}
      </main>

      <PersonaActivationModal
        tokenId={tablet.tokenId}
        metadata={meta}
        open={activationOpen}
        onClose={() => setActivationOpen(false)}
      />
    </div>
  );
}

// ── 子元件 ─────────────────────────────────────────────────────────────────

function Fact({
  theme,
  label,
  value,
}: {
  theme: ReturnType<typeof getTheme>;
  label: string;
  value?: string;
}): React.ReactElement | null {
  if (!value || value.trim() === "" || value === "?") return null;
  return (
    <div className="flex gap-2 text-sm">
      <span style={{ color: theme.textMuted }}>{label}:</span>
      <span style={{ color: theme.text }}>{value}</span>
    </div>
  );
}

function Empty({ theme, text }: { theme: ReturnType<typeof getTheme>; text: string }): React.ReactElement {
  return (
    <div
      className="rounded-md border border-dashed py-10 text-center text-sm"
      style={{ borderColor: `${theme.accent}33`, color: theme.textMuted }}
    >
      {text}
    </div>
  );
}
