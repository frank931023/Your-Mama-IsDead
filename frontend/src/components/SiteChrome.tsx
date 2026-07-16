"use client";

/**
 * 全站 chrome:頂部導覽列 + 底部 footer。
 *
 * 從 layout.tsx 抽出成 client component,因為導覽列需要 usePathname()
 * 標記目前所在頁(layout 本身維持 server component 以保留 metadata)。
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { WalletConnect } from "@/components/WalletConnect";
import { BURNER_CONNECTOR_ID, burnerConnector, shouldReconnectBurner } from "@/lib/burner";
import { useActiveChainId } from "@/lib/app-config";

const NAV_ITEMS = [
  { href: "/about", label: "關於" },
  { href: "/mint", label: "建立燈塔" },
  { href: "/dashboard", label: "燈塔典藏" },
  { href: "/registry", label: "燈塔總覽" },
  { href: "/baibai", label: "線上紀念館" },
] as const;

/** 燭焰標誌:外圈鎏金環 + 內部火焰,呼應「永不熄滅的光」 */
function FlameMark(): React.ReactElement {
  return (
    <span
      className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/40 bg-gold/10 shadow-glow"
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 h-[18px] w-[18px]">
        <path
          d="M12 2.5c.4 3-1 4.6-2.4 6.2C8.2 10.3 7 11.9 7 14.2 7 17.5 9.2 20 12 20s5-2.5 5-5.8c0-2.9-1.9-4.5-3-7-.5-1.2-.8-2.9-2-4.7Z"
          fill="url(#flameGradient)"
        />
        <defs>
          <linearGradient id="flameGradient" x1="12" y1="2.5" x2="12" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f4e3b8" />
            <stop offset="0.55" stopColor="#c9a45e" />
            <stop offset="1" stopColor="#8a6a33" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
}

/**
 * 開發彩蛋:燭焰 logo 在 2.5 秒內連點 5 下 → 連接/斷開 burner 測試錢包。
 * 免裝擴充即可測 SIWE 與簽名流程;詳見 lib/burner.ts。
 */
function useBurnerEasterEgg(): { onLogoClick: () => void; toast: string | null } {
  const { connector, isConnected, status, chainId: connectedChainId } = useAccount();
  const activeChainId = useActiveChainId();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const clicksRef = React.useRef({ n: 0, t: 0 });
  const [toast, setToast] = React.useState<string | null>(null);

  // toast 4 秒後自動消失
  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // 重新整理後接回 burner(等 wagmi 自身的 reconnect 收斂到 disconnected
  // 再動手,避免蓋掉使用者真正錢包的自動回連)
  const attempted = React.useRef(false);
  React.useEffect(() => {
    if (attempted.current || status !== "disconnected" || !shouldReconnectBurner()) return;
    attempted.current = true;
    connect({ connector: burnerConnector(), chainId: activeChainId });
  }, [status, connect, activeChainId]);

  // burner 是自家 connector:admin 切鏈後自動跟隨,不勞使用者手動切網路。
  // (MetaMask 等外部錢包仍走 WalletConnect 元件的「切換網路」提示。)
  React.useEffect(() => {
    if (!isConnected || connector?.id !== BURNER_CONNECTOR_ID) return;
    if (connectedChainId !== undefined && connectedChainId !== activeChainId) {
      switchChain({ chainId: activeChainId });
    }
  }, [isConnected, connector, connectedChainId, activeChainId, switchChain]);

  const onLogoClick = React.useCallback(() => {
    const now = Date.now();
    const prev = clicksRef.current;
    const n = now - prev.t < 2500 ? prev.n + 1 : 1;
    clicksRef.current = { n, t: now };
    if (n < 5) return;
    clicksRef.current = { n: 0, t: 0 };

    if (isConnected && connector?.id === BURNER_CONNECTOR_ID) {
      disconnect();
      setToast("測試錢包已斷開");
    } else {
      connect(
        { connector: burnerConnector(), chainId: activeChainId },
        {
          onSuccess: (data) => {
            const addr = data.accounts[0];
            setToast(`測試錢包已連接 ${addr.slice(0, 6)}…${addr.slice(-4)}`);
          },
          onError: (error) => setToast(`測試錢包連接失敗:${error.message}`),
        },
      );
    }
  }, [connect, disconnect, isConnected, connector, activeChainId]);

  return { onLogoClick, toast };
}

export function SiteHeader(): React.ReactElement {
  const { onLogoClick, toast } = useBurnerEasterEgg();
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/75 backdrop-blur-xl">
      {toast ? (
        <div
          role="status"
          className="glass-panel fixed right-4 top-20 z-50 px-4 py-2 text-sm text-gold-soft animate-fade-up"
        >
          {toast}
        </div>
      ) : null}
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" className="group flex items-center gap-3" onClick={onLogoClick}>
          <FlameMark />
          <span className="flex flex-col leading-none">
            <span className="font-serif text-xl tracking-wide text-ink transition-colors group-hover:text-gold-soft">
              Aeterlux
            </span>
            <span className="mt-1 hidden text-[10px] uppercase tracking-[0.32em] text-ink-muted sm:block">
              數位記憶燈塔
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
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
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "relative rounded-md px-3 py-2 text-gold-soft after:absolute after:inset-x-3 after:-bottom-px after:h-px after:bg-gradient-to-r after:from-transparent after:via-gold after:to-transparent"
          : "rounded-md px-3 py-2 text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
      }
    >
      {children}
    </Link>
  );
}

export function SiteFooter(): React.ReactElement {
  return (
    <footer className="relative mt-24">
      <div className="gold-rule" />
      <div className="container-page grid gap-10 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <FlameMark />
            <span className="font-serif text-lg text-ink">Aeterlux</span>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-ink-muted">
            主權數位先祖系統 — 以區塊鏈確立家族位階,以永久儲存封裝記憶,
            以生成式 AI 賦予數據生命。
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <span className="kicker mb-1">導覽</span>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="w-fit text-ink-muted transition-colors hover:text-gold-soft"
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <span className="kicker mb-1">信任層</span>
          <span className="text-ink-muted">ERC-721 + ERC-6150 · Sepolia</span>
          <span className="text-ink-muted">IPFS 永久封存</span>
          <span className="text-ink-muted">自建 GPU 渲染 · 不出第三方雲</span>
          <span className="text-ink-muted">真實語料 RAG 佐證</span>
        </div>
      </div>
      <div className="border-t border-ink/10">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-ink-muted/80 sm:flex-row sm:items-center sm:justify-between">
          <p>© Aeterlux Prototype · Sovereign Digital Ancestor System</p>
          <p>區塊鏈不可篡改性 · 永久儲存 · 生成式 AI 賦予記憶生命</p>
        </div>
      </div>
    </footer>
  );
}
