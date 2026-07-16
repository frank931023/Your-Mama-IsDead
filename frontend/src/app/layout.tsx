/**
 * Next.js App Router root layout
 *
 * 包住所有頁面共用的 chrome:
 *   - <SiteHeader>  頂部導覽列 + 錢包連線按鈕(client, 見 SiteChrome.tsx)
 *   - <main>        實際頁面內容
 *   - <SiteFooter>  底部品牌/導覽/信任層
 *
 * 字體用 next/font 自載(思源宋體/黑體),以 CSS 變數餵給 tailwind 的
 * font-serif / font-sans;CJK 字體走 unicode-range 切片、不預載全量。
 * Providers 在內層套上 wagmi / RainbowKit / 錯誤 modal context。
 */
import type { Metadata } from "next";
import { Noto_Sans_TC, Noto_Serif_TC } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

const fontSans = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
  preload: false,
});

const fontSerif = Noto_Serif_TC({
  subsets: ["latin"],
  weight: ["500", "600", "700", "900"],
  variable: "--font-serif",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Aeterlux · 數位記憶燈塔",
  description:
    "數位記憶燈塔 · Digital Memory Lighthouse — 透過區塊鏈、永久儲存與生成式 AI,為每段生命留下永不熄滅的光。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="zh-Hant">
      <body
        className={`${fontSans.variable} ${fontSerif.variable} flex min-h-screen flex-col font-sans`}
      >
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
