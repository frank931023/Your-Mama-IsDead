"use client";

/**
 * 建立記憶燈塔流程 (/mint)
 *
 * 五步驟向導:
 *   0. 基本資料         姓名/籍貫/生卒/生平
 *   1. 上傳素材         大頭照(必填) + 照片/影音/文字/對話紀錄
 *   2. 家族紀錄快照     metadata 內的非權威來源(權威是鏈上 ERC-6150)
 *   3. 家族脈絡 + 同意   根節點 or 子節點 + 同意聲明
 *   4. 簽署與鑄造         上傳 metadata 到 IPFS → mintRoot/safeMintWithParent
 *
 * 草稿存 localStorage (key=DRAFT_KEY),關掉瀏覽器再開仍保留。
 * 鑄造成功後會自動清掉草稿。
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { Plus, Trash2, ArrowLeft, ArrowRight, Sparkles, Wand2, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Stepper, type StepperStep } from "@/components/ui/Stepper";
import { ChainGuard } from "@/components/ChainGuard";
import { ConsentForm } from "@/components/ConsentForm";
import { MediaUploader } from "@/components/MediaUploader";
import { ChatLogImporter } from "@/components/ChatLogImporter";
import { useError } from "@/components/ErrorDialog";
import { useMintTablet, useSiweLogin } from "@/lib/wallet";
import {
  uploadRelay,
  generateLamAvatar,
  getCloudStatus,
  ApiError,
  type UploadedAsset,
} from "@/lib/api";
import { buildTabletMetadata } from "@/lib/metadata-builder";
import { ipfsToHttps } from "@/lib/utils";
import type {
  Assets,
  ChatLogEntry,
  Consent,
  DeceasedInfo,
  DescendantSnapshot,
} from "@shared/types/tablet";

const STEPS: readonly StepperStep[] = [
  { id: "basic", label: "基本資料", description: "姓名 / 生卒 / 生平" },
  { id: "media", label: "上傳素材", description: "照片 / 影音 / 對話" },
  { id: "descendants", label: "家族紀錄", description: "親屬與家族關係" },
  { id: "lineage", label: "家族脈絡", description: "家族節點 / 同意聲明" },
  { id: "submit", label: "鑄造燈塔", description: "永久保存與鏈上建立" },
];

const DRAFT_KEY = "aeterlux:lighthouse-draft:v1";

interface DraftBasic {
  name: string;
  alias: string;
  gender: "" | "male" | "female" | "other";
  origin: string;
  birthDate: string;
  birthPlace: string;
  deathDate: string;
  deathPlace: string;
  biography: string;
  epitaph: string;
}

interface DraftDescendant {
  name: string;
  relation: string;
  tokenId: string;
  wallet: string;
}

interface DraftMedia {
  portrait: UploadedAsset[];
  photos: UploadedAsset[];
  videos: UploadedAsset[];
  audios: UploadedAsset[];
  texts: UploadedAsset[];
  chatlogs: ChatLogEntry[];
}

interface DraftAvatar {
  /** @deprecated Simli 雲端 faceId (舊路徑)。 */
  simliFaceId?: string;
  /** 自建 LAM 渲染機回傳的 avatar label。 */
  avatarLabel?: string;
  /** LAM 導出的 3DGS zip 相對 URL (e.g. /static/avatars/<label>.zip)。 */
  avatarUrl?: string;
  status?: string;
  /** 記下生成時用的大頭照 uri,大頭照換掉時用來判斷要不要重生成。 */
  sourcePortraitUri?: string;
}

interface Draft {
  basic: DraftBasic;
  media: DraftMedia;
  descendants: DraftDescendant[];
  parentMode: "root" | "child";
  parentTokenId: string;
  consent: Consent | null;
  generation: number;
  avatar: DraftAvatar;
}

const EMPTY_DRAFT: Draft = {
  basic: {
    name: "",
    alias: "",
    gender: "",
    origin: "",
    birthDate: "",
    birthPlace: "",
    deathDate: "",
    deathPlace: "",
    biography: "",
    epitaph: "",
  },
  media: { portrait: [], photos: [], videos: [], audios: [], texts: [], chatlogs: [] },
  descendants: [],
  parentMode: "root",
  parentTokenId: "",
  consent: null,
  generation: 0,
  avatar: {},
};

export default function MintPage(): React.ReactElement {
  return (
    <div className="container-page py-10">
      <header className="mb-6 flex flex-col gap-2">
        <h1 className="font-serif text-3xl text-ink">建立記憶燈塔</h1>
        <p className="text-sm text-ink-muted">
          填寫資料 → 上傳素材 → 建立家族紀錄 → 簽署同意 → 鏈上建立燈塔。
        </p>
      </header>
      <ChainGuard>
        <MintFlow />
      </ChainGuard>
    </div>
  );
}

function MintFlow(): React.ReactElement {
  const router = useRouter();
  const { address } = useAccount();
  const { mintRoot, mintWithParent, isPending } = useMintTablet();
  const { showError } = useError();

  const [step, setStep] = React.useState(0);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [submitState, setSubmitState] = React.useState<
    | { status: "idle" }
    | { status: "uploading"; message: string }
    | { status: "signing" }
    | { status: "success"; txHash: string; metadataUri: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  // Hydrate from localStorage
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Draft;
        setDraft({ ...EMPTY_DRAFT, ...parsed });
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Persist draft
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);

  // Scroll to top whenever the user advances / retreats a step.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const updateBasic = (patch: Partial<DraftBasic>): void =>
    setDraft((d) => ({ ...d, basic: { ...d.basic, ...patch } }));
  const updateMedia = (patch: Partial<DraftMedia>): void =>
    setDraft((d) => ({ ...d, media: { ...d.media, ...patch } }));
  const updateAvatar = (patch: Partial<DraftAvatar>): void =>
    setDraft((d) => ({ ...d, avatar: { ...d.avatar, ...patch } }));

  const canAdvance = (() => {
    if (step === 0) return draft.basic.name.trim().length > 0;
    if (step === 1) return draft.media.portrait.length > 0;
    if (step === 3) {
      if (!draft.consent) return false;
      if (draft.parentMode === "child") return draft.parentTokenId.trim() !== "";
      return true;
    }
    return true;
  })();

  /**
   * 鑄造主流程:
   *   1. 從 draft 組裝 TabletMetadata (符合 ERC-721 + DSAS extension schema)
   *   2. 上傳 metadata.json 到 IPFS,拿到 ipfs://<CID>
   *   3. 呼叫合約 mintRoot 或 safeMintWithParent
   *   4. 成功後清掉 localStorage 草稿
   *
   * 任一步出錯都會彈 ErrorDialog,並把 submitState 切回 error 讓使用者重試。
   */
  const submit = async (): Promise<void> => {
    if (!address) {
      showError("請先連接錢包", "鑄造前需要先連接您的錢包以簽署交易。");
      setSubmitState({ status: "error", message: "請先連接錢包" });
      return;
    }
    try {
      setSubmitState({ status: "uploading", message: "組裝 metadata……" });

      const deceased: DeceasedInfo = {
        name: draft.basic.name.trim(),
        ...(draft.basic.alias
          ? { alias: draft.basic.alias.split(/[,,]/).map((s) => s.trim()).filter(Boolean) }
          : {}),
        ...(draft.basic.gender ? { gender: draft.basic.gender } : {}),
        ...(draft.basic.origin ? { origin: draft.basic.origin } : {}),
        ...(draft.basic.birthDate
          ? { birth: { date: draft.basic.birthDate, place: draft.basic.birthPlace || undefined } }
          : {}),
        ...(draft.basic.deathDate
          ? { death: { date: draft.basic.deathDate, place: draft.basic.deathPlace || undefined } }
          : {}),
        ...(draft.basic.biography ? { biography: draft.basic.biography } : {}),
        ...(draft.basic.epitaph ? { epitaph: draft.basic.epitaph } : {}),
      };

      const portrait = draft.media.portrait[0]?.uri;
      const assets: Assets = {
        ...(portrait ? { portrait } : {}),
        ...(draft.media.photos.length > 0 ? { photos: draft.media.photos.map((a) => a.uri) } : {}),
        ...(draft.media.videos.length > 0 ? { videos: draft.media.videos.map((a) => a.uri) } : {}),
        ...(draft.media.audios.length > 0 ? { audios: draft.media.audios.map((a) => a.uri) } : {}),
        ...(draft.media.texts.length > 0 ? { texts: draft.media.texts.map((a) => a.uri) } : {}),
        ...(draft.media.chatlogs.length > 0 ? { chatlogs: draft.media.chatlogs } : {}),
      };

      const descendants: DescendantSnapshot[] = draft.descendants
        .filter((d) => d.name.trim() && d.relation.trim())
        .map((d) => ({
          name: d.name.trim(),
          relation: d.relation.trim(),
          ...(d.tokenId.trim() ? { tokenId: Number(d.tokenId.trim()) } : {}),
          ...(d.wallet.trim() ? { wallet: d.wallet.trim() } : {}),
        }));

      const metadata = buildTabletMetadata({
        deceased,
        generation: draft.generation,
        image: portrait,
        descendants: descendants.length > 0 ? descendants : undefined,
        assets,
        consent: draft.consent ?? undefined,
        ...(draft.avatar.avatarLabel || draft.avatar.simliFaceId
          ? {
              avatar: {
                ...(draft.avatar.avatarLabel ? { avatarLabel: draft.avatar.avatarLabel } : {}),
                ...(draft.avatar.avatarUrl ? { avatarUrl: draft.avatar.avatarUrl } : {}),
                ...(draft.avatar.simliFaceId ? { simliFaceId: draft.avatar.simliFaceId } : {}),
                ...(draft.avatar.status ? { status: draft.avatar.status } : {}),
              },
            }
          : {}),
      });

      setSubmitState({ status: "uploading", message: "上傳 metadata 至 IPFS……" });
      const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
      const file = new File([blob], `tablet-${Date.now()}.json`, { type: "application/json" });
      const uploaded = await uploadRelay(file);

      setSubmitState({ status: "signing" });
      const result =
        draft.parentMode === "root"
          ? await mintRoot(address as Address, uploaded.uri)
          : await mintWithParent(
              address as Address,
              BigInt(draft.parentTokenId.trim()),
              uploaded.uri,
            );

      setSubmitState({ status: "success", txHash: result.hash, metadataUri: uploaded.uri });
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "鑄造失敗";
      showError("鑄造失敗", msg);
      setSubmitState({ status: "error", message: msg });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Stepper steps={STEPS} current={step} />

      {step === 0 && <BasicStep value={draft.basic} onChange={updateBasic} />}
      {step === 1 && (
        <MediaStep
          media={draft.media}
          updateMedia={updateMedia}
          avatar={draft.avatar}
          updateAvatar={updateAvatar}
        />
      )}
      {step === 2 && (
        <DescendantsStep
          value={draft.descendants}
          onChange={(descendants) => setDraft((d) => ({ ...d, descendants }))}
        />
      )}
      {step === 3 && (
        <LineageStep
          parentMode={draft.parentMode}
          parentTokenId={draft.parentTokenId}
          generation={draft.generation}
          consent={draft.consent}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        />
      )}
      {step === 4 && (
        <SubmitStep
          draft={draft}
          state={submitState}
          isPending={isPending}
          onSubmit={() => void submit()}
          onView={(uri) => {
            // Naive routing: success page just shows tx hash; user can click into dashboard
            void uri;
            router.push("/dashboard");
          }}
        />
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          上一步
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            disabled={!canAdvance}
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            下一步
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function BasicStep({
  value,
  onChange,
}: {
  value: DraftBasic;
  onChange: (patch: Partial<DraftBasic>) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>生平資料</CardTitle>
        <CardDescription>標 * 為必填。日期使用 yyyy-mm-dd。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Input
          label="姓名 *"
          required
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <Input
          label="別名 / 暱稱"
          hint="多個請以逗號分隔"
          value={value.alias}
          onChange={(e) => onChange({ alias: e.target.value })}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">性別</label>
          <select
            value={value.gender}
            onChange={(e) => onChange({ gender: e.target.value as DraftBasic["gender"] })}
            className="h-10 rounded-md border border-ink/20 bg-paper px-3 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
          >
            <option value="">未填</option>
            <option value="male">男</option>
            <option value="female">女</option>
            <option value="other">其他</option>
          </select>
        </div>
        <Input
          label="籍貫"
          value={value.origin}
          onChange={(e) => onChange({ origin: e.target.value })}
        />
        <Input
          label="出生日期"
          type="date"
          value={value.birthDate}
          onChange={(e) => onChange({ birthDate: e.target.value })}
        />
        <Input
          label="出生地"
          value={value.birthPlace}
          onChange={(e) => onChange({ birthPlace: e.target.value })}
        />
        <Input
          label="逝世日期"
          type="date"
          value={value.deathDate}
          onChange={(e) => onChange({ deathDate: e.target.value })}
        />
        <Input
          label="逝世地"
          value={value.deathPlace}
          onChange={(e) => onChange({ deathPlace: e.target.value })}
        />
        <div className="sm:col-span-2">
          <Textarea
            label="生平"
            rows={5}
            value={value.biography}
            onChange={(e) => onChange({ biography: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea
            label="墓誌銘 / 一句話的人生"
            rows={2}
            value={value.epitaph}
            onChange={(e) => onChange({ epitaph: e.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MediaStep({
  media,
  updateMedia,
  avatar,
  updateAvatar,
}: {
  media: DraftMedia;
  updateMedia: (patch: Partial<DraftMedia>) => void;
  avatar: DraftAvatar;
  updateAvatar: (patch: Partial<DraftAvatar>) => void;
}): React.ReactElement {
  const portraitUri = media.portrait[0]?.uri;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>大頭照(必須一張)</CardTitle>
          <CardDescription>用於 ERC-721 metadata 的 image 欄位,也用來生成可對話的數位分身。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <MediaUploader
            label="代表照"
            single
            accept="image/*"
            value={media.portrait}
            onChange={(portrait) => {
              updateMedia({ portrait });
              // 換了大頭照就清掉舊的 faceId,讓使用者用新照片重新生成。
              const next = portrait[0]?.uri;
              if (next !== avatar.sourcePortraitUri) {
                updateAvatar({
                  avatarLabel: undefined,
                  avatarUrl: undefined,
                  simliFaceId: undefined,
                  status: undefined,
                  sourcePortraitUri: undefined,
                });
              }
            }}
          />
          <AvatarFaceGenerator
            portraitUri={portraitUri}
            avatar={avatar}
            updateAvatar={updateAvatar}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>生平照片</CardTitle>
        </CardHeader>
        <CardContent>
          <MediaUploader
            label="照片"
            multiple
            accept="image/*"
            value={media.photos}
            onChange={(photos) => updateMedia({ photos })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>影音</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <MediaUploader
            label="影片"
            accept="video/*"
            value={media.videos}
            onChange={(videos) => updateMedia({ videos })}
          />
          <MediaUploader
            label="錄音 / 訪談"
            accept="audio/*"
            value={media.audios}
            onChange={(audios) => updateMedia({ audios })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>文字資料</CardTitle>
          <CardDescription>日記、文章、信件等純文字檔。</CardDescription>
        </CardHeader>
        <CardContent>
          <MediaUploader
            label="文字"
            accept=".txt,.md,.pdf,.doc,.docx"
            value={media.texts}
            onChange={(texts) => updateMedia({ texts })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>對話紀錄(可選)</CardTitle>
          <CardDescription>LINE / WhatsApp / Messenger / Instagram / Telegram / Discord</CardDescription>
        </CardHeader>
        <CardContent>
          <ChatLogImporter
            value={media.chatlogs}
            onChange={(chatlogs) => updateMedia({ chatlogs })}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 用大頭照生成 Simli 專屬數位分身 (talking-head faceId)。
 *
 * 流程:
 *   1. 確認 SIMLI_API_KEY 已設 (getCloudStatus().avatar);沒設就不顯示。
 *   2. 把已上傳到 IPFS 的大頭照 fetch 回來成 Blob (上傳後原始 File 已不在手上)。
 *   3. 需要時觸發一次 SIWE 登入拿 JWT,POST /api/simli/face 生成 faceId。
 *   4. faceId 存進 draft.avatar,隨 metadata 一起上鏈;聊天頁開 session 時用它。
 *
 * 生成失敗 (例如 Simli 配額滿且無臉可刪) 不阻斷 mint —— 只是聊天時 fallback
 * 到預設臉 (Tina)。所以這一步是「選配增強」,不是必填。
 */
function AvatarFaceGenerator({
  portraitUri,
  avatar,
  updateAvatar,
}: {
  portraitUri: string | undefined;
  avatar: DraftAvatar;
  updateAvatar: (patch: Partial<DraftAvatar>) => void;
}): React.ReactElement | null {
  const { login, logout, token } = useSiweLogin(); // global token (mint 階段還沒有 tokenId)
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [state, setState] = React.useState<
    | { status: "idle" }
    | { status: "working"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  // 後端有沒有設 SIMLI_API_KEY?沒設就整塊不顯示 (避免給使用者一個按了會壞的按鈕)。
  React.useEffect(() => {
    let cancelled = false;
    getCloudStatus()
      .then((s) => {
        if (!cancelled) setAvailable(s.avatar);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (available === false) return null; // 渲染機未設定,靜默隱藏

  const generated = Boolean(avatar.avatarLabel) && avatar.sourcePortraitUri === portraitUri;

  // 從大頭照 uri 派生一個安全 label ([A-Za-z0-9_-])。換照片 → 換 label → 重生成。
  const deriveLabel = (uri: string): string => {
    const tail = uri.replace(/[^A-Za-z0-9]/g, "").slice(-16) || "anon";
    return `dsas_${tail}`;
  };

  const generate = async (): Promise<void> => {
    if (!portraitUri) return;
    try {
      setState({ status: "working", message: "讀取大頭照……" });
      const res = await fetch(ipfsToHttps(portraitUri));
      if (!res.ok) throw new Error(`無法讀取大頭照 (${res.status})`);
      const blob = await res.blob();
      const label = deriveLabel(portraitUri);

      // 取 JWT 調後端。token 可能是過期字串 (TTL ~1h),`token ?? login()` 分不出
      // 有效 vs 過期 → 會帶死 token 拿 401 卻不重簽。所以:先試快取 token,401 就
      // 清掉重新 SIWE 登入再重試一次。
      // 注意:LAM 重建會阻塞約 100 秒 (渲染機跑 3DGS reconstruction)。
      const callWith = async (jwt: string): Promise<Awaited<ReturnType<typeof generateLamAvatar>>> => {
        setState({ status: "working", message: "生成 3D 數位分身中(約需 1–2 分鐘,請稍候)……" });
        return generateLamAvatar(blob, label, jwt);
      };

      let result;
      try {
        setState({ status: "working", message: "驗證身分……" });
        const jwt = token ?? (await login());
        result = await callWith(jwt);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          setState({ status: "working", message: "請在錢包中簽署登入……" });
          const jwt = await login();
          result = await callWith(jwt);
        } else {
          throw err;
        }
      }

      updateAvatar({
        avatarLabel: result.label,
        avatarUrl: result.url,
        status: "completed",
        sourcePortraitUri: portraitUri,
      });
      setState({ status: "idle" });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? "需要簽署登入訊息才能生成 (請在錢包中確認簽名)。"
            : `生成失敗:${e.message}`
          : e instanceof Error
            ? e.message
            : "生成失敗";
      setState({ status: "error", message: msg });
    }
  };

  return (
    <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
      <div className="flex items-start gap-3">
        <Wand2 className="mt-0.5 h-5 w-5 shrink-0 text-gold-dark" aria-hidden />
        <div className="flex flex-1 flex-col gap-2">
          <div>
            <p className="text-sm font-medium text-ink">生成可對話的數位分身(選配)</p>
            <p className="text-xs text-ink-muted">
              用這張大頭照生成逝者專屬的即時臉孔,日後在對話頁能看到他/她開口說話。
              不生成也能對話,屆時會用通用形象。
            </p>
          </div>

          {generated ? (
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <Check className="h-4 w-4" aria-hidden />
              <span>已生成專屬分身。</span>
              <button
                type="button"
                className="text-xs text-ink-muted underline underline-offset-2 hover:text-gold-dark"
                onClick={() => void generate()}
              >
                重新生成
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!portraitUri || state.status === "working"}
                onClick={() => void generate()}
                className="self-start"
              >
                {state.status === "working" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Wand2 className="h-4 w-4" aria-hidden />
                )}
                {state.status === "working" ? state.message : "生成專屬分身"}
              </Button>
              {!portraitUri ? (
                <p className="text-xs text-ink-muted">請先上傳一張大頭照。</p>
              ) : null}
              {state.status === "error" ? (
                <p className="text-xs text-red-400">{state.message}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DescendantsStep({
  value,
  onChange,
}: {
  value: DraftDescendant[];
  onChange: (next: DraftDescendant[]) => void;
}): React.ReactElement {
  const update = (idx: number, patch: Partial<DraftDescendant>): void =>
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const remove = (idx: number): void => onChange(value.filter((_, i) => i !== idx));
  const add = (): void =>
    onChange([...value, { name: "", relation: "", tokenId: "", wallet: "" }]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>家族紀錄(快照)</CardTitle>
        <CardDescription>
          鏈上家譜的權威來源是 ERC-6150 父子關係,這裡是寫入 metadata 的可讀快照。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {value.length === 0 ? (
          <p className="text-sm text-ink-muted">目前尚無子孫資料,可略過此步驟。</p>
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove(idx)}
              aria-label="移除此列"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4" aria-hidden />
          新增子孫
        </Button>
      </CardContent>
    </Card>
  );
}

function LineageStep({
  parentMode,
  parentTokenId,
  generation,
  consent,
  onChange,
}: {
  parentMode: "root" | "child";
  parentTokenId: string;
  generation: number;
  consent: Consent | null;
  onChange: (patch: Partial<Draft>) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>家族脈絡與同意聲明</CardTitle>
        <CardDescription>
          指定為新家族(根節點)或既有家族的子節點;勾選同意聲明後才能進入鑄造步驟。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="parentMode"
                checked={parentMode === "root"}
                onChange={() => onChange({ parentMode: "root", generation: 0 })}
              />
              新家族(根節點 · 世代 0)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="parentMode"
                checked={parentMode === "child"}
                onChange={() => onChange({ parentMode: "child" })}
              />
              既有家族的子節點
            </label>
          </div>

          {parentMode === "child" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="父節點 Token Id *"
                type="number"
                value={parentTokenId}
                onChange={(e) => onChange({ parentTokenId: e.target.value })}
              />
              <Input
                label="世代深度"
                type="number"
                hint="父節點世代 + 1"
                value={String(generation)}
                onChange={(e) => onChange({ generation: Number(e.target.value || 0) })}
              />
            </div>
          ) : null}
        </div>

        <ConsentForm value={consent} onChange={(c) => onChange({ consent: c })} />
      </CardContent>
    </Card>
  );
}

function SubmitStep({
  draft,
  state,
  isPending,
  onSubmit,
  onView,
}: {
  draft: Draft;
  state:
    | { status: "idle" }
    | { status: "uploading"; message: string }
    | { status: "signing" }
    | { status: "success"; txHash: string; metadataUri: string }
    | { status: "error"; message: string };
  isPending: boolean;
  onSubmit: () => void;
  onView: (uri: string) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>確認並鑄造</CardTitle>
        <CardDescription>
          按下鑄造後將先把 metadata 上傳到 IPFS,再請你於錢包簽署交易。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Summary draft={draft} />

        {state.status === "idle" ? (
          <Button onClick={onSubmit} loading={isPending} variant="secondary" size="lg">
            <Sparkles className="h-4 w-4" aria-hidden />
            開始鑄造
          </Button>
        ) : null}

        {state.status === "uploading" ? (
          <p className="text-sm text-ink">{state.message}</p>
        ) : null}

        {state.status === "signing" ? (
          <p className="text-sm text-ink">請於錢包確認交易……</p>
        ) : null}

        {state.status === "error" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">鑄造未完成,請查看跳出的訊息後再試一次。</p>
            <Button onClick={onSubmit} loading={isPending}>
              重試
            </Button>
          </div>
        ) : null}

        {state.status === "success" ? (
          <div className="flex flex-col gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
            <p>鑄造交易已送出。</p>
            <p>
              交易雜湊:<code>{state.txHash}</code>
            </p>
            <p>
              Metadata URI:<code>{state.metadataUri}</code>
            </p>
            <Button onClick={() => onView(state.metadataUri)} variant="secondary" size="sm">
              前往燈塔典藏
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Summary({ draft }: { draft: Draft }): React.ReactElement {
  return (
    <dl className="grid gap-2 rounded-md border border-ink/10 bg-paper-soft/40 p-4 text-sm">
      <Row label="姓名" value={draft.basic.name || "—"} />
      <Row
        label="生卒"
        value={`${draft.basic.birthDate || "?"} ~ ${draft.basic.deathDate || "?"}`}
      />
      <Row label="籍貫" value={draft.basic.origin || "—"} />
      <Row
        label="素材"
        value={
          `代表照 ${draft.media.portrait.length} · 照片 ${draft.media.photos.length} · ` +
          `影片 ${draft.media.videos.length} · 音檔 ${draft.media.audios.length} · ` +
          `文字 ${draft.media.texts.length} · 對話 ${draft.media.chatlogs.length}`
        }
      />
      <Row label="子孫" value={`${draft.descendants.length} 位`} />
      <Row
        label="家族脈絡"
        value={
          draft.parentMode === "root"
            ? "根節點"
            : `子節點(父 #${draft.parentTokenId || "?"} · 世代 ${draft.generation})`
        }
      />
      <Row label="同意聲明" value={draft.consent ? "已簽署" : "尚未勾選"} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
