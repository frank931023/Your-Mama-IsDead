/**
 * 塔位 metadata 編輯 → 合併 → 上鏈 的共用 helper。
 *
 * 抽出自 tablet/[tokenId]/page.tsx::handleSave,讓「屋主編輯頁」與「追悼頁批次
 * 上鏈」共用同一條存檔路徑,避免兩份合併邏輯漂移 (這是計畫裡最有價值的重構)。
 *
 * 合併策略 (絕不丟資料,與原 handleSave 一致):
 *   - assets.photos/videos/audios   現有 ?? [] 在前,patch 新加 append 在後
 *   - assets.chatlogs               同上 append
 *   - assets.portrait/texts         原樣保留
 *   - deceased.biography/epitaph     有給 patch 才覆寫 (空字串視為清空)
 *   - descendants                    有給 patch 才整批替換 (預填過現有);否則保留
 *   - avatar                         保留現有,只在 patch 給 voiceLabel 時覆寫
 *   - stories                        現有 ∪ patch.addStories,依 Story.id dedup,append-only
 *   - background / public            有給 patch 才覆寫;否則保留現有
 *   - image / generation / consent / artifact / 其餘 deceased 欄位  原封帶出
 *
 * build 後手動補回 avatar / stories / background / public (builder 的 conditional
 * spread 可能漏掉,尤其 public:false),確保上鏈 JSON 一定正確。
 */
import { buildTabletMetadata } from "./metadata-builder";
import { uploadRelay, syncTablet, reindexMemory } from "./api";
import type { Hex } from "viem";
import type {
  Assets,
  AvatarConfig,
  ChatLogEntry,
  DescendantSnapshot,
  MemorialTheme,
  Story,
  TabletMetadata,
} from "@shared/types/tablet";

/** 編輯帶來的變更集。所有欄位都可選 —— 沒給的就保留現有 metadata 的值。 */
export interface TabletSavePatch {
  /** 生平 (給了才覆寫;空字串=清空)。 */
  bio?: string;
  /** 墓誌銘 (給了才覆寫;空字串=清空)。 */
  epitaph?: string;
  /** 新增照片 uri (append)。 */
  newPhotos?: string[];
  /** 新增影片 uri (append)。 */
  newVideos?: string[];
  /** 新增錄音 uri (append)。 */
  newAudios?: string[];
  /** 新增對話紀錄 (append)。 */
  newChatlogs?: ChatLogEntry[];
  /** 子孫整批替換 (給了才動;預填過現有)。 */
  descendants?: DescendantSnapshot[];
  /** 克隆聲音 label (給了才覆寫 avatar.voiceLabel)。 */
  voiceLabel?: string;
  /** 要併進鏈上快照的回憶 (依 id dedup,append-only)。 */
  addStories?: Story[];
  /** 背景主題 (給了才覆寫)。 */
  background?: MemorialTheme;
  /** 公開旗標 (給了才覆寫;false 有意義)。 */
  public?: boolean;
}

export interface TabletSaveDeps {
  /** 該塔位 tokenId (sync / reindex 用)。 */
  tokenId: string | number;
  /** wagmi 簽 setTokenURI (來自 useSetTokenURI),回傳 tx hash。 */
  setTokenURI: (uri: string) => Promise<Hex>;
  /**
   * 等交易上鏈確認 (來自 useWaitForReceipt)。給了才等;不給就跳過 (相容舊行為)。
   * 沒等確認就 sync 會讀到舊 tokenURI (交易還在 mempool) → public/stories 同步成舊值。
   */
  waitForReceipt?: (hash: Hex) => Promise<void>;
  /** SIWE jwt;有的話會在 sync 帶上並重建 RAG 記憶索引。 */
  jwt?: string;
  /** 各階段進度回呼 (給 UI 顯示狀態)。 */
  onStage?: (stage: TabletSaveStage) => void;
}

export type TabletSaveStage =
  | "uploading"
  | "building"
  | "signing"
  | "confirming"
  | "syncing"
  | "indexing"
  | "done";

export interface TabletSaveResult {
  metadata: TabletMetadata;
  metadataUri: string;
  txHash: Hex;
}

/** 從現有 metadata 的「世代」attribute 讀回 generation,讀不到回 undefined。 */
function readGeneration(metadata: TabletMetadata): number | undefined {
  const attr = metadata.attributes.find((a) => a.trait_type === "世代");
  if (attr === undefined) return undefined;
  const value = typeof attr.value === "number" ? attr.value : Number(attr.value);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 把現有 metadata + patch 合併,重組成完整 metadata。不上傳、不上鏈 —— 純函式,
 * 方便單測 / 預覽。上鏈流程用 buildAndSaveTabletMetadata 包它。
 */
export function mergeTabletMetadata(
  existing: TabletMetadata,
  patch: TabletSavePatch,
): TabletMetadata {
  const dsas = existing.dsas;
  const existingAssets: Assets = dsas.assets ?? {};

  // 1. assets:現有在前,新加 append 在後;空陣列不塞。
  const mergedPhotos = [...(existingAssets.photos ?? []), ...(patch.newPhotos ?? [])];
  const mergedVideos = [...(existingAssets.videos ?? []), ...(patch.newVideos ?? [])];
  const mergedAudios = [...(existingAssets.audios ?? []), ...(patch.newAudios ?? [])];
  const mergedChatlogs = [...(existingAssets.chatlogs ?? []), ...(patch.newChatlogs ?? [])];
  const mergedTexts = existingAssets.texts ?? [];

  const mergedAssets: Assets = {
    ...(existingAssets.portrait ? { portrait: existingAssets.portrait } : {}),
    ...(mergedPhotos.length > 0 ? { photos: mergedPhotos } : {}),
    ...(mergedVideos.length > 0 ? { videos: mergedVideos } : {}),
    ...(mergedAudios.length > 0 ? { audios: mergedAudios } : {}),
    ...(mergedTexts.length > 0 ? { texts: mergedTexts } : {}),
    ...(mergedChatlogs.length > 0 ? { chatlogs: mergedChatlogs } : {}),
  };

  // 2. deceased:其餘欄位原封,只在 patch 給了 bio/epitaph 才覆寫 (空字串=清空)。
  const mergedDeceased = { ...dsas.deceased };
  if (patch.bio !== undefined) {
    const bio = patch.bio.trim();
    if (bio) mergedDeceased.biography = bio;
    else delete mergedDeceased.biography;
  }
  if (patch.epitaph !== undefined) {
    const epitaph = patch.epitaph.trim();
    if (epitaph) mergedDeceased.epitaph = epitaph;
    else delete mergedDeceased.epitaph;
  }

  // 3. 子孫:patch 給了才整批替換,只留有 name+relation 的;沒給就保留現有。
  const mergedDescendants: DescendantSnapshot[] | undefined =
    patch.descendants !== undefined
      ? patch.descendants
          .filter((d) => d.name.trim() && d.relation.trim())
          .map((d) => ({
            name: d.name.trim(),
            relation: d.relation.trim(),
            ...(d.tokenId !== undefined ? { tokenId: d.tokenId } : {}),
            ...(d.wallet ? { wallet: d.wallet } : {}),
          }))
      : dsas.descendants;

  // 4. avatar:保留現有所有欄位,只在 patch 給 voiceLabel 時覆寫。
  const mergedAvatar: AvatarConfig = {
    ...(dsas.avatar ?? {}),
    ...(patch.voiceLabel ? { voiceLabel: patch.voiceLabel } : {}),
  };
  const hasAvatar = Object.keys(mergedAvatar).length > 0;

  // 5. stories:現有 ∪ patch.addStories,依 id dedup,append-only。
  const existingStories = dsas.stories ?? [];
  const seen = new Set(existingStories.map((s) => s.id));
  const appended = (patch.addStories ?? []).filter((s) => !seen.has(s.id));
  const mergedStories = [...existingStories, ...appended];

  // 6. background / public:patch 給了才覆寫,否則保留現有。
  const mergedBackground = patch.background ?? dsas.background;
  const mergedPublic = patch.public !== undefined ? patch.public : dsas.public;

  // 7. image:沿用現有 (編輯不換大頭照)。
  const image = existing.image ?? existingAssets.portrait;
  if (!image) {
    throw new Error("現有 metadata 缺少 image / portrait,無法重組 (請聯絡管理者)。");
  }

  const generation = readGeneration(existing);
  const built = buildTabletMetadata({
    deceased: mergedDeceased,
    ...(generation !== undefined ? { generation } : {}),
    image,
    description: existing.description,
    ...(existing.external_url ? { external_url: existing.external_url } : {}),
    ...(mergedDescendants && mergedDescendants.length > 0
      ? { descendants: mergedDescendants }
      : {}),
    ...(Object.keys(mergedAssets).length > 0 ? { assets: mergedAssets } : {}),
    ...(dsas.artifact ? { artifact: dsas.artifact } : {}),
    ...(dsas.consent ? { consent: dsas.consent } : {}),
    ...(hasAvatar ? { avatar: mergedAvatar } : {}),
    ...(mergedStories.length > 0 ? { stories: mergedStories } : {}),
    ...(mergedBackground ? { background: mergedBackground } : {}),
    ...(mergedPublic !== undefined ? { public: mergedPublic } : {}),
  });

  // build 的 conditional spread 可能漏掉這些 (尤其 public:false) — 手動補回確保不丟。
  return {
    ...built,
    dsas: {
      ...built.dsas,
      ...(hasAvatar ? { avatar: mergedAvatar } : {}),
      ...(mergedStories.length > 0 ? { stories: mergedStories } : {}),
      ...(mergedBackground ? { background: mergedBackground } : {}),
      ...(mergedPublic !== undefined ? { public: mergedPublic } : {}),
    },
  };
}

/**
 * 合併 → pin metadata JSON → 簽 setTokenURI → 從鏈上 sync → 重建 RAG 索引。
 *
 * 回傳新 metadata / uri / txHash。sync 與 reindex 失敗不致命 (吞掉),呼叫方
 * 之後 reload 會兜回一致;真正會 throw 的是 build / pin / 簽名失敗。
 */
export async function buildAndSaveTabletMetadata(
  existing: TabletMetadata,
  patch: TabletSavePatch,
  deps: TabletSaveDeps,
): Promise<TabletSaveResult> {
  const { tokenId, setTokenURI, waitForReceipt, jwt, onStage } = deps;

  onStage?.("building");
  const metadata = mergeTabletMetadata(existing, patch);

  onStage?.("uploading");
  const file = new File(
    [JSON.stringify(metadata, null, 2)],
    `tablet-${tokenId}-${Date.now()}.json`,
    { type: "application/json" },
  );
  const uploaded = await uploadRelay(file);

  onStage?.("signing");
  const txHash = await setTokenURI(uploaded.uri);

  // 關鍵:等交易上鏈確認再 sync。否則 syncOnce 讀鏈會讀到舊 tokenURI
  // (交易還在 mempool) → public/stories/主題 全同步成舊值,/baibai 看不到。
  if (waitForReceipt) {
    onStage?.("confirming");
    try {
      await waitForReceipt(txHash);
    } catch {
      /* 等確認失敗 (timeout/replaced) 不致命:仍往下 sync,大不了讀到舊值,
         使用者可稍後重新整理 / 重新 sync。 */
    }
  }

  onStage?.("syncing");
  try {
    await syncTablet(tokenId, jwt);
  } catch {
    /* sync 失敗不致命,reload 會兜 */
  }
  if (jwt) {
    onStage?.("indexing");
    try {
      await reindexMemory(tokenId, jwt);
    } catch {
      /* 索引失敗不擋保存 — 對話降級成純 metadata persona */
    }
  }

  onStage?.("done");
  return { metadata, metadataUri: uploaded.uri, txHash };
}
