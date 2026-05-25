/**
 * Next.js App Router root layout
 *
 * 包住所有頁面共用的 chrome:
 *   - <SiteHeader>  頂部導覽列 + 錢包連線按鈕
 *   - <main>        實際頁面內容
 *   - <SiteFooter>  底部版權聲明
 *
 * Providers 在內層套上 wagmi / RainbowKit / 錯誤 modal context。
 */
import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";
import { Providers } from "./providers";
import { WalletConnect } from "@/components/WalletConnect";

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
      <body className="min-h-screen flex flex-col">
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}

function SiteHeader(): React.ReactElement {
  return (
    <header className="border-b border-ink/10 bg-paper/85 backdrop-blur-sm">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-serif text-xl tracking-wide text-ink">Aeterlux</span>
          <span className="hidden text-xs uppercase tracking-[0.3em] text-ink-muted sm:block">
            數位記憶燈塔
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavLink href="/about">關於</NavLink>
          <NavLink href="/mint">建立燈塔</NavLink>
          <NavLink href="/dashboard">燈塔典藏</NavLink>
          <NavLink href="/registry">燈塔總覽</NavLink>
          <NavLink href="/baibai">線上紀念館</NavLink>
        </nav>
        <div className="hidden md:block">
          <WalletConnect compact />
        </div>
      </div>
      <div className="container-page pb-3 md:hidden">
        <WalletConnect compact />
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
    >
      {children}
    </Link>
  );
}

function SiteFooter(): React.ReactElement {
  return (
    <footer className="border-t border-ink/10 bg-paper-soft/50">
      <div className="container-page flex flex-col gap-2 py-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© Aeterlux Prototype · Sovereign Digital Ancestor System</p>
        <p>區塊鏈不可篡改性 · Arweave 永久封存 · 生成式 AI 賦予記憶生命</p>
      </div>
    </footer>
  );
}
