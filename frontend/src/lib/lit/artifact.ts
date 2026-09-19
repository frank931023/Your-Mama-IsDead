/**
 * 加密私密素材的封存與解鎖
 *
 * legacy(Lit 門檻網路,系統概述文件描述的做法):
 *   封存:每個檔案(含檔名)在瀏覽器以 Lit 網路公鑰直接加密,存取條件 = ownerOf(tokenId)
 *        必須等於請求者;只上傳密文,manifest 記密文位置、資料雜湊與存取條件。
 *   解鎖:錢包簽名證明身分 → Lit 節點各自上鏈驗證 ownerOf → 交出簽章分片 → 瀏覽器湊滿
 *        門檻組合出解密金鑰,下載密文本地解密。
 * chipotle(Lit Action):
 *   Action 沒有門檻加密可用,改用檔案金鑰:每批一把 AES-256-GCM 金鑰在瀏覽器加密檔案,
 *   金鑰交給 Action 包裝後寫進 manifest.keys[];解鎖時 Action 驗證簽章與 ownerOf 才交回金鑰。
 *
 * 兩種項目可以共存在同一份 manifest(例如切換模式後補傳),解鎖時依項目各自的格式處理。
 */
import type { WalletClient } from "viem";
import type {
  EncryptedArtifactItem,
  EncryptedArtifactManifest,
  KeyEncryptedItem,
  LitAccess,
  PrivateAssetKind,
} from "@shared/types/artifact";
import type { ChatLogEntry } from "@shared/types/tablet";
import { uploadRelay, type PrivateChatlogText } from "@/lib/api";
import { CONTRACT_ADDRESS } from "@/lib/contract";
import { ipfsToHttps } from "@/lib/utils";
import { LEGACY_NETWORK, LIT_CHAIN_ID, LIT_MODE } from "./config";
import { b64ToBytes, bytesToB64, decryptBytes, encryptBytes, importFileKey, newFileKey } from "./envelope";
import { chipotlePreflight, chipotleUnwrap, chipotleWrap, signUnlock, type UnlockAuth } from "./chipotle";
import {
  legacyAccess,
  legacyAuth,
  legacyDecrypt,
  legacyEncrypt,
  legacyPreflight,
  type LegacyAuth,
} from "./legacy";
import { packNamed, unpackNamed } from "./payload";
import { getStashedFile, isLocalUri } from "./pending-files";

// 剛經 Irys 上傳、尚未被 arweave.net 索引的密文,從 Irys 閘道也讀得到。
const IRYS_GATEWAY = "https://gateway.irys.xyz/";

export interface PrivateFileInput {
  kind: PrivateAssetKind;
  file: File;
  chatlog?: { platform: string; format: string };
}

export type SealStage = "preparing" | "encrypting" | "uploading" | "manifest";

/** 依目前模式確認 Lit 可用;鑄造前呼叫,失敗就不鑄造。 */
export async function preflightLit(): Promise<void> {
  if (LIT_MODE === "legacy") await legacyPreflight();
  else if (LIT_MODE === "chipotle") await chipotlePreflight();
}

/** chipotle 模式的項目(以檔案金鑰加密);其餘為 Lit 門檻加密項目。 */
export function isKeyItem(item: EncryptedArtifactItem): item is KeyEncryptedItem {
  return "keyId" in item;
}

/**
 * 從草稿挑出暫存 (local:) 的私密素材;已上傳的 URI 是公開素材,不在此列。
 * 暫存檔在重新整理後就不見了,找不到的直接略過。
 */
export function stashedInputs(
  groups: ReadonlyArray<readonly [PrivateAssetKind, ReadonlyArray<{ uri: string }>]>,
  chatlogs: ReadonlyArray<ChatLogEntry> = [],
): PrivateFileInput[] {
  const out: PrivateFileInput[] = [];
  for (const [kind, assets] of groups) {
    for (const { uri } of assets) {
      const file = isLocalUri(uri) ? getStashedFile(uri) : undefined;
      if (file) out.push({ kind, file });
    }
  }
  for (const entry of chatlogs) {
    const file = isLocalUri(entry.uri) ? getStashedFile(entry.uri) : undefined;
    if (file) {
      out.push({ kind: "chatlog", file, chatlog: { platform: entry.platform, format: entry.format } });
    }
  }
  return out;
}

/** 封存後把對話紀錄原文配上加密項目的 uri,交給後端建立 AI 記憶索引。 */
export async function privateChatlogTexts(
  files: ReadonlyArray<PrivateFileInput>,
  added: ReadonlyArray<EncryptedArtifactItem>,
): Promise<PrivateChatlogText[]> {
  const out: PrivateChatlogText[] = [];
  for (const [i, input] of files.entries()) {
    const item = added[i];
    if (input.kind !== "chatlog" || !input.chatlog || !item) continue;
    out.push({ uri: item.uri, ...input.chatlog, text: await input.file.text() });
  }
  return out;
}

function itemBase(input: PrivateFileInput, uri: string) {
  return {
    kind: input.kind,
    uri,
    mime: input.file.type || "application/octet-stream",
    size: input.file.size,
    ...(input.chatlog ? { chatlog: input.chatlog } : {}),
  };
}

async function uploadCiphertext(
  body: BlobPart,
  input: PrivateFileInput,
  tokenId: bigint,
  index: number,
): Promise<string> {
  const uploaded = await uploadRelay(
    new File([body], `${input.kind}-${tokenId}-${Date.now()}-${index}.enc`, {
      type: "application/octet-stream",
    }),
  );
  return uploaded.uri;
}

export async function sealPrivateAssets(params: {
  tokenId: bigint;
  files: PrivateFileInput[];
  /** 補傳時傳入現有 manifest:新項目 append 進去,不必解開舊的 */
  existing?: EncryptedArtifactManifest | null;
  onStage?: (stage: SealStage, detail?: string) => void;
}): Promise<{
  manifest: EncryptedArtifactManifest;
  manifestUri: string;
  /** 本次新增的項目,順序與 files 相同 */
  added: EncryptedArtifactItem[];
}> {
  const { tokenId, files, existing, onStage } = params;
  if (LIT_MODE === "none") throw new Error("NEXT_PUBLIC_LIT_MODE=none,未啟用加密");

  const base: EncryptedArtifactManifest = existing ?? {
    type: "aeterlux-encrypted-artifact",
    version: 2,
    tokenId: tokenId.toString(),
    contract: CONTRACT_ADDRESS,
    chainId: LIT_CHAIN_ID,
    items: [],
  };
  const items: EncryptedArtifactItem[] = [];
  let access = base.access;
  let keys = base.keys;

  onStage?.("preparing");
  if (LIT_MODE === "legacy") {
    // 同一份 manifest 的門檻加密項目共用一組存取條件(條件只跟 tokenId 有關,本來就相同)
    if (access && access.network !== LEGACY_NETWORK) {
      throw new Error(
        `現有私密素材以 Lit 網路 ${access.network} 加密,目前設定為 ${LEGACY_NETWORK},無法混用`,
      );
    }
    access ??= await legacyAccess(tokenId);
    for (const [i, input] of files.entries()) {
      onStage?.("encrypting", input.file.name);
      const payload = packNamed(input.file.name, new Uint8Array(await input.file.arrayBuffer()));
      const { ciphertext, dataToEncryptHash } = await legacyEncrypt(payload, access);
      onStage?.("uploading", input.file.name);
      items.push({ ...itemBase(input, await uploadCiphertext(ciphertext, input, tokenId, i)), dataToEncryptHash });
    }
  } else {
    // 先包裝金鑰(失敗就不必上傳任何密文)
    const { key, raw } = await newFileKey();
    const keyId = crypto.randomUUID();
    const wrapped = await chipotleWrap(raw, tokenId);
    keys = [...(keys ?? []), { id: keyId, wrapped, createdAt: new Date().toISOString() }];
    for (const [i, input] of files.entries()) {
      onStage?.("encrypting", input.file.name);
      const { ciphertext, iv } = await encryptBytes(key, await input.file.arrayBuffer());
      onStage?.("uploading", input.file.name);
      const uri = await uploadCiphertext(ciphertext as BlobPart, input, tokenId, i);
      const encName = await encryptBytes(key, new TextEncoder().encode(input.file.name));
      items.push({
        ...itemBase(input, uri),
        keyId,
        iv,
        encName: { iv: encName.iv, ct: bytesToB64(encName.ciphertext) },
      });
    }
  }

  const manifest: EncryptedArtifactManifest = {
    ...base,
    version: 2,
    ...(access ? { access } : {}),
    ...(keys ? { keys } : {}),
    items: [...base.items, ...items],
  };

  onStage?.("manifest");
  const uploaded = await uploadRelay(
    new File([JSON.stringify(manifest, null, 2)], `artifact-${tokenId}-${Date.now()}.json`, {
      type: "application/json",
    }),
  );
  return { manifest, manifestUri: uploaded.uri, added: items };
}

async function fetchFromStorage(uri: string): Promise<Response> {
  const urls = [ipfsToHttps(uri)];
  if (uri.startsWith("ar://")) urls.push(IRYS_GATEWAY + uri.slice("ar://".length));
  let last: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      last = new Error(`${res.status} ${url}`);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * 讀取 artifactURI;沒設定或不是加密素材 manifest(例如舊的訓練產物)時回 null。
 * 下載失敗會 throw —— 補傳時若把「暫時讀不到」當成「沒有」,新 manifest 會蓋掉舊的指標。
 */
export async function fetchArtifactManifest(
  uri: string | null | undefined,
): Promise<EncryptedArtifactManifest | null> {
  if (!uri) return null;
  const res = await fetchFromStorage(uri);
  let json: Partial<EncryptedArtifactManifest>;
  try {
    json = (await res.json()) as Partial<EncryptedArtifactManifest>;
  } catch {
    return null;
  }
  return json?.type === "aeterlux-encrypted-artifact" ? (json as EncryptedArtifactManifest) : null;
}

export interface UnlockDeps {
  /** legacy 項目:向 Lit 節點證明身分用 */
  walletClient?: WalletClient;
  /** chipotle 項目:簽解鎖訊息用 */
  signMessage?: (message: string) => Promise<string>;
}

export interface UnlockSession {
  /** chipotle 項目解開的檔案金鑰,key = manifest.keys[].id */
  keys: Map<string, CryptoKey>;
  /** legacy 項目的身分證明(一次簽名),之後每個檔案的解密請求都附上它 */
  lit?: { auth: LegacyAuth; access: LitAccess };
}

/**
 * 建立解鎖 session:錢包簽一次名;chipotle 的檔案金鑰在此取回,門檻加密項目則等 decryptItem
 * 時逐檔向 Lit 節點請求(節點各自驗證 ownerOf)。依項目當初的加密方式處理,不看目前的 LIT_MODE。
 */
export async function unlockArtifact(
  manifest: EncryptedArtifactManifest,
  tokenId: bigint,
  deps: UnlockDeps,
): Promise<UnlockSession> {
  const session: UnlockSession = { keys: new Map() };

  if (manifest.items.some((item) => !isKeyItem(item))) {
    if (!manifest.access) throw new Error("加密素材清單缺少存取條件,無法解鎖");
    if (!deps.walletClient) throw new Error("請先連接錢包");
    session.lit = { auth: await legacyAuth(deps.walletClient, manifest.access.network), access: manifest.access };
  }

  const usedKeyIds = new Set(manifest.items.filter(isKeyItem).map((item) => item.keyId));
  let chipotleAuth: UnlockAuth | null = null; // 多把金鑰共用一次簽名
  for (const { id, wrapped } of manifest.keys ?? []) {
    if (!usedKeyIds.has(id)) continue;
    if (wrapped.mode !== "chipotle") throw new Error(`不支援的金鑰包裝方式:${String(wrapped.mode)}`);
    if (!deps.signMessage) throw new Error("請先連接錢包");
    chipotleAuth ??= await signUnlock(tokenId, deps.signMessage);
    session.keys.set(id, await importFileKey(await chipotleUnwrap(wrapped, tokenId, chipotleAuth)));
  }
  return session;
}

export interface DecryptedItem {
  item: EncryptedArtifactItem;
  name: string;
  blob: Blob;
}

export async function decryptItem(item: EncryptedArtifactItem, session: UnlockSession): Promise<DecryptedItem> {
  if (isKeyItem(item)) {
    const key = session.keys.get(item.keyId);
    if (!key) throw new Error("缺少解密金鑰");
    const name = new TextDecoder().decode(await decryptBytes(key, b64ToBytes(item.encName.ct), item.encName.iv));
    const ciphertext = await (await fetchFromStorage(item.uri)).arrayBuffer();
    const plain = await decryptBytes(key, ciphertext, item.iv);
    return { item, name, blob: new Blob([plain], { type: item.mime }) };
  }
  if (!session.lit) throw new Error("尚未建立 Lit 解鎖 session");
  const ciphertext = await (await fetchFromStorage(item.uri)).text();
  const plain = await legacyDecrypt({
    ciphertext,
    dataToEncryptHash: item.dataToEncryptHash,
    access: session.lit.access,
    auth: session.lit.auth,
  });
  const { name, bytes } = unpackNamed(plain);
  return { item, name, blob: new Blob([bytes as BlobPart], { type: item.mime }) };
}
