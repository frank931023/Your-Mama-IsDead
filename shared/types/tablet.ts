/**
 * NFT metadata schema for a 數位塔位 (Digital Tablet).
 * Conforms to ERC-721 metadata + DSAS extension namespace.
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
