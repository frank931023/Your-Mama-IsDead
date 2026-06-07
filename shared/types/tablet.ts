/**
 * 數位塔位 NFT metadata 共用型別 (frontend / backend / training 三方共用)
 *
 * 結構說明:
 *   TabletMetadata = ERC-721 規範必要欄位 (name/description/image/attributes)
 *                  + dsas 擴充命名空間 (DSASExtension)
 *
 * DSAS extension 內含:
 *   - deceased       逝者基本資料 (姓名/性別/籍貫/生卒/生平/墓誌銘)
 *   - descendants    陽世子孫快照 (鏈上 ERC-6150 才是權威來源,這裡只是可讀)
 *   - assets         素材 IPFS URI 集合 (大頭照/照片/影音/文字/對話紀錄)
 *   - artifact       訓練後的 LoRA + voice + RAG 集合 (mint 時通常為空)
 *   - consent        家屬簽署的同意聲明 (留下不可竄改的法律證據)
 *
 * 三方共用:rendering 用、上傳前 build 用、訓練 pipeline 讀也是這份。
 */

export type StorageURI = string; // "ipfs://..." | "ar://..." | "https://..."

export interface ChatLogEntry {
  platform: "line" | "whatsapp" | "facebook" | "instagram" | "telegram" | "discord" | "other";
  uri: StorageURI;
  format: "json" | "txt" | "html";
}

export interface DescendantSnapshot {
  name: string;
  relation: string; // 長子 / 次女 / 長孫 / ...
  tokenId?: number;
  wallet?: string;
}

/**
 * 哀悼版上的一段回憶 (story / memory)。屋主與訪客都能投稿。
 *
 * 訪客投稿時內容會先 pin 到 IPFS 拿到不可竄改的 `contentCid`,存進後端 DB
 * (狀態 PENDING)。屋主核可後在塔位頁一次性把已核可的 stories 合併進
 * metadata、簽 setTokenURI 上鏈。鏈上的 `stories[]` 是屋主策展的權威快照,
 * 後端 DB (MemorialStory) 才有完整即時流與審核狀態。
 *
 * `id` 同時是上鏈快照與 DB row 的共用主鍵 (= MemorialStory.id),用來 dedup:
 * 重複批次上鏈時,id 已在鏈上陣列者不再 append。
 */
export interface Story {
  id: string;
  title: string;
  body: string;
  author?: string; // 顯示名 (訪客自填或屋主)
  authorAddress?: string; // 有連錢包才有
  photo?: StorageURI; // 可選單張 ipfs:// 照片
  date?: string; // 回憶所指日期 (可選, ISO)
  createdAt: string; // 投稿時間 (ISO)
  contentCid?: string; // pin 的 story JSON CID (不可竄改證明)
}

/** 追悼頁的背景主題 id (對應 frontend/src/lib/memorial-themes.ts)。 */
export type MemorialTheme =
  | "paper"
  | "candlelight"
  | "lotus"
  | "night-sky"
  | "autumn"
  | "ocean"
  | "garden"
  | "ink-wash";

export interface DeceasedInfo {
  name: string;
  alias?: string[];
  gender?: "male" | "female" | "other";
  origin?: string; // 籍貫
  birth?: { date: string; place?: string };
  death?: { date: string; place?: string };
  biography?: string;
  epitaph?: string;
}

export interface Assets {
  portrait?: StorageURI;
  photos?: StorageURI[];
  videos?: StorageURI[];
  audios?: StorageURI[];
  texts?: StorageURI[];
  chatlogs?: ChatLogEntry[];
}

export interface Artifact {
  lora?: StorageURI;
  voice?: StorageURI;
  rag?: StorageURI;
  manifest?: StorageURI;
  version?: string;
}

export interface Consent {
  declaredBy: string; // wallet address
  statement: string;
  signedAt: string; // ISO datetime
  signature?: string;
}

/**
 * 即時數位分身 (Simli talking-head avatar) 設定。
 *
 * `simliFaceId` 是 mint 時用逝者大頭照向 Simli 生成的專屬 faceId
 * (POST /faces/trinity)。寫進 metadata 後上鏈,聊天頁開 session 時
 * 後端讀這個欄位用逝者本人的臉做唇形同步。生成失敗 / 配額不足時這個
 * 欄位會缺省,後端會 fallback 到 SIMLI_DEFAULT_FACE_ID (通用形象)。
 *
 * 生成是非同步的 (可能要數分鐘),mint 當下不會等它完成,只先取得
 * faceId。`status` 留下生成當下的狀態快照供前端參考,非權威。
 */
export interface AvatarConfig {
  /** @deprecated Simli 雲端 faceId。改用自建 LAM 渲染機後保留以相容舊資料。 */
  simliFaceId?: string;
  /** 生成提交當下回報的狀態 (e.g. "pending" | "completed")，僅供參考。 */
  status?: string;

  // ── 自建 LAM 渲染機 (YMID-RENDER-API) ──────────────────────────────
  /** LAM avatar 的 label (渲染機 /upload_avatar 回傳)，聊天開 WS 時用。 */
  avatarLabel?: string;
  /** LAM 導出的 3DGS avatar zip 的可下載 URL (渲染機 /static/avatars/<label>.zip
   *  的絕對位址)，前端 WebGL 渲染器載入用。 */
  avatarUrl?: string;
  /** 克隆聲音的 label (渲染機 /upload_voice 回傳)，聊天 TTS 用。 */
  voiceLabel?: string;
}

export interface DSASExtension {
  version: "1.0";
  deceased: DeceasedInfo;
  descendants?: DescendantSnapshot[];
  assets?: Assets;
  artifact?: Artifact;
  consent?: Consent;
  avatar?: AvatarConfig;
  /** 哀悼版回憶的上鏈快照 (屋主策展)。權威即時流在後端 MemorialStory。 */
  stories?: Story[];
  /** 追悼頁選定的背景主題 id。缺省則用預設 (paper)。 */
  background?: MemorialTheme;
  /** 是否公開列在公開總覽 / baibai 選擇頁。缺省視為「不公開」(安全預設)。 */
  public?: boolean;
}

export interface ERC721Attribute {
  trait_type: string;
  value: string | number;
  display_type?: "date" | "number" | "boost_number" | "boost_percentage";
}

export interface TabletMetadata {
  name: string;
  description: string;
  image: StorageURI;
  external_url?: string;
  attributes: ERC721Attribute[];
  dsas: DSASExtension;
}
