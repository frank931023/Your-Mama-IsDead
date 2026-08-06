"use client";

/**
 * 「外觀與公開」設定 —— 追悼頁的總管理面板(燈塔管理頁用)。
 *
 * 兩塊、兩種儲存路徑:
 *   1. 隱私模式 (公開 / 不公開 / 私人) + 邀請碼 — DB-only,按了即生效
 *      (免簽名免 gas;邀請碼不能上鏈,鏈上/IPFS 全世界可讀)。
 *      - 公開:列在線上紀念館,任何人可看
 *      - 不公開:不列出;把「邀請連結」傳給親友,憑碼看哀悼版/拜拜/對話
 *      - 私人:僅屋主;邀請碼失效、公祭房間關閉
 *   2. 背景主題 — 寫進鏈上 metadata (setTokenURI),「套用並上鏈」簽名。
 */
import * as React from "react";
import { Check, Copy, Globe2, KeyRound, Loader2, Lock, RefreshCw, Save, Users } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { useError } from "@/components/ErrorDialog";
import { buildAndSaveTabletMetadata, type TabletSaveStage } from "@/lib/tablet-save";
import { MEMORIAL_THEMES, getTheme, DEFAULT_THEME } from "@/lib/memorial-themes";
import {
  fetchInviteInfo,
  regenerateInviteCode,
  setTabletVisibility,
  ApiError,
  type TabletVisibility,
} from "@/lib/api";
import type { MemorialTheme, TabletMetadata } from "@shared/types/tablet";

export interface MemorialSettingsProps {
  tokenId: string;
  meta: TabletMetadata | null | undefined;
  isOwner: boolean;
  setTokenURI: (uri: string) => Promise<`0x${string}`>;
  waitForReceipt: (hash: `0x${string}`) => Promise<void>;
  jwt: string | null;
  /** 需要 owner jwt 時取得 (沒有就觸發 SIWE 簽名)。 */
  requestJwt: () => Promise<string>;
  onSaved: () => Promise<void> | void;
}

const VISIBILITY_OPTIONS: Array<{
  id: TabletVisibility;
  label: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "PUBLIC",
    label: "公開",
    desc: "列在線上紀念館,任何人都能進來追思、留言、分享回憶。",
    Icon: Globe2,
  },
  {
    id: "UNLISTED",
    label: "不公開",
    desc: "不公開列出。把邀請連結傳給親友,憑邀請碼即可追思、拜拜與對話。",
    Icon: Users,
  },
  {
    id: "PRIVATE",
    label: "私人",
    desc: "僅你本人 (連錢包驗證) 可進入;邀請碼失效、線上公祭關閉。",
    Icon: Lock,
  },
];

export function MemorialSettings({
  tokenId,
  meta,
  isOwner,
  setTokenURI,
  waitForReceipt,
  jwt,
  requestJwt,
  onSaved,
}: MemorialSettingsProps): React.ReactElement {
  const { showError } = useError();

  // ── 隱私模式 + 邀請碼 (DB,即時) ─────────────────────────────────────────
  const [visibility, setVisibility] = React.useState<TabletVisibility | null>(null);
  const [inviteCode, setInviteCode] = React.useState<string>("");
  const [privacyBusy, setPrivacyBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // 載入目前狀態 (owner 端點,需 jwt — 沒有就先簽一次)
  React.useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const j = jwt ?? (await requestJwt());
        const info = await fetchInviteInfo(tokenId, j);
        if (!cancelled) {
          setVisibility(info.visibility);
          setInviteCode(info.code);
        }
      } catch {
        /* 使用者拒簽就先不顯示;點選模式時會再要一次 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, isOwner]);

  const withJwt = async <T,>(fn: (j: string) => Promise<T>): Promise<T> => {
    const j = jwt ?? (await requestJwt());
    try {
      return await fn(j);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const fresh = await requestJwt();
        return await fn(fresh);
      }
      throw err;
    }
  };

  const changeVisibility = async (v: TabletVisibility): Promise<void> => {
    if (privacyBusy || v === visibility) return;
    setPrivacyBusy(true);
    try {
      const info = await withJwt((j) => setTabletVisibility(tokenId, v, j));
      setVisibility(info.visibility);
      setInviteCode(info.code);
      await onSaved();
    } catch (e) {
      showError("切換失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setPrivacyBusy(false);
    }
  };

  const regenerate = async (): Promise<void> => {
    if (privacyBusy) return;
    setPrivacyBusy(true);
    try {
      const info = await withJwt((j) => regenerateInviteCode(tokenId, j));
      setInviteCode(info.code);
    } catch (e) {
      showError("重新產生失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setPrivacyBusy(false);
    }
  };

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/memorial/${tokenId}?code=${inviteCode}`
      : "";

  const copyInvite = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      showError("複製失敗", "請手動選取連結複製。");
    }
  };

  // ── 背景主題 (鏈上) ──────────────────────────────────────────────────────
  const currentTheme = meta?.dsas.background ?? DEFAULT_THEME;
  const [theme, setTheme] = React.useState<MemorialTheme>(currentTheme);
  const [stage, setStage] = React.useState<TabletSaveStage | null>(null);

  React.useEffect(() => {
    setTheme(currentTheme);
  }, [currentTheme]);

  const themeDirty = theme !== currentTheme;
  const themeBusy = stage !== null;

  const applyTheme = async (): Promise<void> => {
    if (!meta) {
      showError("無法上鏈", "這座塔位缺少 metadata,請先到燈塔頁補基本資料。");
      return;
    }
    try {
      await buildAndSaveTabletMetadata(
        meta,
        { background: theme },
        { tokenId, setTokenURI, waitForReceipt, jwt: jwt ?? undefined, onStage: setStage },
      );
      setStage(null);
      await onSaved();
    } catch (e) {
      setStage(null);
      showError("套用並上鏈失敗", e instanceof Error ? e.message : String(e));
    }
  };

  const themeDef = getTheme(theme);

  if (!isOwner) {
    return <p className="text-sm text-ink-muted">這座塔位的外觀與公開設定由持有者管理。</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── 隱私模式 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">隱私模式</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {VISIBILITY_OPTIONS.map((opt) => {
              const active = visibility === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={privacyBusy || visibility === null}
                  onClick={() => void changeVisibility(opt.id)}
                  aria-pressed={active}
                  className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all disabled:opacity-60 ${
                    active
                      ? "border-gold bg-gold/10 ring-1 ring-gold/50"
                      : "border-ink/15 hover:border-gold/50"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    <opt.Icon className="h-4 w-4 text-gold-dark" aria-hidden />
                    {opt.label}
                    {active ? <Check className="h-3.5 w-3.5 text-gold-dark" aria-hidden /> : null}
                  </span>
                  <span className="text-xs leading-relaxed text-ink-muted">{opt.desc}</span>
                </button>
              );
            })}
          </div>
          {visibility === null ? (
            <p className="text-xs text-ink-muted">
              讀取隱私狀態需要簽署一次登入訊息;若剛才取消了,點任一模式會再詢問。
            </p>
          ) : (
            <p className="text-xs text-ink-muted">切換立即生效,不需簽名、不耗 gas。</p>
          )}
        </CardContent>
      </Card>

      {/* ── 邀請碼 (不公開模式的入場憑證) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-gold-dark" aria-hidden />
            邀請碼
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {inviteCode ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <code className="rounded-md border border-ink/15 bg-paper-soft px-4 py-2 font-mono text-lg tracking-[0.25em] text-ink">
                  {inviteCode}
                </code>
                <Button variant="outline" size="sm" disabled={privacyBusy} onClick={() => void copyInvite()}>
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied ? "已複製" : "複製邀請連結"}
                </Button>
                <Button variant="ghost" size="sm" disabled={privacyBusy} onClick={() => void regenerate()}>
                  <RefreshCw className={`h-4 w-4 ${privacyBusy ? "animate-spin" : ""}`} aria-hidden />
                  重新產生
                </Button>
              </div>
              <p className="break-all text-xs text-ink-muted">{inviteUrl}</p>
              <p className="text-xs text-ink-muted">
                {visibility === "UNLISTED"
                  ? "把上面的連結傳給親友 — 開啟即自動帶碼,可追思、拜拜、與他對話。"
                  : visibility === "PRIVATE"
                    ? "私人模式下邀請碼暫時無效;切回「不公開」即恢復。"
                    : "公開模式下人人可看;邀請碼另可讓親友「與他對話」(對話預設僅屋主)。"}
                {" "}重新產生後舊碼立即失效。
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">簽署登入後即可查看邀請碼。</p>
          )}
        </CardContent>
      </Card>

      {/* ── 背景主題 (上鏈) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">追悼頁背景主題</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {MEMORIAL_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={themeBusy}
                onClick={() => setTheme(t.id)}
                aria-pressed={theme === t.id}
                className={`flex flex-col items-center gap-1 rounded-md border p-1.5 text-xs transition-all disabled:opacity-50 ${
                  theme === t.id ? "border-gold ring-2 ring-gold/40" : "border-ink/15 hover:border-gold/50"
                }`}
                title={t.label}
              >
                <span
                  className="h-10 w-14 rounded"
                  style={{
                    background: t.heroImage ? `url(${t.heroImage}) center/cover` : t.background,
                    border: `1px solid ${t.accent}55`,
                  }}
                />
                <span className="text-ink-muted">{t.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={themeBusy}
              disabled={themeBusy || !themeDirty}
              onClick={() => void applyTheme()}
            >
              <Save className="h-4 w-4" aria-hidden />
              套用並上鏈
            </Button>
            <span className="text-sm text-ink-muted">
              {stage === "building"
                ? "重組 metadata 中……"
                : stage === "uploading"
                  ? "上傳中……"
                  : stage === "signing"
                    ? "請在錢包簽名……"
                    : stage === "confirming"
                      ? "等待上鏈確認(約 12 秒)……"
                      : stage === "syncing"
                        ? "同步鏈上資料中……"
                        : stage === "indexing"
                          ? "重建記憶索引中……"
                          : stage === "done"
                            ? "完成 ✓"
                            : themeDirty
                              ? `已選「${themeDef.label}」,尚未上鏈`
                              : "主題已是最新。"}
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            主題寫進鏈上 metadata (需簽名);隱私模式與邀請碼只存在伺服器 — 邀請碼一旦上鏈就等於公開,故不上鏈。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
