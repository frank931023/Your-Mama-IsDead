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

export interface DSASExtension {
  version: "1.0";
  deceased: DeceasedInfo;
  descendants?: DescendantSnapshot[];
  assets?: Assets;
  artifact?: Artifact;
  consent?: Consent;
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
