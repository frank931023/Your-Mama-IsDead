"use client";

import * as React from "react";
import { Send, Loader2, AlertCircle, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useSiweLogin } from "@/lib/wallet";
import { streamChat, type ChatMessage } from "@/lib/chat-stream";
import { BACKEND_URL, fetchTablet, type TabletRecord } from "@/lib/api";
import { ipfsToHttps, cn } from "@/lib/utils";

interface ChatInterfaceProps {
  tokenId: string;
}

interface UiMessage extends ChatMessage {
  id: string;
  pending?: boolean;
  audioUrl?: string;
  portraitUrl?: string;
  error?: string;
}

export function ChatInterface({ tokenId }: ChatInterfaceProps): React.ReactElement {
  const { login, isLoggingIn, token, error: loginError } = useSiweLogin(tokenId);
  const [tablet, setTablet] = React.useState<TabletRecord | null>(null);
  const [tabletError, setTabletError] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [latestPortrait, setLatestPortrait] = React.useState<string | null>(null);
  const [latestAudio, setLatestAudio] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  // Trigger SIWE on mount
  React.useEffect(() => {
    if (!token && !isLoggingIn) {
      login().catch(() => {
        /* surfaced via loginError */
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load tablet metadata
  React.useEffect(() => {
    let cancelled = false;
    fetchTablet(tokenId)
      .then((r) => {
        if (!cancelled) setTablet(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setTabletError(e instanceof Error ? e.message : "讀取塔位失敗");
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || !token || sending) return;
    setSending(true);
    setInput("");

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantMsg: UiMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
      pending: true,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const history: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const full = await streamChat(tokenId, text, history, token, {
        signal: ctrl.signal,
        onToken: (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m)),
          );
        },
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: full, pending: false } : m)),
      );

      // Fire-and-forget multimodal triggers
      void triggerPortrait(tokenId, full, token).then((url) => {
        if (url) {
          setLatestPortrait(url);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, portraitUrl: url } : m)),
          );
        }
      });
      void triggerVoice(tokenId, full, token).then((url) => {
        if (url) {
          setLatestAudio(url);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, audioUrl: url } : m)),
          );
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "發送失敗";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, pending: false, error: msg, content: m.content || "(無回覆)" } : m,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  if (loginError) {
    return (
      <Card className="p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-700" aria-hidden />
        <p className="mt-3 text-sm text-ink">登入失敗:{loginError.message}</p>
        <Button className="mt-4" onClick={() => void login()}>
          重試
        </Button>
      </Card>
    );
  }

  if (!token) {
    return (
      <Card className="p-6 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-ink-muted" aria-hidden />
        <p className="mt-3 text-sm text-ink-muted">
          {isLoggingIn ? "請於錢包確認 SIWE 簽名以驗證持有……" : "準備驗證持有者……"}
        </p>
      </Card>
    );
  }

  const portraitFromMetadata = tablet?.metadata?.image ? ipfsToHttps(tablet.metadata.image) : null;
  const portraitToShow = latestPortrait ?? portraitFromMetadata;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px_240px]">
      <Card className="flex h-[70vh] flex-col">
        <div className="flex-1 overflow-y-auto p-4">
          {tabletError ? (
            <p className="text-sm text-red-700">{tabletError}</p>
          ) : null}
          {messages.length === 0 ? (
            <p className="text-sm text-ink-muted">
              開始與 {tablet?.metadata?.name ?? `#${tokenId}`} 對話……
            </p>
          ) : null}
          <ol className="flex flex-col gap-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
                    m.role === "user"
                      ? "bg-ink text-paper"
                      : "border border-ink/10 bg-paper-soft text-ink",
                  )}
                >
                  {m.content || (m.pending ? "…" : "")}
                  {m.error ? (
                    <p className="mt-1 text-xs text-red-700">{m.error}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-center gap-2 border-t border-ink/10 p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入訊息……"
            className="h-10 flex-1 rounded-md border border-ink/20 bg-paper px-3 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
            disabled={sending}
          />
          <Button type="submit" loading={sending} disabled={!input.trim()}>
            <Send className="h-4 w-4" aria-hidden />
            送出
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col items-center justify-center gap-2 p-4">
        {portraitToShow ? (
          <img
            src={portraitToShow}
            alt={tablet?.metadata?.name ?? `tablet #${tokenId}`}
            className="h-64 w-full rounded-md object-cover"
          />
        ) : (
          <div className="flex h-64 w-full items-center justify-center rounded-md bg-paper-soft text-ink-muted">
            尚無肖像
          </div>
        )}
        <p className="text-sm font-medium text-ink">
          {tablet?.metadata?.name ?? `Tablet #${tokenId}`}
        </p>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h4 className="text-sm font-semibold text-ink">語音播放</h4>
        {latestAudio ? (
          <audio key={latestAudio} controls autoPlay className="w-full">
            <source src={latestAudio} />
          </audio>
        ) : (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Volume2 className="h-4 w-4" aria-hidden />
            等待對話產生語音……
          </p>
        )}
      </Card>
    </div>
  );
}

async function triggerPortrait(tokenId: string, prompt: string, jwt: string): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/personas/${tokenId}/portrait`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}

async function triggerVoice(tokenId: string, text: string, jwt: string): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/personas/${tokenId}/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}
