"use client";

/**
 * 塔位補傳區 (TabletSupplementUploader)
 *
 * 鑄造後讓「持有者」補傳新素材並一次上鏈更新 metadata:
 *   - 照片牆 / 影音 / 錄音 / 文字 / 對話紀錄  (MediaUploader 收集 → IPFS)
 *   - 生平 / 墓誌銘                            (textarea,預填現有值)
 *   - 子孫快照                                 (可加減的 { name, relation } 列)
 *   - 聲音克隆                                 (從已有 + 本次補傳音檔挑一段 → 渲染機克隆)
 *
 * 「保存並上鏈」會:
 *   1. 把本次補傳「合併進」現有 metadata (append/overlay,絕不 replace 丟資料)
 *   2. buildTabletMetadata 重組完整 metadata
 *   3. 序列化成 File → uploadRelay pin 到 IPFS
 *   4. useSetTokenURI(tokenId).setTokenURI(newUri) 上鏈
 *   5. syncTablet 強制從鏈上重讀 + onUpdated?.()
 *
 * 正確性核心:合併時保留 currentMetadata.dsas 的所有現有欄位
 * (deceased / descendants / assets / consent / avatar / generation),
 * 新素材 append 到既有陣列尾端,丟資料 = 鏈上記憶丟失,不可接受。
 */
import * as React from "react";
import { Plus, Trash2, Save, Wand2, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { MediaUploader } from "@/components/MediaUploader";
import { ChatLogImporter } from "@/components/ChatLogImporter";
import { useError } from "@/components/ErrorDialog";
import { useSetTokenURI, useSiweLogin } from "@/lib/wallet";
import {
  uploadRelay,
  syncTablet,
  generateClonedVoice,
  ApiError,
  type UploadedAsset,
} from "@/lib/api";
import { buildTabletMetadata } from "@/lib/metadata-builder";
import { ipfsToHttps } from "@/lib/utils";
import type {
  Assets,
  AvatarConfig,
  ChatLogEntry,
  DescendantSnapshot,
  TabletMetadata,
} from "@shared/types/tablet";

export interface TabletSupplementUploaderProps {
  tokenId: string;
  /** 當前鏈上 metadata (從 fetchTablet 來)。 */
  currentMetadata: TabletMetadata;
  /** 只有 owner 能補傳。 */
  isOwner: boolean;
  /** 上鏈成功後回調 (讓塔位頁 re-fetch)。 */
  onUpdated?: () => void;
}

/** 一列子孫快照的編輯狀態 (字串化,送出時再轉型)。 */
interface DraftDescendant {
  name: string;
  relation: string;
  tokenId: string;
  wallet: string;
}

type SaveState =
  | { status: "idle" }
  | { status: "uploading"; message: string }
  | { status: "building" }
  | { status: "signing" }
  | { status: "syncing" }
  | { status: "success"; txHash: string; metadataUri: string }
  | { status: "error"; message: string };

/** 從 ipfs:// uri 取一個顯示用的短名 (聲音克隆下拉用)。 */
function uriShortName(uri: string): string {
  const tail = uri.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
  return tail.length > 24 ? `…${tail.slice(-22)}` : tail;
}

/** 從 uri 派生一個安全 label fragment ([A-Za-z0-9_-])。 */
function deriveTokenLabel(tokenId: string): string {
  const safe = tokenId.replace(/[^A-Za-z0-9]/g, "") || "anon";
  return `dsas_voice_${safe}`;
}

export function TabletSupplementUploader({
  tokenId,
  currentMetadata,
  isOwner,
  onUpdated,
}: TabletSupplementUploaderProps): React.ReactElement {
  const { showError } = useError();
  const { setTokenURI } = useSetTokenURI(tokenId);
  const { login, logout, token } = useSiweLogin(tokenId);

  const existing = currentMetadata.dsas;
  const existingAssets: Assets = existing.assets ?? {};

  // ── 本次補傳的新素材 (與現有 metadata 分開,送出時才合併) ──────────────
  const [newPhotos, setNewPhotos] = React.useState<UploadedAsset[]>([]);
  const [newVideos, setNewVideos] = React.useState<UploadedAsset[]>([]);
  const [newAudios, setNewAudios] = React.useState<UploadedAsset[]>([]);
  const [newTexts, setNewTexts] = React.useState<UploadedAsset[]>([]);
  const [newChatlogs, setNewChatlogs] = React.useState<ChatLogEntry[]>([]);

  // ── 生平 / 墓誌銘:預填現有值,使用者可改 ───────────────────────────────
  const [biography, setBiography] = React.useState<string>(existing.deceased.biography ?? "");
  const [epitaph, setEpitaph] = React.useState<string>(existing.deceased.epitaph ?? "");

  // ── 子孫:預填現有快照 ─────────────────────────────────────────────────
  const [descendants, setDescendants] = React.useState<DraftDescendant[]>(
    () =>
      (existing.descendants ?? []).map((d) => ({
        name: d.name,
        relation: d.relation,
        tokenId: d.tokenId !== undefined ? String(d.tokenId) : "",
        wallet: d.wallet ?? "",
      })),
  );

  // ── 聲音克隆 ───────────────────────────────────────────────────────────
  // 可選音檔來源 = 現有 audios + 本次補傳 audios (都是 ipfs:// uri)。
  const audioChoices = React.useMemo<string[]>(
    () => [...(existingAssets.audios ?? []), ...newAudios.map((a) => a.uri)],
    [existingAssets.audios, newAudios],
  );
  const [selectedAudio, setSelectedAudio] = React.useState<string>("");
  const [voiceLabel, setVoiceLabel] = React.useState<string | undefined>(existing.avatar?.voiceLabel);
  const [voiceState, setVoiceState] = React.useState<
    { status: "idle" } | { status: "working"; message: string } | { status: "error"; message: string }
  >({ status: "idle" });

  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  const busy =
    save.status === "uploading" ||
    save.status === "building" ||
    save.status === "signing" ||
    save.status === "syncing";

  if (!isOwner) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>補傳區</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-muted">只有持有者可以補傳。</p>
        </CardContent>
      </Card>
    );
  }

  // ── 聲音克隆:從 ipfs uri fetch blob → 克隆 (需 SIWE jwt,401 重簽重試) ──
  const cloneVoice = async (): Promise<void> => {
    if (!selectedAudio) return;
    try {
      setVoiceState({ status: "working", message: "讀取音檔……" });
      const res = await fetch(ipfsToHttps(selectedAudio));
      if (!res.ok) throw new Error(`無法讀取音檔 (${res.status})`);
      const blob = await res.blob();
      const label = deriveTokenLabel(tokenId);

      const callWith = async (jwt: string): Promise<Awaited<ReturnType<typeof generateClonedVoice>>> => {
        setVoiceState({ status: "working", message: "克隆聲音中(可能需要一點時間)……" });
        return generateClonedVoice(blob, label, jwt);
      };

      let result;
      try {
        setVoiceState({ status: "working", message: "驗證身分……" });
        const jwt = token ?? (await login());
        result = await callWith(jwt);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          setVoiceState({ status: "working", message: "請在錢包中簽署登入……" });
          const jwt = await login();
          result = await callWith(jwt);
        } else {
          throw err;
        }
      }

      setVoiceLabel(result.label);
      setVoiceState({ status: "idle" });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? "需要簽署登入訊息才能克隆聲音 (請在錢包中確認簽名)。"
            : `克隆失敗:${e.message}`
          : e instanceof Error
            ? e.message
            : "克隆失敗";
      setVoiceState({ status: "error", message: msg });
    }
  };

  /**
   * 合併本次補傳到現有 metadata,重組後上鏈。
   *
   * Merge 策略 (絕不丟資料):
   *   - assets.*  新陣列 append 到既有陣列尾端 (現有 ?? [] 在前,新的在後)
   *   - chatlogs  同上 append
   *   - portrait  不動 (補傳不換大頭照,沿用現有)
   *   - biography / epitaph  以 textarea 目前值覆蓋 (預填過現有值,空字串視為清空)
   *   - descendants  以編輯後列表整批取代 (預填過現有,使用者可加減/改)
   *   - avatar  保留現有 avatarLabel/avatarUrl/simliFaceId/status,只覆寫 voiceLabel
   *   - deceased 其餘欄位 / consent / generation  原封帶出
   */
  const handleSave = async (): Promise<void> => {
    try {
      setSave({ status: "uploading", message: "合併素材……" });

      // 1. 合併 assets:現有在前,新補傳 append 在後。
      const mergedAssets: Assets = {
        ...(existingAssets.portrait ? { portrait: existingAssets.portrait } : {}),
        ...mergeUriArray("photos", existingAssets.photos, newPhotos),
        ...mergeUriArray("videos", existingAssets.videos, newVideos),
        ...mergeUriArray("audios", existingAssets.audios, newAudios),
        ...mergeUriArray("texts", existingAssets.texts, newTexts),
        ...mergeChatlogs(existingAssets.chatlogs, newChatlogs),
      };

      // 2. 合併 deceased:其餘欄位原封保留,只覆寫 biography / epitaph。
      const mergedDeceased = {
        ...existing.deceased,
        ...(biography.trim() ? { biography: biography.trim() } : { biography: undefined }),
        ...(epitaph.trim() ? { epitaph: epitaph.trim() } : { epitaph: undefined }),
      };
      // 清掉被設成 undefined 的鍵,避免序列化出 "biography": undefined → 反而留乾淨。
      if (!mergedDeceased.biography) delete mergedDeceased.biography;
      if (!mergedDeceased.epitaph) delete mergedDeceased.epitaph;

      // 3. 子孫:編輯後列表整批取代 (預填過現有)。
      const mergedDescendants: DescendantSnapshot[] = descendants
        .filter((d) => d.name.trim() && d.relation.trim())
        .map((d) => ({
          name: d.name.trim(),
          relation: d.relation.trim(),
          ...(d.tokenId.trim() ? { tokenId: Number(d.tokenId.trim()) } : {}),
          ...(d.wallet.trim() ? { wallet: d.wallet.trim() } : {}),
        }));

      // 4. avatar:保留現有所有欄位,只覆寫 voiceLabel。
      const mergedAvatar: AvatarConfig = {
        ...(existing.avatar ?? {}),
        ...(voiceLabel ? { voiceLabel } : {}),
      };
      const hasAvatar = Object.keys(mergedAvatar).length > 0;

      // 5. image:沿用現有 (補傳不換大頭照)。buildTabletMetadata 需要 image。
      const image = currentMetadata.image ?? existingAssets.portrait;
      if (!image) {
        throw new Error("現有 metadata 缺少 image / portrait,無法重組 (請聯絡管理者)。");
      }

      // 6. 重組完整 metadata。
      setSave({ status: "building" });
      const generation = readGeneration(currentMetadata);
      const built = buildTabletMetadata({
        deceased: mergedDeceased,
        generation,
        image,
        description: currentMetadata.description,
        ...(currentMetadata.external_url ? { external_url: currentMetadata.external_url } : {}),
        descendants: mergedDescendants.length > 0 ? mergedDescendants : undefined,
        assets: mergedAssets,
        ...(existing.artifact ? { artifact: existing.artifact } : {}),
        ...(existing.consent ? { consent: existing.consent } : {}),
        ...(hasAvatar ? { avatar: mergedAvatar } : {}),
      });

      // buildTabletMetadata 只在有 avatarLabel/simliFaceId 時才寫 avatar;
      // 但我們可能只有 voiceLabel,builder 會漏掉。這裡把合併好的 avatar 補回去,
      // 確保 voiceLabel 不會在重組時被丟掉。
      const metadata: TabletMetadata = hasAvatar
        ? { ...built, dsas: { ...built.dsas, avatar: mergedAvatar } }
        : built;

      // 7. pin metadata JSON 到 IPFS。
      setSave({ status: "uploading", message: "上傳 metadata 至 IPFS……" });
      const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
      const file = new File([blob], `tablet-${tokenId}-${Date.now()}.json`, {
        type: "application/json",
      });
      const uploaded = await uploadRelay(file);

      // 8. 上鏈。
      setSave({ status: "signing" });
      const txHash = await setTokenURI(uploaded.uri);

      // 9. 同步 (從鏈上強制重讀;失敗不阻斷,onUpdated 仍會觸發 re-fetch)。
      setSave({ status: "syncing" });
      try {
        await syncTablet(tokenId, token ?? undefined);
      } catch {
        /* sync 失敗不致命,塔位頁 re-fetch 時最終會一致 */
      }

      setSave({ status: "success", txHash, metadataUri: uploaded.uri });

      // 清空本次補傳暫存 (避免重複 append)。
      setNewPhotos([]);
      setNewVideos([]);
      setNewAudios([]);
      setNewTexts([]);
      setNewChatlogs([]);

      onUpdated?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失敗";
      showError("補傳保存失敗", msg);
      setSave({ status: "error", message: msg });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>補傳區</CardTitle>
          <CardDescription>
            補上更多照片、影音、文字與對話紀錄,或修改生平 / 墓誌銘 / 子孫紀錄。
            完成後一次保存並上鏈,新內容會「合併」進現有記憶,不會覆蓋既有素材。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <MediaUploader
            label="照片牆"
            description="新增更多生平照片 (會 append 到現有照片)。"
            multiple
            accept="image/*"
            value={newPhotos}
            onChange={setNewPhotos}
          />
          <MediaUploader
            label="影音視頻"
            multiple
            accept="video/*"
            value={newVideos}
            onChange={setNewVideos}
          />
          <MediaUploader
            label="錄音 / 音頻"
            multiple
            accept="audio/*"
            value={newAudios}
            onChange={setNewAudios}
          />
          <MediaUploader
            label="文字檔案"
            description="日記、文章、信件等純文字檔。"
            multiple
            accept=".txt,.md,.pdf,.doc,.docx"
            value={newTexts}
            onChange={setNewTexts}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>對話紀錄</CardTitle>
          <CardDescription>LINE / WhatsApp / Messenger / Instagram / Telegram / Discord</CardDescription>
        </CardHeader>
        <CardContent>
          <ChatLogImporter value={newChatlogs} onChange={setNewChatlogs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>生平與墓誌銘</CardTitle>
          <CardDescription>已預填現有內容,修改後將覆蓋舊值。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Textarea
            label="生平"
            rows={5}
            value={biography}
            onChange={(e) => setBiography(e.target.value)}
          />
          <Textarea
            label="墓誌銘 / 一句話的人生"
            rows={2}
            value={epitaph}
            onChange={(e) => setEpitaph(e.target.value)}
          />
        </CardContent>
      </Card>

      <DescendantsEditor value={descendants} onChange={setDescendants} />

      <Card>
        <CardHeader>
          <CardTitle>聲音克隆</CardTitle>
          <CardDescription>
            從已上傳的音頻中挑一段清晰的錄音,生成逝者專屬的克隆聲音,日後對話時用他/她的聲音回應。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink" htmlFor="voice-source">
              選擇音頻來源
            </label>
            <select
              id="voice-source"
              value={selectedAudio}
              onChange={(e) => setSelectedAudio(e.target.value)}
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
              <p className="text-xs text-ink-muted">尚無音頻可用,請先在上方「錄音 / 音頻」補傳。</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectedAudio || voiceState.status === "working"}
              onClick={() => void cloneVoice()}
              className="self-start"
            >
              {voiceState.status === "working" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Wand2 className="h-4 w-4" aria-hidden />
              )}
              {voiceState.status === "working" ? voiceState.message : "生成克隆聲音"}
            </Button>
            {voiceLabel ? (
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <Check className="h-4 w-4" aria-hidden />
                <span>
                  已備妥克隆聲音 (<code className="text-xs">{voiceLabel}</code>),保存上鏈後生效。
                </span>
              </div>
            ) : null}
            {voiceState.status === "error" ? (
              <p className="text-xs text-red-400">{voiceState.message}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 py-5">
          <Button
            variant="secondary"
            size="lg"
            loading={busy}
            disabled={busy}
            onClick={() => void handleSave()}
            className="self-start"
          >
            <Save className="h-4 w-4" aria-hidden />
            保存並上鏈
          </Button>

          {save.status === "uploading" ? (
            <p className="text-sm text-ink">{save.message}</p>
          ) : null}
          {save.status === "building" ? (
            <p className="text-sm text-ink">重組 metadata……</p>
          ) : null}
          {save.status === "signing" ? (
            <p className="text-sm text-ink">請在錢包簽署交易……</p>
          ) : null}
          {save.status === "syncing" ? (
            <p className="text-sm text-ink">同步鏈上資料……</p>
          ) : null}
          {save.status === "success" ? (
            <div className="flex flex-col gap-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
              <p>補傳已上鏈完成。</p>
              <p>
                交易雜湊:<code className="break-all">{save.txHash}</code>
              </p>
              <p>
                Metadata URI:<code className="break-all">{save.metadataUri}</code>
              </p>
            </div>
          ) : null}
          {save.status === "error" ? (
            <p className="text-sm text-ink-muted">保存未完成,請查看跳出的訊息後再試一次。</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * append 合併一個 ipfs uri 陣列欄位。
 * 回傳 `{}` (欄位不存在) 或 `{ [key]: [...existing, ...new] }`,
 * 方便用 spread 拼進 Assets 而不留空陣列鍵。
 */
function mergeUriArray(
  key: "photos" | "videos" | "audios" | "texts",
  existing: string[] | undefined,
  added: UploadedAsset[],
): Partial<Pick<Assets, "photos" | "videos" | "audios" | "texts">> {
  const merged = [...(existing ?? []), ...added.map((a) => a.uri)];
  return merged.length > 0 ? { [key]: merged } : {};
}

/** append 合併 chatlogs (ChatLogEntry[])。 */
function mergeChatlogs(
  existing: ChatLogEntry[] | undefined,
  added: ChatLogEntry[],
): Partial<Pick<Assets, "chatlogs">> {
  const merged = [...(existing ?? []), ...added];
  return merged.length > 0 ? { chatlogs: merged } : {};
}

/** 從現有 metadata 的「世代」attribute 讀回 generation,讀不到回 0。 */
function readGeneration(metadata: TabletMetadata): number {
  const attr = metadata.attributes.find((a) => a.trait_type === "世代");
  const value = typeof attr?.value === "number" ? attr.value : Number(attr?.value);
  return Number.isFinite(value) ? value : 0;
}

function DescendantsEditor({
  value,
  onChange,
}: {
  value: DraftDescendant[];
  onChange: (next: DraftDescendant[]) => void;
}): React.ReactElement {
  const update = (idx: number, patch: Partial<DraftDescendant>): void =>
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const remove = (idx: number): void => onChange(value.filter((_, i) => i !== idx));
  const add = (): void => onChange([...value, { name: "", relation: "", tokenId: "", wallet: "" }]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>子孫紀錄(快照)</CardTitle>
        <CardDescription>
          已預填現有快照。鏈上家譜的權威來源是 ERC-6150 父子關係,這裡是寫入 metadata 的可讀快照。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {value.length === 0 ? (
          <p className="text-sm text-ink-muted">目前尚無子孫資料。</p>
        ) : null}
        {value.map((row, idx) => (
          <div
            key={idx}
            className="grid gap-2 rounded-md border border-ink/10 bg-paper-soft/40 p-3 sm:grid-cols-[1.2fr_1fr_0.8fr_1.4fr_auto]"
          >
            <Input
              placeholder="姓名"
              value={row.name}
              onChange={(e) => update(idx, { name: e.target.value })}
            />
            <Input
              placeholder="關係(長子 / 長孫)"
              value={row.relation}
              onChange={(e) => update(idx, { relation: e.target.value })}
            />
            <Input
              placeholder="Token Id"
              type="number"
              value={row.tokenId}
              onChange={(e) => update(idx, { tokenId: e.target.value })}
            />
            <Input
              placeholder="0x… (錢包,可選)"
              value={row.wallet}
              onChange={(e) => update(idx, { wallet: e.target.value })}
            />
            <Button variant="ghost" size="sm" onClick={() => remove(idx)} aria-label="移除此列">
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={add} className="self-start">
          <Plus className="h-4 w-4" aria-hidden />
          新增子孫
        </Button>
      </CardContent>
    </Card>
  );
}
