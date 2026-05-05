"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { Plus, Trash2, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Stepper, type StepperStep } from "@/components/ui/Stepper";
import { ChainGuard } from "@/components/ChainGuard";
import { ConsentForm } from "@/components/ConsentForm";
import { MediaUploader } from "@/components/MediaUploader";
import { ChatLogImporter } from "@/components/ChatLogImporter";
import { useMintTablet } from "@/lib/wallet";
import { uploadRelay, type UploadedAsset } from "@/lib/api";
import { buildTabletMetadata } from "@/lib/metadata-builder";
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
  { id: "descendants", label: "陽世子孫", description: "家族成員快照" },
  { id: "lineage", label: "家族脈絡", description: "根節點 / 父節點 + 同意聲明" },
  { id: "submit", label: "簽名鑄造", description: "上傳 metadata + 寫入鏈上" },
];

const DRAFT_KEY = "dsas:mint-draft:v1";

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

interface Draft {
  basic: DraftBasic;
  media: DraftMedia;
  descendants: DraftDescendant[];
  parentMode: "root" | "child";
  parentTokenId: string;
  consent: Consent | null;
  generation: number;
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
};

export default function MintPage(): React.ReactElement {
  return (
    <div className="container-page py-10">
      <header className="mb-6 flex flex-col gap-2">
        <h1 className="font-serif text-3xl text-ink">鑄造數位塔位</h1>
        <p className="text-sm text-ink-muted">
          填表 → 上傳素材 → 描述家族 → 簽署同意 → 鑄造 NFT。流程草稿會自動暫存在本機。
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

  const updateBasic = (patch: Partial<DraftBasic>): void =>
    setDraft((d) => ({ ...d, basic: { ...d.basic, ...patch } }));
  const updateMedia = (patch: Partial<DraftMedia>): void =>
    setDraft((d) => ({ ...d, media: { ...d.media, ...patch } }));

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

  const submit = async (): Promise<void> => {
    if (!address) {
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
      setSubmitState({ status: "error", message: msg });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Stepper steps={STEPS} current={step} />

      {step === 0 && <BasicStep value={draft.basic} onChange={updateBasic} />}
      {step === 1 && <MediaStep media={draft.media} updateMedia={updateMedia} />}
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
        <CardTitle>逝者基本資料</CardTitle>
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
}: {
  media: DraftMedia;
  updateMedia: (patch: Partial<DraftMedia>) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>大頭照(必須一張)</CardTitle>
          <CardDescription>用於 ERC-721 metadata 的 image 欄位。</CardDescription>
        </CardHeader>
        <CardContent>
          <MediaUploader
            label="代表照"
            single
            accept="image/*"
            value={media.portrait}
            onChange={(portrait) => updateMedia({ portrait })}
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
        <CardTitle>陽世子孫(快照)</CardTitle>
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
            <p className="text-sm text-red-700">錯誤:{state.message}</p>
            <Button onClick={onSubmit} loading={isPending}>
              重試
            </Button>
          </div>
        ) : null}

        {state.status === "success" ? (
          <div className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p>鑄造交易已送出。</p>
            <p>
              交易雜湊:<code>{state.txHash}</code>
            </p>
            <p>
              Metadata URI:<code>{state.metadataUri}</code>
            </p>
            <Button onClick={() => onView(state.metadataUri)} variant="secondary" size="sm">
              前往我的塔位
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
