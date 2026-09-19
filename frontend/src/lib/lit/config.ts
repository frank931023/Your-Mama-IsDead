/**
 * Lit Protocol 加密設定(NEXT_PUBLIC_LIT_MODE 切換,與 STORAGE_DRIVER 同一套環境變數開關)
 *
 *   none     — 不加密;私密素材照舊放在公開 metadata(預設)
 *   legacy   — Lit 門檻網路:檔案以 Lit 網路公鑰直接加密,存取條件 = ownerOf(tokenId);
 *              SDK 執行時從 CDN 載入,連不上網路時鑄造前的檢查會失敗
 *   chipotle — Lit Action 模式;需先跑 backend/scripts/lit-chipotle-setup.ts
 *
 * 啟用加密後:相簿、影音、文字、對話紀錄在瀏覽器加密,只有密文進永久儲存;公開 metadata
 * 只留大頭照等墓碑級資訊,私密素材清單寫進 artifactURI 指向的 manifest。
 */
import type { LitMode } from "@shared/types/artifact";

function parseMode(value: string | undefined): LitMode {
  return value === "legacy" || value === "chipotle" ? value : "none";
}

export const LIT_MODE: LitMode = parseMode(process.env.NEXT_PUBLIC_LIT_MODE);
export const litEnabled = LIT_MODE !== "none";

export const LIT_MODE_LABEL: Record<LitMode, string> = {
  none: "未加密",
  legacy: "Lit 門檻網路",
  chipotle: "Lit Action",
};

/** 塔位合約所在鏈:Lit 存取條件與 Action 的 ownerOf 檢查都查這條鏈。 */
export const LIT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111);
/** legacy 存取條件用的 Lit 鏈名稱 */
export const LIT_CHAIN = LIT_CHAIN_ID === 84532 ? "baseSepolia" : "sepolia";

/** legacy 模式連線的網路:naga-dev | naga-test | naga */
export const LEGACY_NETWORK = process.env.NEXT_PUBLIC_LIT_LEGACY_NETWORK ?? "naga-dev";

/** chipotle 模式設定;ACTION_CID / USAGE_KEY / ACTION_PUBKEY 由 lit-chipotle-setup.ts 產生。 */
export const CHIPOTLE = {
  apiUrl: (process.env.NEXT_PUBLIC_LIT_CHIPOTLE_API_URL ?? "https://api.chipotle.litprotocol.com").replace(
    /\/+$/,
    "",
  ),
  /** usage key:只能執行本專案群組內的 Action,官方文件說明可放在前端。 */
  usageKey: process.env.NEXT_PUBLIC_LIT_CHIPOTLE_USAGE_KEY ?? "",
  actionCid: process.env.NEXT_PUBLIC_LIT_CHIPOTLE_ACTION_CID ?? "",
  /** Action 身分公鑰;未設定時加密前會呼叫 Action 取得(每次約 US$0.01)。 */
  actionPublicKey: process.env.NEXT_PUBLIC_LIT_CHIPOTLE_ACTION_PUBKEY ?? "",
};
