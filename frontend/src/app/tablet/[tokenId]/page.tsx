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
 * owner 可在頁頂工具條點「編輯資料」進入 editMode,5 個 Tab 各自就地展開
 * 編輯/上傳 UI(收集到 draft state),改完點「保存上鏈」一次性:
 *   合併 draft 進現有 metadata (merge 不 replace) → buildTabletMetadata
 *   → 序列化成 File 上傳拿新 ipfs uri → setTokenURI 上鏈 → syncTablet + reload。
 * 非編輯態 / 非 owner 維持純展示,外觀完全不變。
 *
 * 進這頁會打 GET /api/tablets/:tokenId,如果 DB 還沒這筆 backend 會
 * lazy sync 從鏈上抓,所以剛 mint 完直接點進來也看得到。
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import {
  Loader2,
  Play,
  Volume2,
  MessagesSquare,
  ImageIcon,
  Pencil,
  Save,
  X,
  Plus,
  Trash2,
  Wand2,
  Check,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { MediaUploader } from "@/components/MediaUploader";
import { PersonaActivationModal } from "@/components/PersonaActivationModal";
import {
  fetchTablet,
  generateClonedVoice,
  ApiError,
  type TabletRecord,
  type UploadedAsset,
} from "@/lib/api";
import { useSetTokenURI, useSiweLogin, useWaitForReceipt } from "@/lib/wallet";
import { buildAndSaveTabletMetadata, type TabletSaveStage } from "@/lib/tablet-save";
import { MEMORIAL_THEMES, getTheme, DEFAULT_THEME } from "@/lib/memorial-themes";
import { displayName, formatDate, ipfsToHttps, shortName, truncateAddress } from "@/lib/utils";
import { useError } from "@/components/ErrorDialog";
import type {
  ChatLogEntry,
  MemorialTheme,
  TabletMetadata,
} from "@shared/types/tablet";

/** 一列子孫快照的編輯狀態 (預填現有,送出時保留 tokenId/wallet)。 */
interface DraftDescendant {
  name: string;
  relation: string;
  tokenId?: number;
  wallet?: string;
}

/** editMode 下收集的所有變更,送出時才合併進現有 metadata。 */
interface Draft {
  bio: string;
  epitaph: string;
  newPhotos: UploadedAsset[];
  newVideos: UploadedAsset[];
  newAudios: UploadedAsset[];
  newChatlogs: UploadedAsset[];
  chatlogPlatform: ChatLogEntry["platform"];
  descendants: DraftDescendant[];
  voiceLabel?: string;
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "building" }
  | { kind: "signing" }
  | { kind: "confirming" }
  | { kind: "syncing" }
  | { kind: "indexing" }
  | { kind: "done" };

/** 從 ipfs:// uri 取一個顯示用的短名 (聲音克隆下拉用)。 */
function uriShortName(uri: string): string {
  const tail = uri.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
  return tail.length > 24 ? `…${tail.slice(-22)}` : tail;
}

/** 從檔名後綴推 ChatLogEntry.format,推不出當 txt。 */
function formatFromName(name: string): ChatLogEntry["format"] {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") return "json";
  if (ext === "html" || ext === "htm") return "html";
  return "txt";
}

function emptyDraft(meta: TabletMetadata | null | undefined): Draft {
  const d = meta?.dsas.deceased;
  const existingDescendants = meta?.dsas.descendants ?? [];
  return {
    bio: d?.biography ?? "",
    epitaph: d?.epitaph ?? "",
    newPhotos: [],
    newVideos: [],
    newAudios: [],
    newChatlogs: [],
    chatlogPlatform: "other",
    descendants: existingDescendants.map((row) => ({
      name: row.name,
      relation: row.relation,
      ...(row.tokenId !== undefined ? { tokenId: row.tokenId } : {}),
      ...(row.wallet ? { wallet: row.wallet } : {}),
    })),
    voiceLabel: meta?.dsas.avatar?.voiceLabel,
  };
}

export default function TabletDetailPage(): React.ReactElement {
  const params = useParams<{ tokenId: string }>();
  const tokenId = params.tokenId;
  const { showError } = useError();
  const { address } = useAccount();
  const [record, setRecord] = React.useState<TabletRecord | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [activationOpen, setActivationOpen] = React.useState(false);

  // ── 就地編輯狀態 ───────────────────────────────────────────────────────
  const [editMode, setEditMode] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => emptyDraft(null));
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>({ kind: "idle" });
  const [voiceSource, setVoiceSource] = React.useState<string>("");
  const [voiceWorking, setVoiceWorking] = React.useState(false);

  const { setTokenURI } = useSetTokenURI(tokenId);
  const waitForReceipt = useWaitForReceipt();
  const { login, logout, token } = useSiweLogin(tokenId);

  // 抽成可複用:補傳上鏈後要重新拉一次,讓頁面反映剛同步的鏈上 metadata。
  const reload = React.useCallback(async (): Promise<void> => {
    try {
      const r = await fetchTablet(tokenId);
      setRecord(r);
    } catch (e) {
      showError("找不到該塔位", e instanceof Error ? e.message : String(e));
    }
  }, [tokenId, showError]);

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

  const isOwner =
    !!address && !!record.owner && address.toLowerCase() === record.owner.toLowerCase();

  const busy =
    saveStatus.kind === "uploading" ||
    saveStatus.kind === "building" ||
    saveStatus.kind === "signing" ||
    saveStatus.kind === "confirming" ||
    saveStatus.kind === "syncing" ||
    saveStatus.kind === "indexing";

  const enterEdit = (): void => {
    setDraft(emptyDraft(meta));
    setVoiceSource("");
    setSaveStatus({ kind: "idle" });
    setEditMode(true);
  };

  const cancelEdit = (): void => {
    if (busy) return;
    setEditMode(false);
    setSaveStatus({ kind: "idle" });
  };

  const patchDraft = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }));

  // 聲音克隆下拉的可選來源 = 現有 audios + 本次新加 audios (都是 ipfs:// uri)。
  const audioChoices: string[] = [
    ...(assets?.audios ?? []),
    ...draft.newAudios.map((a) => a.uri),
  ];

  // ── 聲音克隆:從 ipfs uri fetch blob → 克隆 (需 SIWE jwt,401 重簽重試) ──
  // sourceUri 顯式傳入要克隆的那段音頻 (上傳後自動觸發用最新一段;手動按鈕用下拉選的)。
  const handleCloneVoice = async (sourceUri: string): Promise<void> => {
    if (!sourceUri) return;
    setVoiceWorking(true);
    try {
      const res = await fetch(ipfsToHttps(sourceUri));
      if (!res.ok) throw new Error(`無法讀取音檔 (${res.status})`);
      const blob = await res.blob();
      const label = `dsas_voice_${tokenId}`;

      let result;
      try {
        const jwt = token ?? (await login());
        result = await generateClonedVoice(blob, label, jwt);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          const jwt = await login();
          result = await generateClonedVoice(blob, label, jwt);
        } else {
          throw err;
        }
      }

      patchDraft({ voiceLabel: result.label });
      setVoiceSource(sourceUri);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? "需要簽署登入訊息才能克隆聲音 (請在錢包中確認簽名)。"
            : `克隆失敗:${e.message}`
          : e instanceof Error
            ? e.message
            : "克隆失敗";
      showError("生成克隆聲音失敗", msg);
    } finally {
      setVoiceWorking(false);
    }
  };

  // 上傳錄音後自動克隆:用戶在影音 Tab 傳完錄音 → 自動拿最新一段跑 IndexTTS2 克隆,
  // 不必再手動點按鈕 (上傳音檔 ≠ 克隆聲音 這件事對用戶不直覺)。已克隆過 / 正在克隆
  // 則不重複觸發;要換音源可用下方下拉 + 手動按鈕重新克隆。
  const handleAudiosChange = (v: UploadedAsset[]): void => {
    const prevCount = draft.newAudios.length;
    patchDraft({ newAudios: v });
    const added = v.length > prevCount ? v[v.length - 1] : null;
    if (added && !draft.voiceLabel && !voiceWorking) {
      void handleCloneVoice(added.uri);
    }
  };

  /**
   * 把 draft 合併進現有 metadata,重組後上鏈。
   *
   * 合併 / build / pin / 簽名 / sync / 重建索引 都委派給共用的
   * buildAndSaveTabletMetadata (lib/tablet-save.ts) —— 與追悼頁批次上鏈同一條
   * 路徑,避免兩份合併邏輯漂移。這裡只負責把 draft 轉成 patch + 顯示進度。
   */
  const handleSave = async (): Promise<void> => {
    if (!meta) return;
    try {
      await buildAndSaveTabletMetadata(
        meta,
        {
          bio: draft.bio,
          epitaph: draft.epitaph,
          newPhotos: draft.newPhotos.map((a) => a.uri),
          newVideos: draft.newVideos.map((a) => a.uri),
          newAudios: draft.newAudios.map((a) => a.uri),
          newChatlogs: draft.newChatlogs.map((a) => ({
            platform: draft.chatlogPlatform,
            uri: a.uri,
            format: formatFromName(a.name),
          })),
          descendants: draft.descendants
            .filter((d) => d.name.trim() && d.relation.trim())
            .map((d) => ({
              name: d.name.trim(),
              relation: d.relation.trim(),
              ...(d.tokenId !== undefined ? { tokenId: d.tokenId } : {}),
              ...(d.wallet ? { wallet: d.wallet } : {}),
            })),
          ...(draft.voiceLabel ? { voiceLabel: draft.voiceLabel } : {}),
          // 注意:background / public 不在這條路徑動 —— 它們由「公開頁」Tab 獨立管理。
          // 不傳 = 合併時保留現有值,避免兩條存檔路徑互相覆蓋。
        },
        {
          tokenId,
          setTokenURI,
          waitForReceipt,
          jwt: token ?? undefined,
          onStage: (stage) => setSaveStatus({ kind: stage }),
        },
      );

      setSaveStatus({ kind: "done" });
      await reload();
      setEditMode(false);
      setSaveStatus({ kind: "idle" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失敗";
      showError("保存上鏈失敗", msg);
      setSaveStatus({ kind: "idle" });
    }
  };

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

      {/* 編輯工具條:owner 才顯示。錨點 #supplement 供聊天頁
          「還沒上傳克隆資料」時跳轉過來 (掛在這個容器上以維持連結有效)。 */}
      <div id="supplement" className="mb-4 scroll-mt-20">
        {isOwner ? (
          !editMode ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-ink/10 bg-paper-soft/40 px-4 py-3">
              <p className="text-sm text-ink-muted">
                這座塔位由你持有,可補上生平、照片、影音、子孫與對話紀錄,並生成克隆聲音。
              </p>
              <Button variant="secondary" size="sm" onClick={enterEdit}>
                <Pencil className="h-4 w-4" aria-hidden />
                編輯資料
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-gold/40 bg-gold/5 px-4 py-3">
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                disabled={busy}
                onClick={() => void handleSave()}
              >
                <Save className="h-4 w-4" aria-hidden />
                保存上鏈
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={cancelEdit}>
                <X className="h-4 w-4" aria-hidden />
                取消
              </Button>
              <span className="text-sm text-ink">
                {saveStatus.kind === "uploading"
                  ? "上傳素材中……"
                  : saveStatus.kind === "building"
                    ? "重組 metadata 中……"
                    : saveStatus.kind === "signing"
                      ? "請在錢包簽名……"
                      : saveStatus.kind === "confirming"
                        ? "等待上鏈確認(約 12 秒)……"
                        : saveStatus.kind === "syncing"
                          ? "同步鏈上資料中……"
                        : saveStatus.kind === "indexing"
                          ? "重建記憶索引中(把對話紀錄轉成 AI 可檢索的記憶)……"
                          : saveStatus.kind === "done"
                            ? "完成 ✓"
                            : "編輯中:改完後一次保存並上鏈,新內容會合併進現有記憶。"}
              </span>
            </div>
          )
        ) : null}
      </div>

      <Tabs defaultValue="public">
        <TabsList>
          <TabsTrigger value="public">公開頁</TabsTrigger>
          <TabsTrigger value="bio">生平</TabsTrigger>
          <TabsTrigger value="photos">照片牆</TabsTrigger>
          <TabsTrigger value="av">影音</TabsTrigger>
          <TabsTrigger value="descendants">子孫</TabsTrigger>
          <TabsTrigger value="chatlogs">對話紀錄</TabsTrigger>
        </TabsList>

        <TabsContent value="public">
          <MemorialSettingsTab
            tokenId={tokenId}
            meta={meta}
            isOwner={isOwner}
            setTokenURI={setTokenURI}
            waitForReceipt={waitForReceipt}
            jwt={token}
            onSaved={reload}
          />
        </TabsContent>

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
              {editMode ? (
                <div className="mt-2 flex flex-col gap-4 border-t border-ink/10 pt-4">
                  <Textarea
                    label="生平"
                    rows={5}
                    value={draft.bio}
                    onChange={(e) => patchDraft({ bio: e.target.value })}
                  />
                  <Textarea
                    label="墓誌銘 / 一句話的人生"
                    rows={2}
                    value={draft.epitaph}
                    onChange={(e) => patchDraft({ epitaph: e.target.value })}
                  />
                </div>
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
          {editMode ? (
            <div className="mt-4 rounded-md border border-dashed border-ink/15 bg-paper-soft/30 p-4">
              <MediaUploader
                label="新增照片"
                description="會 append 到現有照片,不覆蓋。"
                accept="image/*"
                multiple
                value={draft.newPhotos}
                onChange={(v) => patchDraft({ newPhotos: v })}
              />
            </div>
          ) : null}
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
                {editMode ? (
                  <div className="mt-1 border-t border-ink/10 pt-3">
                    <MediaUploader
                      label="新增影片"
                      accept="video/*"
                      multiple
                      value={draft.newVideos}
                      onChange={(v) => patchDraft({ newVideos: v })}
                    />
                  </div>
                ) : null}
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
                {editMode ? (
                  <>
                    <div className="mt-1 border-t border-ink/10 pt-3">
                      <MediaUploader
                        label="新增錄音(上傳後會自動生成克隆聲音)"
                        accept="audio/*"
                        multiple
                        value={draft.newAudios}
                        onChange={handleAudiosChange}
                      />
                    </div>
                    <div className="mt-2 flex flex-col gap-2 rounded-md border border-ink/10 bg-paper-soft/40 p-3">
                      <h4 className="text-sm font-semibold text-ink">克隆聲音</h4>
                      <p className="text-xs text-ink-muted">
                        上傳一段清晰錄音後,系統會自動用它生成逝者專屬克隆聲音,日後對話就用他/她的聲音回應。
                      </p>

                      {/* 狀態:克隆中 / 已完成 / 失敗未生成 */}
                      {voiceWorking ? (
                        <div className="flex items-center gap-2 text-sm text-ink">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          <span>正在生成克隆聲音(IndexTTS2,可能需要幾十秒)……</span>
                        </div>
                      ) : draft.voiceLabel ? (
                        <div className="flex items-center gap-2 text-sm text-emerald-700">
                          <Check className="h-4 w-4" aria-hidden />
                          <span>
                            已生成克隆聲音 ✓ (<code className="text-xs">{draft.voiceLabel}</code>),保存上鏈後生效。
                          </span>
                        </div>
                      ) : audioChoices.length > 0 ? (
                        <p className="text-xs text-amber-700">
                          有錄音但還沒生成克隆聲音 —— 在下方挑一段點「生成克隆聲音」即可。
                        </p>
                      ) : null}

                      {/* 手動兜底:換音源重新克隆 / 自動沒觸發時補救 */}
                      <div className="mt-1 flex flex-col gap-2">
                        <label className="text-xs text-ink-muted">
                          {draft.voiceLabel ? "想換一段錄音重新克隆?" : "手動選一段錄音克隆:"}
                        </label>
                        <select
                          value={voiceSource}
                          onChange={(e) => setVoiceSource(e.target.value)}
                          className="h-10 rounded-md border border-ink/20 bg-paper px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
                        >
                          <option value="">— 請選擇一段音頻 —</option>
                          {audioChoices.map((uri) => (
                            <option key={uri} value={uri}>
                              {uriShortName(uri)}
                            </option>
                          ))}
                        </select>
                        {audioChoices.length === 0 ? (
                          <p className="text-xs text-ink-muted">尚無音頻可用,請先在上方新增錄音。</p>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!voiceSource || voiceWorking}
                          onClick={() => void handleCloneVoice(voiceSource)}
                          className="self-start"
                        >
                          {voiceWorking ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Wand2 className="h-4 w-4" aria-hidden />
                          )}
                          {draft.voiceLabel ? "用這段重新克隆" : "生成克隆聲音"}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
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
          {editMode ? (
            <div className="mt-4 flex flex-col gap-3 rounded-md border border-dashed border-ink/15 bg-paper-soft/30 p-4">
              <h4 className="text-sm font-semibold text-ink">編輯子孫紀錄</h4>
              {draft.descendants.length === 0 ? (
                <p className="text-sm text-ink-muted">目前尚無子孫資料。</p>
              ) : null}
              {draft.descendants.map((row, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 rounded-md border border-ink/10 bg-paper p-3 sm:grid-cols-[1.2fr_1fr_auto]"
                >
                  <Input
                    placeholder="姓名"
                    value={row.name}
                    onChange={(e) =>
                      patchDraft({
                        descendants: draft.descendants.map((r, i) =>
                          i === idx ? { ...r, name: e.target.value } : r,
                        ),
                      })
                    }
                  />
                  <Input
                    placeholder="關係(長子 / 長孫)"
                    value={row.relation}
                    onChange={(e) =>
                      patchDraft({
                        descendants: draft.descendants.map((r, i) =>
                          i === idx ? { ...r, relation: e.target.value } : r,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="移除此列"
                    onClick={() =>
                      patchDraft({
                        descendants: draft.descendants.filter((_, i) => i !== idx),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  patchDraft({
                    descendants: [...draft.descendants, { name: "", relation: "" }],
                  })
                }
              >
                <Plus className="h-4 w-4" aria-hidden />
                新增
              </Button>
            </div>
          ) : null}
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
              {editMode ? (
                <div className="mt-3 flex flex-col gap-3 border-t border-ink/10 pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-ink" htmlFor="chatlog-platform">
                      平台
                    </label>
                    <select
                      id="chatlog-platform"
                      value={draft.chatlogPlatform}
                      onChange={(e) =>
                        patchDraft({
                          chatlogPlatform: e.target.value as ChatLogEntry["platform"],
                        })
                      }
                      className="h-10 w-48 rounded-md border border-ink/20 bg-paper px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
                    >
                      <option value="line">LINE</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="facebook">Facebook</option>
                      <option value="instagram">Instagram</option>
                      <option value="telegram">Telegram</option>
                      <option value="discord">Discord</option>
                      <option value="other">其他</option>
                    </select>
                  </div>
                  <MediaUploader
                    label="上傳對話紀錄"
                    description="支援 .json / .txt / .html,格式會依副檔名判斷。"
                    accept=".json,.txt,.html"
                    multiple
                    value={draft.newChatlogs}
                    onChange={(v) => patchDraft({ newChatlogs: v })}
                  />
                </div>
              ) : null}
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

/**
 * 「公開頁」Tab —— 獨立於主編輯流程的追悼頁設定。
 *
 * 任何人都能看到:目前主題、公開狀態、追悼頁連結 (公開時)。
 * owner 額外能:切背景主題、開關「公開」,按「套用並上鏈」一鍵簽名上鏈
 * (走共用 buildAndSaveTabletMetadata,只動 background/public 兩欄,其餘原封保留)。
 *
 * 這個 Tab 有自己的本地 state 與存檔,不依賴上方的「編輯資料」流程 —— 讓
 * 「公開」這件事成為一個獨立、隨時可改的分類。
 */
function MemorialSettingsTab({
  tokenId,
  meta,
  isOwner,
  setTokenURI,
  waitForReceipt,
  jwt,
  onSaved,
}: {
  tokenId: string;
  meta: TabletMetadata | null | undefined;
  isOwner: boolean;
  setTokenURI: (uri: string) => Promise<`0x${string}`>;
  waitForReceipt: (hash: `0x${string}`) => Promise<void>;
  jwt: string | null;
  onSaved: () => Promise<void> | void;
}): React.ReactElement {
  const { showError } = useError();
  const currentTheme = meta?.dsas.background ?? DEFAULT_THEME;
  const currentPublic = meta?.dsas.public ?? false;

  const [theme, setTheme] = React.useState<MemorialTheme>(currentTheme);
  const [isPublic, setIsPublic] = React.useState<boolean>(currentPublic);
  const [stage, setStage] = React.useState<TabletSaveStage | null>(null);

  // meta 重載後 (例如存完 reload) 把本地 state 重新對齊鏈上值。
  React.useEffect(() => {
    setTheme(currentTheme);
    setIsPublic(currentPublic);
  }, [currentTheme, currentPublic]);

  const dirty = theme !== currentPublicTheme(meta) || isPublic !== currentPublic;
  const busy = stage !== null;
  const previewUrl = typeof window !== "undefined" ? `${window.location.origin}/baibai` : "/baibai";

  const handleApply = async (): Promise<void> => {
    if (!meta) {
      showError("無法上鏈", "這座塔位缺少 metadata,請先到其他 Tab 補基本資料。");
      return;
    }
    try {
      await buildAndSaveTabletMetadata(
        meta,
        { background: theme, public: isPublic },
        {
          tokenId,
          setTokenURI,
          waitForReceipt,
          jwt: jwt ?? undefined,
          onStage: setStage,
        },
      );
      setStage(null);
      await onSaved();
    } catch (e) {
      setStage(null);
      const msg = e instanceof Error ? e.message : "套用失敗";
      showError("套用並上鏈失敗", msg);
    }
  };

  const themeDef = getTheme(theme);

  return (
    <div className="flex flex-col gap-4">
      {/* 狀態總覽 (所有人可見) */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="h-12 w-16 shrink-0 rounded"
              style={{ background: themeDef.background, border: `1px solid ${themeDef.accent}66` }}
            />
            <div className="flex flex-col">
              <span className="text-sm text-ink">
                目前主題:<strong>{themeDef.label}</strong>
              </span>
              <span className="text-sm">
                {currentPublic ? (
                  <span className="text-emerald-700">● 已公開 — 出現在線上紀念館</span>
                ) : (
                  <span className="text-ink-muted">○ 未公開 — 僅持有連結者可見</span>
                )}
              </span>
            </div>
          </div>
          {currentPublic ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-gold-dark underline underline-offset-2"
            >
              前往線上紀念館
            </a>
          ) : null}
        </CardContent>
      </Card>

      {/* owner 控制 */}
      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">外觀與公開設定</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">追悼頁背景主題</span>
              <div className="flex flex-wrap gap-2">
                {MEMORIAL_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setTheme(t.id)}
                    aria-pressed={theme === t.id}
                    className={`flex flex-col items-center gap-1 rounded-md border p-1.5 text-xs transition-all disabled:opacity-50 ${
                      theme === t.id ? "border-gold ring-2 ring-gold/40" : "border-ink/15 hover:border-gold/50"
                    }`}
                    title={t.label}
                  >
                    <span
                      className="h-10 w-14 rounded"
                      style={{ background: t.background, border: `1px solid ${t.accent}55` }}
                    />
                    <span className="text-ink-muted">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-md border border-ink/10 bg-paper-soft/40 p-3">
              <input
                type="checkbox"
                checked={isPublic}
                disabled={busy}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-gold"
              />
              <span className="flex flex-col text-sm">
                <span className="font-medium text-ink">公開追悼頁</span>
                <span className="text-xs text-ink-muted">
                  勾選後,這座塔位會出現在線上紀念館,任何人都能進來追思、留言、分享回憶;
                  取消則只有持有連結的人能看。需「套用並上鏈」後生效。
                </span>
              </span>
            </label>

            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" loading={busy} disabled={busy || !dirty} onClick={() => void handleApply()}>
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
                              : dirty
                                ? "有未套用的變更"
                                : "主題與公開狀態都是最新的。"}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-ink-muted">這座塔位的外觀與公開設定由持有者管理。</p>
      )}
    </div>
  );
}

/** 取現有 metadata 的主題 (缺省回 DEFAULT_THEME) — 給 dirty 比對用。 */
function currentPublicTheme(meta: TabletMetadata | null | undefined): MemorialTheme {
  return meta?.dsas.background ?? DEFAULT_THEME;
}
