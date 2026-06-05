/**
 * 最小型別宣告:gaussian-splat-renderer-for-lam (npm 套件無自帶 .d.ts)。
 *
 * 只描述本專案實際用到的 API。其餘 export 不宣告 → 不會被誤用。
 * 這裡刻意放在獨立 .d.ts 而非元件內 `declare module`:該套件完全沒有型別,
 * 在元件檔裡 `declare module` 會被 TS 當成「模組擴充 (augmentation)」,要求模組
 * 本身先可解析,於是報 TS2664 / TS2307。獨立 ambient 宣告才能讓 import 成立。
 */
declare module "gaussian-splat-renderer-for-lam" {
  export interface GaussianSplatRendererOptions {
    /** 渲染器每幀來「拉」:回傳 ARKit 通道名 → 權重 (0–1) 的 dict。 */
    getExpressionData?: () => Record<string, number>;
    /** 可選,本專案不用。 */
    getChatState?: () => unknown;
    /** hex 色字串不帶 #,可選。 */
    backgroundColor?: string;
    /** 0–1,可選。 */
    alpha?: number;
    downloadProgress?: (p: number) => void;
    loadProgress?: (p: number) => void;
  }

  export class GaussianSplatRenderer {
    /** 單例工廠。出錯可能回傳 undefined,呼叫端要判空。 */
    static getInstance(
      container: HTMLElement,
      avatarZipUrl: string,
      options?: GaussianSplatRendererOptions,
    ): Promise<GaussianSplatRenderer | undefined>;
    /** 釋放 viewer / mixer / 動畫資源 (卸載時呼叫,盡量歸還 WebGL context)。 */
    disposeModel?: () => void;
  }
}
