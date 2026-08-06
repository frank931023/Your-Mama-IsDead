"use client";

/**
 * 留言板 (Tributes) —— ForeverMissed「Leave a tribute」式供品留言。
 *
 * 訪客先選一樣供品小物(獻香 / 紙蓮花 / 鮮果 / 茶 / 燭 / 純留言),再打字送出。
 * 不要求 SIWE 登入;有連線錢包則自動帶入地址,沒連線就匿名。送出後透過
 * onSubmitted 回呼讓上層(儀式狀態機)知道。每則留言依供品類型顯示對應 icon。
 *
 * 主題色透過 props 傳入 (accent/text/card),融進屋主選的背景主題。
 */
import * as React from "react";
import { useAccount } from "wagmi";
import { Loader2, Send, Flame, Flower2, Apple, CupSoda, Candy, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useError } from "@/components/ErrorDialog";
import { truncateAddress } from "@/lib/utils";
import { createTribute, listTributes, type Tribute, type TributeKind } from "@/lib/api";
import { getStoredInviteCode } from "@/lib/invite";

export interface TributeBoardTheme {
  accent: string;
  text: string;
  textMuted: string;
  card: string;
  dark?: boolean;
}

interface OfferingDef {
  kind: TributeKind;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  /** 列表上沒留言文字時的預設動作描述。 */
  verb: string;
}

/** 6 種供品小物 (對應後端 TributeKind)。 */
export const TRIBUTE_OFFERINGS: OfferingDef[] = [
  { kind: "incense", label: "獻香", Icon: Flame, placeholder: "為他點上一炷香,寫下此刻的心意……", verb: "獻上一炷香" },
  { kind: "lotus", label: "紙蓮花", Icon: Flower2, placeholder: "獻上一朵紙蓮花,願他往生淨土……", verb: "獻上一朵紙蓮花" },
  { kind: "fruit", label: "鮮果", Icon: Apple, placeholder: "供上一份鮮果,捎去思念……", verb: "供上鮮果" },
  { kind: "tea", label: "清茶", Icon: CupSoda, placeholder: "斟一杯清茶,陪他說說話……", verb: "斟上清茶" },
  { kind: "candle", label: "燭", Icon: Candy, placeholder: "點一盞燭,為他照亮歸途……", verb: "點上一盞燭" },
  { kind: "note", label: "留言", Icon: MessageSquare, placeholder: "此刻想對他說的話……", verb: "留下話語" },
];

export function offeringOf(kind: string): OfferingDef {
  return TRIBUTE_OFFERINGS.find((o) => o.kind === kind) ?? TRIBUTE_OFFERINGS[5]!;
}

interface TributeBoardProps {
  tokenId: string;
  theme: TributeBoardTheme;
  /** 送出一則留言後觸發 (例如解鎖儀式「留下話語」步驟)。 */
  onSubmitted?: (t: Tribute) => void;
  /** 線上公祭:別人即時送出的供品(useCeremony 推進來),以 id 去重後插到最上面。 */
  liveTribute?: Tribute | null;
}

export function TributeBoard({ tokenId, theme, onSubmitted, liveTribute }: TributeBoardProps): React.ReactElement {
  const { address } = useAccount();
  const { showError } = useError();
  const [list, setList] = React.useState<Tribute[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [name, setName] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [kind, setKind] = React.useState<TributeKind>("incense");

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTributes(tokenId)
      .then((rs) => {
        if (!cancelled) setList(rs);
      })
      .catch((e: unknown) => {
        if (!cancelled) showError("讀取留言失敗", e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, showError]);

  // 線上公祭:即時供品到達 → 去重後插到最上面(自己剛送出的那則
  // 已由 submit 樂觀插入,廣播回音靠 id 擋掉)
  React.useEffect(() => {
    if (!liveTribute) return;
    setList((prev) => {
      if (!prev) return [liveTribute];
      if (prev.some((t) => t.id === liveTribute.id)) return prev;
      return [liveTribute, ...prev];
    });
  }, [liveTribute]);

  const offering = offeringOf(kind);

  const submit = async (): Promise<void> => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const created = await createTribute(
        tokenId,
        {
          message: trimmed,
          fromName: name.trim() || undefined,
          fromAddress: address ?? undefined,
          kind,
        },
        getStoredInviteCode(tokenId),
      );
      setList((prev) => (prev ? [created, ...prev] : [created]));
      setMessage("");
      onSubmitted?.(created);
    } catch (e) {
      showError("留言失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.85)",
    borderColor: `${theme.accent}33`,
    color: theme.text,
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 供品 + 留言表單 */}
      <form
        className="flex flex-col gap-3 rounded-xl border p-4"
        style={{ background: theme.card, borderColor: `${theme.accent}33` }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="font-serif text-lg" style={{ color: theme.text }}>
          獻上一份心意
        </p>

        {/* 供品小物選擇 */}
        <div className="flex flex-wrap gap-2">
          {TRIBUTE_OFFERINGS.map((o) => {
            const active = kind === o.kind;
            return (
              <button
                key={o.kind}
                type="button"
                onClick={() => setKind(o.kind)}
                aria-pressed={active}
                className="flex w-[88px] flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition-all"
                style={{
                  borderColor: active ? theme.accent : `${theme.accent}26`,
                  background: active ? `${theme.accent}14` : "transparent",
                  color: active ? theme.text : theme.textMuted,
                  boxShadow: active ? `0 0 0 1px ${theme.accent}` : "none",
                }}
              >
                <o.Icon className="h-6 w-6" />
                {o.label}
              </button>
            );
          })}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={offering.placeholder}
          maxLength={1000}
          rows={3}
          className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={inputStyle}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="您的稱呼(可空白為匿名)"
            maxLength={80}
            className="h-9 rounded-md border px-3 text-sm focus:outline-none focus:ring-2 sm:w-64"
            style={inputStyle}
          />
          <Button type="submit" disabled={!message.trim() || submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            {offering.verb}
          </Button>
        </div>
        <p className="text-xs" style={{ color: theme.textMuted }}>
          {address ? (
            <>
              以 <code className="font-mono">{truncateAddress(address)}</code> 獻上
            </>
          ) : (
            "未連線錢包,將以匿名身份獻上"
          )}
        </p>
      </form>

      {/* 留言列表 */}
      {loading && !list ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: theme.textMuted }} aria-hidden />
        </div>
      ) : !list || list.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: theme.textMuted }}>
          還沒有人獻上心意。願您是第一位。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((t) => (
            <TributeItem key={t.id} tribute={t} theme={theme} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TributeItem({
  tribute,
  theme,
}: {
  tribute: Tribute;
  theme: TributeBoardTheme;
}): React.ReactElement {
  const offering = offeringOf(tribute.kind);
  const author =
    tribute.fromName ||
    (tribute.fromAddress ? truncateAddress(tribute.fromAddress) : "匿名訪客");
  const when = new Date(tribute.createdAt).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li
      className="flex gap-3 rounded-lg border p-3"
      style={{ background: theme.card, borderColor: `${theme.accent}26` }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: `${theme.accent}1a`, color: theme.accent }}
        title={offering.label}
      >
        <offering.Icon className="h-5 w-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p
          className="whitespace-pre-wrap break-words font-serif text-sm leading-relaxed"
          style={{ color: theme.text }}
        >
          {tribute.message}
        </p>
        <p className="mt-1.5 flex items-center justify-between text-xs" style={{ color: theme.textMuted }}>
          <span>
            — {author} · {offering.label}
          </span>
          <span>{when}</span>
        </p>
      </div>
    </li>
  );
}
