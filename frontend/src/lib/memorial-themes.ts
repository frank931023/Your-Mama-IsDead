/**
 * 追悼頁背景主題庫 (預設、可挑選,非自由上傳)。
 *
 * 每個主題 = 背景素材 (heroImage 靜態圖或動圖,放在 /public/memorial-bg/)
 * + 幾個顏色 token —— 套用時用 inline style (Tailwind 無法 JIT 動態值)。
 * 屋主在塔位編輯頁挑一個,id 寫進 metadata.dsas.background 上鏈;
 * 追悼頁 (MemorialScroll) 讀回來套版。
 *
 * Hero 背景優先序:heroVideo (mp4) > heroImage (jpg/gif) > heroBg 漸層。
 * 素材來源:Wikimedia Commons 自由授權檔案 (詳見 /public/memorial-bg/README.md)。
 *
 * 設計:
 *   - 淺色主題 (paper/lotus/garden/ink-wash) 用深字,photo 背景加白紗 overlay 保可讀
 *   - 深色主題 (candlelight/night-sky/autumn/ocean) 用淺字,hero 上加 overlay 暗罩
 *   - paper/candlelight 沿用既有 ink/gold/paper 色,確保預設外觀與舊版一致
 */
import type { MemorialTheme } from "@shared/types/tablet";

/** Hero banner 上的動態粒子層類型 (純 Canvas 繪製,無 asset)。 */
export type ParticleKind = "sakura" | "petals" | "candle" | "stars" | "snow" | "leaves" | "none";

export interface MemorialThemeDef {
  id: MemorialTheme;
  label: string; // 中文顯示名
  /** 整頁內容區的底色 (banner 之下,維持乾淨淺/深底)。 */
  background: string;
  /** Hero banner(上半部背景牆)的 CSS 背景 —— heroImage 載入前 / 缺省時的 fallback。 */
  heroBg: string;
  /**
   * Hero banner 背景圖 (/public/memorial-bg/ 下的靜態 jpg 或動態 gif)。
   * 渲染成 background-image: center/cover。
   */
  heroImage?: string;
  /**
   * 可選:Hero banner 用循環影片當動態背景牆 (放在 /public/memorial-bg/ 下,
   * 例如 "/memorial-bg/sakura.mp4")。給了就優先用 <video>。
   */
  heroVideo?: string;
  /** Hero banner 上疊的動態粒子層 (櫻花/燭光/星/雪…)。 */
  particles: ParticleKind;
  /** 強調色 (hairline / label / icon)。 */
  accent: string;
  /** 在內容區背景上可讀的本文色。 */
  text: string;
  /** 次要文字色 (說明 / 日期)。 */
  textMuted: string;
  /** 卡片底色 (半透明)。 */
  card: string;
  /** Hero banner 上的文字色 (banner 背景通常較深/花,需獨立指定)。 */
  heroText: string;
  /** 深色主題在 hero 肖像上加的暗罩 (淺色主題留空)。 */
  overlay?: string;
  /** 是否深色基底 (決定按鈕等元件用淺色變體)。 */
  dark?: boolean;
}

export const MEMORIAL_THEMES: MemorialThemeDef[] = [
  {
    id: "paper",
    label: "宣紙",
    background: "linear-gradient(180deg, #f8f4ec 0%, #f1ead9 100%)",
    heroBg: "linear-gradient(135deg, #efe6d2 0%, #e7dcc2 50%, #ddd0b2 100%)",
    heroImage: "/memorial-bg/paper.jpg",
    particles: "petals",
    accent: "#b08a3e",
    text: "#1a1814",
    textMuted: "#6b665e",
    card: "rgba(255, 255, 255, 0.7)",
    heroText: "#3a3326",
    overlay: "linear-gradient(180deg, rgba(255,252,245,0.25) 0%, rgba(255,252,245,0.05) 100%)",
  },
  {
    id: "candlelight",
    label: "燭光",
    background: "linear-gradient(180deg, #f7f1e8 0%, #efe5d4 100%)",
    heroBg: "radial-gradient(120% 120% at 50% 30%, #3a2a1c 0%, #1c140d 60%, #0d0a08 100%)",
    heroImage: "/memorial-bg/candlelight.gif",
    particles: "candle",
    accent: "#d99441",
    text: "#241c12",
    textMuted: "#6f6453",
    card: "rgba(255, 255, 255, 0.75)",
    heroText: "#f6e9d2",
    overlay: "linear-gradient(180deg, rgba(13,10,8,0.1) 0%, rgba(13,10,8,0.55) 100%)",
  },
  {
    id: "lotus",
    label: "蓮池",
    background: "linear-gradient(180deg, #f0f5f1 0%, #e6efe8 100%)",
    heroBg: "linear-gradient(135deg, #cfe0d6 0%, #bcd6cc 50%, #a9cbc0 100%)",
    heroImage: "/memorial-bg/lotus.jpg",
    particles: "petals",
    accent: "#5f8a72",
    text: "#23302a",
    textMuted: "#5d6f64",
    card: "rgba(255, 255, 255, 0.72)",
    heroText: "#ffffff",
    overlay: "linear-gradient(180deg, rgba(20,40,30,0.15) 0%, rgba(20,40,30,0.45) 100%)",
  },
  {
    id: "night-sky",
    label: "星夜",
    background: "linear-gradient(180deg, #f4f5fa 0%, #e9ecf6 100%)",
    heroBg: "radial-gradient(130% 130% at 50% 20%, #1b2a52 0%, #111b3a 55%, #0a0f22 100%)",
    heroImage: "/memorial-bg/night-sky.jpg",
    particles: "stars",
    accent: "#5b6dc0",
    text: "#1b2138",
    textMuted: "#5b6480",
    card: "rgba(255, 255, 255, 0.75)",
    heroText: "#eaf0ff",
    overlay: "linear-gradient(180deg, rgba(10,15,34,0.1) 40%, rgba(10,15,34,0.5) 100%)",
  },
  {
    id: "autumn",
    label: "秋楓",
    background: "linear-gradient(180deg, #f8efe6 0%, #f0e2d3 100%)",
    heroBg: "linear-gradient(135deg, #7a3a1e 0%, #93481f 50%, #a85626 100%)",
    heroImage: "/memorial-bg/autumn.jpg",
    particles: "leaves",
    accent: "#c46a2a",
    text: "#3a2114",
    textMuted: "#7a5b46",
    card: "rgba(255, 255, 255, 0.75)",
    heroText: "#fdf3e3",
    overlay: "linear-gradient(180deg, rgba(58,30,18,0.25) 0%, rgba(58,30,18,0.55) 100%)",
  },
  {
    id: "ocean",
    label: "海洋",
    background: "linear-gradient(180deg, #eef6f8 0%, #e2eff2 100%)",
    heroBg: "linear-gradient(135deg, #0f3b48 0%, #155a6b 50%, #1c7286 100%)",
    heroImage: "/memorial-bg/ocean.gif",
    particles: "none",
    accent: "#2f93a8",
    text: "#123038",
    textMuted: "#4d6a72",
    card: "rgba(255, 255, 255, 0.75)",
    heroText: "#f2fbfd",
    overlay: "linear-gradient(180deg, rgba(14,42,51,0.2) 0%, rgba(14,42,51,0.5) 100%)",
  },
  {
    id: "garden",
    label: "花園",
    background: "linear-gradient(180deg, #f4f7ec 0%, #ecf0dd 100%)",
    heroBg: "linear-gradient(135deg, #d6e2bc 0%, #c6d8a6 50%, #b6cd92 100%)",
    heroImage: "/memorial-bg/garden.jpg",
    particles: "sakura",
    accent: "#7e9b4a",
    text: "#26301a",
    textMuted: "#5e6b4a",
    card: "rgba(255, 255, 255, 0.72)",
    heroText: "#ffffff",
    overlay: "linear-gradient(180deg, rgba(30,40,18,0.15) 0%, rgba(30,40,18,0.45) 100%)",
  },
  {
    id: "ink-wash",
    label: "水墨",
    background: "linear-gradient(180deg, #f7f7f5 0%, #ededeb 100%)",
    heroBg: "linear-gradient(135deg, #e3e3e0 0%, #cfcfcc 50%, #b9b9b5 100%)",
    heroImage: "/memorial-bg/ink-wash.jpg",
    particles: "snow",
    accent: "#3a3a38",
    text: "#16160f",
    textMuted: "#5a5a55",
    card: "rgba(255, 255, 255, 0.7)",
    heroText: "#fffdf6",
    overlay: "linear-gradient(180deg, rgba(30,30,28,0.2) 0%, rgba(30,30,28,0.5) 100%)",
  },
];

export const DEFAULT_THEME: MemorialTheme = "paper";

/** 依 id 取主題定義,查無 (含 undefined) 回預設 paper。 */
export function getTheme(id?: MemorialTheme): MemorialThemeDef {
  const found = id ? MEMORIAL_THEMES.find((t) => t.id === id) : undefined;
  return found ?? MEMORIAL_THEMES[0]!;
}
