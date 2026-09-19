/**
 * Self-describing manifest for an off-line training artifact bundle.
 * Produced by training/pipelines/06_package_artifact.py.
 * Published to IPFS/Arweave; URI written back to NFT via setArtifactURI().
 */

export interface ArtifactManifest {
  tokenId: number;
  version: string;            // "v1", "v2", ...
  createdAt: string;          // ISO datetime
  models: {
    lora?: {
      uri: string;
      base: string;           // "sdxl-1.0" / "flux-dev" / ...
      rank: number;
      steps: number;
    };
    voice?: {
      uri: string;
      backend: "gpt-sovits" | "elevenlabs";
      sampleRate?: number;
    };
    rag?: {
      uri: string;
      embed: string;          // model id
      chunks: number;
      chunkSize: number;
    };
  };
  checksum: string;           // sha256 of bundled artifact
}

export type JobStatus = "QUEUED" | "RUNNING" | "UPLOADED" | "DONE" | "FAILED";

// ── 加密私密素材 (Lit Protocol) ────────────────────────────────────────────
//
// 私密照片、影音、文字與對話紀錄在瀏覽器加密後上傳,只有密文進永久儲存。
// 下方 manifest 本身是公開 JSON,只含密文位置與解密條件,其 URI 經 setArtifactURI 寫上鏈。
//
//   legacy   — Lit 門檻網路:整個檔案(含檔名)以 Lit 網路公鑰直接加密,存取條件寫在 manifest;
//              解密時節點各自驗證 ownerOf 後交出簽章分片,瀏覽器湊滿門檻組合金鑰、本地解密。
//   chipotle — Lit Action:每批一把 AES-256-GCM 檔案金鑰加密檔案,金鑰交給 Action 包裝
//              (keys[]);解鎖時 Action 驗證簽章與 ownerOf 才交回金鑰。

/** 前端 NEXT_PUBLIC_LIT_MODE:none = 不加密;legacy = Lit 門檻網路;chipotle = Lit Action */
export type LitMode = "none" | "legacy" | "chipotle";

/** Lit 門檻加密的存取條件:呼叫合約 ownerOf(tokenId),回傳值須等於請求者 (:userAddress)。 */
export interface LitAccess {
  /** Lit 網路名稱:naga-dev | naga-test | naga */
  network: string;
  /** 條件所查的鏈(Lit 的鏈名稱):sepolia | baseSepolia */
  chain: string;
  accessControlConditions: unknown[];
}

/**
 * Lit Action 模式的金鑰包裝:以 Action 身分公鑰做 ECIES (secp256k1 ECDH → SHA-256 →
 * AES-256-GCM);只有該 Action (CID) 能在 TEE 內解開,解開前驗證錢包簽章與鏈上 ownerOf。
 */
export interface ChipotleWrappedKey {
  mode: "chipotle";
  actionCid: string;
  envelope: {
    /** 臨時公鑰 (未壓縮, 0x04…) */
    ephPub: string;
    /** base64 */
    iv: string;
    /** base64,內容為 JSON { v, tokenId, contract, key } */
    ct: string;
  };
}

export type WrappedKey = ChipotleWrappedKey;

export type PrivateAssetKind = "photo" | "video" | "audio" | "text" | "chatlog";

interface EncryptedArtifactItemBase {
  kind: PrivateAssetKind;
  /** 密文位置 (ar:// / ipfs://) */
  uri: string;
  mime: string;
  /** 原始檔案大小 */
  size: number;
  /** kind = chatlog 時的平台 / 格式 */
  chatlog?: { platform: string; format: string };
}

/** Lit 門檻加密項目:密文由 Lit 網路公鑰直接加密(內含檔名),條件見 manifest.access。 */
export interface LitEncryptedItem extends EncryptedArtifactItemBase {
  /** 被加密資料的 SHA-256;與存取條件一起構成 Lit 的身分參數,解密時用來綁定是哪一份資料 */
  dataToEncryptHash: string;
}

/** 檔案金鑰加密項目 (chipotle):AES-256-GCM,金鑰在 manifest.keys[]。 */
export interface KeyEncryptedItem extends EncryptedArtifactItemBase {
  /** 對應 manifest.keys[].id */
  keyId: string;
  /** AES-GCM IV,base64 */
  iv: string;
  /** 原始檔名以同一把金鑰加密 (檔名可能含人名,不放明文);base64 */
  encName: { iv: string; ct: string };
}

export type EncryptedArtifactItem = LitEncryptedItem | KeyEncryptedItem;

export interface EncryptedArtifactManifest {
  type: "aeterlux-encrypted-artifact";
  version: 2;
  tokenId: string;
  contract: string;
  chainId: number;
  /** Lit 門檻加密項目共用的存取條件(有這類項目時才有) */
  access?: LitAccess;
  /** chipotle 項目的檔案金鑰;每批上傳一把,補傳時 append 新的一把,不必解開舊的 */
  keys?: Array<{ id: string; wrapped: WrappedKey; createdAt: string }>;
  items: EncryptedArtifactItem[];
}
