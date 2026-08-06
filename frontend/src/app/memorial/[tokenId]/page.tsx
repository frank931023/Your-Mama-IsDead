"use client";

/**
 * 哀悼版獨立路由 (/memorial/[tokenId])
 *
 * 可見度三態閘門:
 *   PUBLIC   任何人直接進
 *   UNLISTED 需邀請碼:?code=XXXX 自動驗存;沒碼/碼錯 → 邀請碼輸入畫面。
 *            已連線錢包 = owner 時直接放行 (屋主免碼)。
 *   PRIVATE  僅 owner (連線錢包比對);其他人看到「私人」提示。
 *
 * 邀請碼存 sessionStorage (per tokenId),同分頁內投稿 / 公祭 WS / 對話自動帶上。
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ChevronLeft, KeyRound, Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useError } from "@/components/ErrorDialog";
import { fetchTablet, getTabletAccess, type TabletAccess, type TabletRecord } from "@/lib/api";
import { getStoredInviteCode, storeInviteCode, clearInviteCode } from "@/lib/invite";
import { MemorialScroll } from "@/components/baibai/MemorialScroll";

type Gate = "checking" | "allowed" | "need-code" | "private";

export default function MemorialPage(): React.ReactElement {
  const params = useParams<{ tokenId: string }>();
  const router = useRouter();
  const { showError } = useError();
  const { address } = useAccount();
  const tokenId = params.tokenId;

  const [tablet, setTablet] = React.useState<TabletRecord | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [gate, setGate] = React.useState<Gate>("checking");
  const [, setAccess] = React.useState<TabletAccess | null>(null);

  // URL 帶 ?code= → 先存起來 (之後 WS / 投稿 / 對話共用)。
  // 用 window.location 而非 useSearchParams,避免 Next build 要求 Suspense 邊界。
  React.useEffect(() => {
    try {
      const urlCode = new URLSearchParams(window.location.search).get("code");
      if (urlCode && urlCode.trim()) storeInviteCode(tokenId, urlCode);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId]);

  const runGate = React.useCallback(async (): Promise<void> => {
    try {
      const code = getStoredInviteCode(tokenId);
      const a = await getTabletAccess(tokenId, code);
      setAccess(a);

      const isOwner = !!address && a.owner.toLowerCase() === address.toLowerCase();
      if (a.allowed || isOwner) {
        setGate("allowed");
        return;
      }
      if (code && !a.codeValid) clearInviteCode(tokenId); // 存的碼失效 (被重產) → 清掉
      setGate(a.visibility === "PRIVATE" ? "private" : "need-code");
    } catch (e) {
      setFailed(true);
      showError("讀取追悼頁失敗", e instanceof Error ? e.message : String(e));
    }
  }, [tokenId, address, showError]);

  React.useEffect(() => {
    void runGate();
  }, [runGate]);

  // 通過閘門後才載入塔位內容
  React.useEffect(() => {
    if (gate !== "allowed" || tablet) return;
    fetchTablet(tokenId)
      .then(setTablet)
      .catch((e: unknown) => {
        setFailed(true);
        showError("讀取追悼頁失敗", e instanceof Error ? e.message : String(e));
      });
  }, [gate, tablet, tokenId, showError]);

  const exit = (): void => {
    if (window.history.length > 1) router.back();
    else router.push("/registry");
  };

  if (failed) {
    return (
      <div className="container-page py-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-ink-muted">
            <p>找不到這座燈塔的追悼頁。</p>
            <Link href="/registry" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-gold-dark">
              <ChevronLeft className="h-4 w-4" aria-hidden />
              回線上紀念館
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gate === "need-code") {
    return (
      <InviteGate
        onSubmit={async (code) => {
          const a = await getTabletAccess(tokenId, code);
          if (a.codeValid) {
            storeInviteCode(tokenId, code);
            setAccess(a);
            setGate("allowed");
            return true;
          }
          return false;
        }}
      />
    );
  }

  if (gate === "private") {
    return (
      <div className="container-page py-16">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-ink-muted">
            <Lock className="h-8 w-8" aria-hidden />
            <p className="text-base text-ink">這是一座私人的追悼頁。</p>
            <p>僅持有者本人可進入。若您是持有者,請先連線您的錢包。</p>
            <Link href="/registry" className="underline underline-offset-2 hover:text-gold-dark">
              回線上紀念館
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gate === "checking" || !tablet) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
      </div>
    );
  }

  return <MemorialScroll tablet={tablet} onExit={exit} />;
}

// ── 邀請碼輸入畫面 ──────────────────────────────────────────────────────────

function InviteGate({
  onSubmit,
}: {
  onSubmit: (code: string) => Promise<boolean>;
}): React.ReactElement {
  const [code, setCode] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [wrong, setWrong] = React.useState(false);

  const submit = async (): Promise<void> => {
    const trimmed = code.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setWrong(false);
    try {
      const ok = await onSubmit(trimmed);
      if (!ok) setWrong(true);
    } catch {
      setWrong(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-16">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <KeyRound className="h-8 w-8 text-gold-dark" aria-hidden />
          <div>
            <h1 className="font-serif text-xl text-ink">這是一座不公開的追悼頁</h1>
            <p className="mt-1 text-sm text-ink-muted">
              請輸入家屬提供的邀請碼,即可進入追思、祭拜與對話。
            </p>
          </div>
          <form
            className="flex w-full max-w-xs flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setWrong(false);
              }}
              placeholder="邀請碼 (例如 3F9A2C1B)"
              maxLength={16}
              autoFocus
              className="h-11 rounded-md border border-ink/20 bg-paper px-3 text-center font-mono text-lg tracking-[0.2em] text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
            {wrong ? (
              <p className="text-xs text-red-700">邀請碼不正確或已失效,請向家屬確認。</p>
            ) : null}
            <Button type="submit" disabled={!code.trim() || checking}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              進入追悼頁
            </Button>
          </form>
          <Link href="/registry" className="text-xs text-ink-muted underline underline-offset-2 hover:text-gold-dark">
            回線上紀念館
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
