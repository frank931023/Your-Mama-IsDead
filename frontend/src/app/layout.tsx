import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";
import { Providers } from "./providers";
import { WalletConnect } from "@/components/WalletConnect";

export const metadata: Metadata = {
  title: "DSAS · 數位塔位",
  description:
    "主權數位先祖系統 · Decentralized Sovereign Ancestor System — 透過區塊鏈、永久儲存與生成式 AI,為每個家族建立永不熄滅的記憶燈塔。",
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
          <span className="font-serif text-xl tracking-wide text-ink">DSAS</span>
          <span className="hidden text-xs uppercase tracking-[0.3em] text-ink-muted sm:block">
            數位塔位
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavLink href="/about">關於</NavLink>
          <NavLink href="/mint">鑄造</NavLink>
          <NavLink href="/dashboard">我的塔位</NavLink>
          <NavLink href="/registry">塔位總覽</NavLink>
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
        <p>© DSAS Prototype · Sovereign Digital Ancestor System</p>
        <p>區塊鏈不可篡改性 · Arweave 永久封存 · 生成式 AI 賦予記憶生命</p>
      </div>
    </footer>
  );
}
