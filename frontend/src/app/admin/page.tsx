"use client";

/**
 * Admin 控制台 — 單密碼登入 + 測試模式切換
 *
 * 密碼驗證在 backend(POST /api/admin/login,比對 env.ADMIN_PASSWORD),
 * 前端只保管簽回來的 12h admin JWT(sessionStorage)。
 *
 * 可切換:
 *   儲存模式  pinata | local   上傳釘 IPFS 還是存 backend 本地磁碟
 *   鏈模式    real   | local   打 Sepolia 還是本地 anvil
 * 切換即時生效:全站經 useAppConfig() 在下一個 refetch 週期跟上。
 *
 * 另附「餵 gas」:chain mode = local 時用 anvil_setBalance 給任意地址
 * 發測試 ETH(給 burner 測試錢包用,免 faucet)。
 */
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { CheckCircle2, Fuel, HardDrive, Link2, LogOut, ShieldCheck, XCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BACKEND_URL } from "@/lib/api";
import { APP_CONFIG_QUERY_KEY } from "@/lib/app-config";
import { cn } from "@/lib/utils";

const ADMIN_TOKEN_KEY = "aeterlux.admin.token";

interface AdminChainInfo {
  chainId: number;
  rpcUrl: string;
  contractAddress: string;
  rpcOk: boolean;
}

interface AdminConfig {
  storageMode: "pinata" | "local";
  chainMode: "real" | "local";
  pinataConfigured: boolean;
  chains: { real: AdminChainInfo; local: AdminChainInfo };
}

function readAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

async function adminFetch<T>(
  token: string,
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
    throw new Error(body.hint ?? body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export default function AdminPage(): React.ReactElement {
  const [token, setToken] = React.useState<string | null>(readAdminToken);

  const handleLogout = React.useCallback(() => {
    window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken(null);
  }, []);

  return (
    <div className="container-page flex flex-col gap-8 py-14">
      <header className="flex flex-col gap-2">
        <p className="kicker">Admin Console</p>
        <h1 className="font-serif text-3xl text-ink">系統控制台</h1>
        <p className="text-sm text-ink-muted">
          切換測試模式(本地上傳 / 本地鏈)與工具。切換即時生效,全站自動跟上。
        </p>
      </header>
      {token ? (
        <AdminPanel token={token} onUnauthorized={handleLogout} onLogout={handleLogout} />
      ) : (
        <LoginCard onToken={setToken} />
      )}
    </div>
  );
}

function LoginCard({ onToken }: { onToken: (t: string) => void }): React.ReactElement {
  const [emptyWarn, setEmptyWarn] = React.useState(false);
  const login = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch(`${BACKEND_URL}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; hint?: string };
      if (!res.ok || !body.token) throw new Error(body.hint ?? body.error ?? `HTTP ${res.status}`);
      return body.token;
    },
    onSuccess: (t) => {
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, t);
      onToken(t);
    },
  });

  return (
    <form
      className="glass-panel flex max-w-md flex-col gap-4 p-8"
      onSubmit={(e) => {
        e.preventDefault();
        // 直接從 DOM 讀值:瀏覽器 autofill 不觸發 React onChange,
        // 走 state 會拿到空字串、按鈕永遠按不下去
        const pw = String(new FormData(e.currentTarget).get("password") ?? "");
        setEmptyWarn(!pw);
        if (pw) login.mutate(pw);
      }}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold-soft">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="font-serif text-lg text-ink">管理員登入</h2>
      </div>
      <Input
        type="password"
        name="password"
        label="密碼"
        placeholder="ADMIN_PASSWORD"
        errorText={
          login.error
            ? `登入失敗:${login.error.message}`
            : emptyWarn
              ? "請輸入密碼"
              : undefined
        }
        autoFocus
      />
      <Button type="submit" variant="primary" loading={login.isPending}>
        登入
      </Button>
    </form>
  );
}

function AdminPanel({
  token,
  onUnauthorized,
  onLogout,
}: {
  token: string;
  onUnauthorized: () => void;
  onLogout: () => void;
}): React.ReactElement {
  const queryClient = useQueryClient();

  const config = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => adminFetch<AdminConfig>(token, "/api/admin/config"),
    refetchInterval: 10_000,
    retry: false,
  });

  React.useEffect(() => {
    if (config.error?.message === "unauthorized") onUnauthorized();
  }, [config.error, onUnauthorized]);

  const update = useMutation({
    mutationFn: (patch: { storageMode?: "pinata" | "local"; chainMode?: "real" | "local" }) =>
      adminFetch(token, "/api/admin/config", { method: "PUT", json: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-config"] });
      void queryClient.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY });
    },
  });

  if (config.isLoading) {
    return <p className="text-sm text-ink-muted">載入設定中…</p>;
  }
  if (!config.data) {
    return (
      <p className="text-sm text-red-400">
        讀取設定失敗:{config.error?.message ?? "unknown"}
      </p>
    );
  }

  const cfg = config.data;

  return (
    <div className="flex flex-col gap-6">
      {update.error ? (
        <p className="text-sm text-red-400">切換失敗:{update.error.message}</p>
      ) : null}

      <section className="glass-panel flex flex-col gap-5 p-7">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-gold-soft" aria-hidden />
          <h2 className="font-serif text-lg text-ink">儲存模式 — 上傳素材去哪裡</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <ModeOption
            active={cfg.storageMode === "local"}
            title="本地磁碟(測試)"
            desc="免 Pinata。檔案存 backend volume,URI 指向 localhost:4000"
            onSelect={() => update.mutate({ storageMode: "local" })}
            pending={update.isPending}
          />
          <ModeOption
            active={cfg.storageMode === "pinata"}
            title="Pinata / IPFS(真實)"
            desc={cfg.pinataConfigured ? "釘上 IPFS,永久內容尋址" : "尚未設定 PINATA_JWT,切過去上傳會 503"}
            warn={!cfg.pinataConfigured}
            onSelect={() => update.mutate({ storageMode: "pinata" })}
            pending={update.isPending}
          />
        </div>
      </section>

      <section className="glass-panel flex flex-col gap-5 p-7">
        <div className="flex items-center gap-3">
          <Link2 className="h-5 w-5 text-gold-soft" aria-hidden />
          <h2 className="font-serif text-lg text-ink">鏈模式 — 合約在哪條鏈上</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <ModeOption
            active={cfg.chainMode === "local"}
            title={`本地 Anvil(chain ${cfg.chains.local.chainId})`}
            desc={`${shortAddr(cfg.chains.local.contractAddress)} · ${cfg.chains.local.rpcUrl}`}
            statusOk={cfg.chains.local.rpcOk}
            onSelect={() => update.mutate({ chainMode: "local" })}
            pending={update.isPending}
          />
          <ModeOption
            active={cfg.chainMode === "real"}
            title={`Sepolia 測試網(chain ${cfg.chains.real.chainId})`}
            desc={`${shortAddr(cfg.chains.real.contractAddress)} · 公共 RPC`}
            statusOk={cfg.chains.real.rpcOk}
            warn={/^0x0+$/.test(cfg.chains.real.contractAddress)}
            onSelect={() => update.mutate({ chainMode: "real" })}
            pending={update.isPending}
          />
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">
          綠點 = RPC 可達。切換後錢包也要在同一條鏈上(burner 測試錢包會自動跟隨;
          MetaMask 會被引導切換網路)。
        </p>
      </section>

      {cfg.chainMode === "local" ? <FundCard token={token} /> : null}

      <section className="flex flex-wrap items-center gap-3">
        <Link href="/admin/replace-image">
          <Button variant="outline">工具:替換塔位圖片</Button>
        </Link>
        <Button variant="ghost" onClick={onLogout}>
          <LogOut className="h-4 w-4" aria-hidden />
          登出
        </Button>
      </section>
    </div>
  );
}

function shortAddr(addr: string): string {
  return /^0x0+$/.test(addr) ? "合約未部署" : `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function ModeOption({
  active,
  title,
  desc,
  onSelect,
  pending,
  warn,
  statusOk,
}: {
  active: boolean;
  title: string;
  desc: string;
  onSelect: () => void;
  pending: boolean;
  warn?: boolean;
  statusOk?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={pending || active}
      onClick={onSelect}
      className={cn(
        "flex min-w-[260px] flex-1 flex-col gap-1.5 rounded-xl border p-4 text-left transition-all",
        active
          ? "border-gold/60 bg-gold/10 shadow-glow"
          : "border-ink/10 bg-paper-soft/40 hover:border-gold/30",
        pending && "opacity-60",
      )}
    >
      <span className="flex items-center gap-2">
        {statusOk !== undefined ? (
          statusOk ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4 text-red-400" aria-hidden />
          )
        ) : null}
        <span className={cn("text-sm font-medium", active ? "text-gold-soft" : "text-ink")}>
          {title}
        </span>
        {active ? (
          <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] tracking-wider text-gold-soft">
            使用中
          </span>
        ) : null}
      </span>
      <span className={cn("text-xs leading-relaxed", warn ? "text-amber-300" : "text-ink-muted")}>
        {desc}
      </span>
    </button>
  );
}

function FundCard({ token }: { token: string }): React.ReactElement {
  const { address } = useAccount();
  const [target, setTarget] = React.useState("");
  const [eth, setEth] = React.useState("100");

  // 錢包已連線時預填自己的地址(通常就是要餵的 burner)
  React.useEffect(() => {
    if (address && !target) setTarget(address);
  }, [address, target]);

  const fund = useMutation({
    mutationFn: () =>
      adminFetch<{ ok: boolean }>(token, "/api/admin/fund", {
        method: "POST",
        json: { address: target, eth: Number(eth) },
      }),
  });

  return (
    <section className="glass-panel flex flex-col gap-5 p-7">
      <div className="flex items-center gap-3">
        <Fuel className="h-5 w-5 text-gold-soft" aria-hidden />
        <h2 className="font-serif text-lg text-ink">餵 Gas(anvil 專用)</h2>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[300px] flex-1">
          <Input
            label="地址"
            placeholder="0x…(預設帶入目前連線錢包)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div className="w-28">
          <Input label="ETH" value={eth} onChange={(e) => setEth(e.target.value)} />
        </div>
        <Button
          variant="secondary"
          loading={fund.isPending}
          disabled={!/^0x[0-9a-fA-F]{40}$/.test(target) || !(Number(eth) > 0)}
          onClick={() => fund.mutate()}
        >
          發送測試 ETH
        </Button>
      </div>
      {fund.isSuccess ? (
        <p className="text-sm text-emerald-300">已入帳:{eth} ETH → {shortAddr(target)}</p>
      ) : fund.error ? (
        <p className="text-sm text-red-400">失敗:{fund.error.message}</p>
      ) : (
        <p className="text-xs text-ink-muted">
          用 anvil_setBalance 直接改餘額,免 faucet。給 burner 測試錢包(logo 連點 5 下)餵一次即可 mint。
        </p>
      )}
    </section>
  );
}
