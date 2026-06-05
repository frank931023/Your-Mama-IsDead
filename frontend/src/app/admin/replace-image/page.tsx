"use client";

/**
 * 一次性小工具:更換 / 撤換燈塔總覽的肖像圖 (/admin/replace-image)
 *
 * 為什麼需要這頁
 * ──────────────
 * 「燈塔總覽」卡片的圖 = 鏈上 metadata 的 `image` 欄位。現有「補傳區」
 * (TabletSupplementUploader) 是**故意沿用舊 image 的**(見其 handleSave 裡
 * 「補傳不換大頭照」),所以無法用來換圖。這頁補上那個缺口:
 *
 *   輸入 tokenId → fetchTablet 抓鏈上 metadata → 顯示「舊肖像 CID」(供 unpin)
 *   → 上傳新肖像 → 重組 metadata(保留所有其他欄位,只換 image / assets.portrait)
 *   → pin 新 metadata 到 IPFS → 錢包簽 setTokenURI 上鏈。
 *
 * 重要限制 (務必理解)
 * ────────────────────
 *   1. setTokenURI 必須**錢包簽名**(合約只讓 owner / MINTER 改),後端無私鑰
 *      代簽,所以這步一定在前端、由持有者本人操作。本頁用 ChainGuard 包住。
 *   2. metadata builder 規定 `image` 必填,**不能清空**,只能換成另一張。
 *      若要「完全不顯示肖像」,請換一張中性佔位圖。
 *   3. 換圖**不會**讓舊圖從 IPFS 消失:舊 CID 仍在、鏈上歷史也仍指向舊 metadata。
 *      要盡力撤回舊圖,換完後拿本頁印出的「舊肖像 CID」去跑 storage/scripts/unpin.mjs。
 *
 * 合併策略沿用 TabletSupplementUploader:保留 deceased / descendants / assets /
 * consent / avatar / artifact / generation 等所有現有欄位,只覆寫肖像。絕不丟資料。
 */
import * as React from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Search, Save, ArrowLeft, AlertCircle, Copy, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ChainGuard } from "@/components/ChainGuard";
import { MediaUploader } from "@/components/MediaUploader";
import { useError } from "@/components/ErrorDialog";
import { useSetTokenURI, useSiweLogin } from "@/lib/wallet";
import {
  fetchTablet,
  uploadRelay,
  syncTablet,
  ApiError,
  type TabletRecord,
  type UploadedAsset,
} from "@/lib/api";
import { buildTabletMetadata } from "@/lib/metadata-builder";
import { ipfsToHttps } from "@/lib/utils";
import type { Assets, AvatarConfig, TabletMetadata } from "@shared/types/tablet";

/** 從 ipfs://<cid> / ar://<id> 取裸 CID,失敗回 null。 */
function extractCid(uri: string | undefined | null): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) return uri.slice("ipfs://".length).replace(/^ipfs\//, "") || null;
  if (uri.startsWith("ar://")) return uri.slice("ar://".length) || null;
  return null;
}

/** 從現有 metadata 的「世代」attribute 讀回 generation,讀不到回 0。 */
function readGeneration(metadata: TabletMetadata): number {
  const attr = metadata.attributes.find((a) => a.trait_type === "世代");
  const value = typeof attr?.value === "number" ? attr.value : Number(attr?.value);
  return Number.isFinite(value) ? value : 0;
}

type SaveState =
  | { status: "idle" }
  | { status: "uploading"; message: string }
  | { status: "building" }
  | { status: "signing" }
  | { status: "syncing" }
  | { status: "success"; txHash: string; metadataUri: string; oldCid: string | null }
  | { status: "error"; message: string };

export default function ReplaceImagePage(): React.ReactElement {
  return (
    <div className="container-page py-10">
      <div className="mb-6">
        <Link
          href="/registry"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-gold-dark"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          回燈塔總覽
        </Link>
        <h1 className="mt-2 font-serif text-3xl text-ink">更換燈塔肖像</h1>
        <p className="text-sm text-ink-muted">
          換掉某座燈塔在總覽頁顯示的肖像圖,並重新上鏈。換完後可拿「舊肖像 CID」去 unpin。
        </p>
      </div>

      <ChainGuard>
        <ReplaceImageTool />
      </ChainGuard>
    </div>
  );
}

function ReplaceImageTool(): React.ReactElement {
  const { showError } = useError();
  const { address } = useAccount();

  const [tokenIdInput, setTokenIdInput] = React.useState("");
  const [tokenId, setTokenId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [tablet, setTablet] = React.useState<TabletRecord | null>(null);

  const [newPortrait, setNewPortrait] = React.useState<UploadedAsset[]>([]);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  const [copied, setCopied] = React.useState(false);

  const { setTokenURI } = useSetTokenURI(tokenId ?? "0");
  const { login, logout, token } = useSiweLogin(tokenId ?? undefined);

  const meta = tablet?.metadata ?? null;
  const oldImageUri = meta?.image ?? undefined;
  const oldCid = extractCid(oldImageUri);
  const isOwner =
    !!address && !!tablet && tablet.owner.toLowerCase() === address.toLowerCase();

  const busy =
    save.status === "uploading" ||
    save.status === "building" ||
    save.status === "signing" ||
    save.status === "syncing";

  const load = async (): Promise<void> => {
    const id = tokenIdInput.trim();
    if (!/^\d+$/.test(id)) {
      showError("Token ID 無效", "請輸入純數字的 tokenId(例如 1、2、3)。");
      return;
    }
    setLoading(true);
    setTablet(null);
    setNewPortrait([]);
    setSave({ status: "idle" });
    try {
      const rec = await fetchTablet(id);
      setTablet(rec);
      setTokenId(id);
    } catch (e) {
      showError("讀取燈塔失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const copyOldCid = async (): Promise<void> => {
    if (!oldCid) return;
    try {
      await navigator.clipboard.writeText(oldCid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可用時略過,使用者仍可手動選取 */
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!tablet || !meta || !tokenId) return;
    const portrait = newPortrait[0];
    if (!portrait) {
      showError("尚未選新肖像", "請先在上方上傳一張新的肖像圖。");
      return;
    }

    try {
      const existing = meta.dsas;
      const existingAssets: Assets = existing.assets ?? {};

      // 1. 合併 assets:只覆寫 portrait,其餘陣列原封保留。
      const mergedAssets: Assets = {
        ...existingAssets,
        portrait: portrait.uri,
      };

      // 2. avatar / consent / artifact / descendants 等原封帶出。
      const mergedAvatar: AvatarConfig | undefined = existing.avatar
        ? { ...existing.avatar }
        : undefined;
      const hasAvatar = !!mergedAvatar && Object.keys(mergedAvatar).length > 0;

      // 3. 重組完整 metadata,image 換成新肖像。
      setSave({ status: "building" });
      const generation = readGeneration(meta);
      const built = buildTabletMetadata({
        deceased: existing.deceased,
        generation,
        image: portrait.uri, // ← 換圖核心:image 指向新 CID
        description: meta.description,
        ...(meta.external_url ? { external_url: meta.external_url } : {}),
        ...(existing.descendants ? { descendants: existing.descendants } : {}),
        assets: mergedAssets,
        ...(existing.artifact ? { artifact: existing.artifact } : {}),
        ...(existing.consent ? { consent: existing.consent } : {}),
        ...(hasAvatar ? { avatar: mergedAvatar } : {}),
      });

      // builder 只在有 avatarLabel/simliFaceId 時才寫 avatar;若只有 voiceLabel
      // 會被漏掉。把合併好的 avatar 補回去,確保不丟。
      const metadata: TabletMetadata =
        hasAvatar && mergedAvatar
          ? { ...built, dsas: { ...built.dsas, avatar: mergedAvatar } }
          : built;

      // 4. pin 新 metadata JSON 到 IPFS。
      setSave({ status: "uploading", message: "上傳新 metadata 至 IPFS……" });
      const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
      const file = new File([blob], `tablet-${tokenId}-${Date.now()}.json`, {
        type: "application/json",
      });
      const uploaded = await uploadRelay(file);

      // 5. setTokenURI 上鏈(錢包簽名)。
      setSave({ status: "signing" });
      const txHash = await setTokenURI(uploaded.uri);

      // 6. 同步(失敗不致命)。
      setSave({ status: "syncing" });
      try {
        const jwt = token ?? undefined;
        await syncTablet(tokenId, jwt);
      } catch {
        /* sync 失敗不致命,總覽頁重新整理時最終會一致 */
      }

      setSave({ status: "success", txHash, metadataUri: uploaded.uri, oldCid });
      // 重新讀一次讓畫面顯示新肖像。
      try {
        const rec = await fetchTablet(tokenId);
        setTablet(rec);
        setNewPortrait([]);
      } catch {
        /* ignore */
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.message}`
          : e instanceof Error
            ? e.message
            : "保存失敗";
      showError("換圖上鏈失敗", msg);
      setSave({ status: "error", message: msg });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── 查燈塔 ── */}
      <Card>
        <CardHeader>
          <CardTitle>1 · 選擇燈塔</CardTitle>
          <CardDescription>輸入要換肖像的燈塔 tokenId(總覽頁卡片右上角的 #號)。</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Token ID"
              type="number"
              placeholder="例如 3"
              value={tokenIdInput}
              onChange={(e) => setTokenIdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
            />
          </div>
          <Button onClick={() => void load()} disabled={loading} className="mb-0.5">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Search className="h-4 w-4" aria-hidden />
            )}
            讀取
          </Button>
        </CardContent>
      </Card>

      {tablet && meta ? (
        <>
          {/* ── 現況 + 舊 CID ── */}
          <Card>
            <CardHeader>
              <CardTitle>2 · 目前的肖像</CardTitle>
              <CardDescription>
                這就是「燈塔總覽」上顯示的圖。下面的「舊肖像 CID」就是你之後要 unpin 的目標。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="h-40 w-40 shrink-0 overflow-hidden rounded-md border border-ink/10 bg-paper-soft">
                {oldImageUri ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ipfsToHttps(oldImageUri)}
                    alt="目前肖像"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-ink-muted">
                    無肖像
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 text-sm">
                <div>
                  <span className="text-ink-muted">擁有者:</span>{" "}
                  <code className="break-all text-xs">{tablet.owner}</code>
                </div>
                <div>
                  <span className="text-ink-muted">舊肖像 CID:</span>{" "}
                  {oldCid ? (
                    <span className="inline-flex items-center gap-1.5">
                      <code className="break-all text-xs">{oldCid}</code>
                      <button
                        type="button"
                        onClick={() => void copyOldCid()}
                        className="rounded p-0.5 text-ink-muted hover:text-gold-dark"
                        aria-label="複製舊肖像 CID"
                        title="複製"
                      >
                        {copied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    </span>
                  ) : (
                    <span className="text-ink-muted">(無,或非 IPFS 圖)</span>
                  )}
                </div>
                {!isOwner ? (
                  <div className="mt-1 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      你目前連線的錢包不是這座燈塔的持有者。只有持有者能簽 setTokenURI
                      換圖。請切換到持有者錢包。
                    </span>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* ── 上傳新圖 + 上鏈 ── */}
          <Card>
            <CardHeader>
              <CardTitle>3 · 上傳新肖像並上鏈</CardTitle>
              <CardDescription>
                上傳一張新的肖像圖,按「換圖並上鏈」會重組 metadata(保留所有其他記憶)、
                pin 到 IPFS,然後請你在錢包簽署 setTokenURI 交易。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <MediaUploader
                label="新肖像"
                description="只保留最後一張。建議用清晰正面照。"
                single
                accept="image/*"
                value={newPortrait}
                onChange={setNewPortrait}
              />

              <Button
                variant="secondary"
                size="lg"
                loading={busy}
                disabled={busy || !isOwner || newPortrait.length === 0}
                onClick={() => void handleSave()}
                className="self-start"
              >
                <Save className="h-4 w-4" aria-hidden />
                換圖並上鏈
              </Button>

              {save.status === "uploading" ? (
                <p className="text-sm text-ink">{save.message}</p>
              ) : null}
              {save.status === "building" ? (
                <p className="text-sm text-ink">重組 metadata……</p>
              ) : null}
              {save.status === "signing" ? (
                <p className="text-sm text-ink">請在錢包簽署 setTokenURI 交易……</p>
              ) : null}
              {save.status === "syncing" ? (
                <p className="text-sm text-ink">同步鏈上資料……</p>
              ) : null}

              {save.status === "success" ? (
                <div className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <p className="font-medium">✅ 換圖已上鏈完成。總覽頁重新整理後會顯示新圖。</p>
                  <p>
                    交易雜湊:<code className="break-all">{save.txHash}</code>
                  </p>
                  <p>
                    新 metadata:<code className="break-all">{save.metadataUri}</code>
                  </p>
                  {save.oldCid ? (
                    <div className="mt-1 rounded-md border border-emerald-300/60 bg-paper/60 p-2.5 text-ink">
                      <p className="mb-1 font-medium">下一步:撤回舊圖(可選)</p>
                      <p className="text-xs text-ink-muted">
                        舊圖仍在 IPFS。在 storage/ 目錄下跑以下指令把它從你的 Pinata 帳號 unpin:
                      </p>
                      <pre className="mt-1.5 overflow-x-auto rounded bg-ink/90 p-2 text-xs text-paper">
{`node --env-file=../.env scripts/unpin.mjs ${save.oldCid}`}
                      </pre>
                      <p className="mt-1 text-[11px] text-ink-muted">
                        提醒:unpin 只切斷你帳號續命;舊 CID 仍永久留在鏈上歷史,別人 pin 過也清不掉。
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
