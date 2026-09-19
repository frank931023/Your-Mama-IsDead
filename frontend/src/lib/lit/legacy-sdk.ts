/**
 * Lit 門檻網路 SDK (v8) 的 CDN 載入器
 *
 * SDK 刻意不裝進專案(其 peer dependency 要求的 viem 版本與前端衝突),只在 legacy 模式
 * 執行時從 esm.sh 動態載入。測試時以 mock 取代這個模組,其餘 Lit 程式碼照常執行。
 */
export const SDK_URLS = {
  client: "https://esm.sh/@lit-protocol/lit-client@8.3.1",
  networks: "https://esm.sh/@lit-protocol/networks@8.4.1",
  auth: "https://esm.sh/@lit-protocol/auth@8.2.3",
  acc: "https://esm.sh/@lit-protocol/access-control-conditions@8.0.2",
} as const;

export type SdkModuleName = keyof typeof SDK_URLS;

// CDN 模組沒有型別;介面依 @lit-protocol/*@8 的型別定義呼叫。
export type SdkModule = any;

export function loadSdk(name: SdkModuleName): Promise<SdkModule> {
  return import(/* webpackIgnore: true */ SDK_URLS[name]);
}
