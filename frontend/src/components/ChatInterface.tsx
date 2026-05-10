"use client";

/**
 * 三欄聊天介面 (主元件)
 *
 * 三個可拖拉欄位 (使用 react-resizable-panels):
 *   ┌──────────────────────────┬────────────────┬──────────────┐
 *   │ 對話視窗 (≥30%)          │ 肖像 (≥18%)    │ 語音+短片    │
 *   │ - SIWE 登入流程          │ - 大頭照展示   │ - 自動播 TTS │
 *   │ - 訊息串                  │ - AI 重生肖像  │ - 短片生成   │
 *   │ - 文字輸入框              │                │              │
 *   └──────────────────────────┴────────────────┴──────────────┘
 *
 * 對話走 SSE 串流 (chat-stream.ts),逐 token 顯示。
 * 每則 assistant 回覆後自動觸發 cloud-voice 生成語音並 autoplay。
 * 短片 / 重生肖像則為手動按鈕觸發 (因為 fal.ai 一次要付 $0.25)。
 */
import * as React from "react";
import { Send, Loader2, AlertCircle, Volume2, Film, GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useError } from "@/components/ErrorDialog";
import { ProgressBar } from "@/components/ProgressBar";
import { useSiweLogin } from "@/lib/wallet";
import { streamChat, type ChatMessage } from "@/lib/chat-stream";
import { BACKEND_URL, fetchTablet, type TabletRecord } from "@/lib/api";
import { ipfsToHttps, cn, shortName } from "@/lib/utils";

// 影像 / 影片生成的「合理預期等待時間」(秒)
// fal.ai FLUX schnell ~6s,gpt-image-1 ~15s → 取 12s 居中
// fal.ai Kling v1.6 standard 5s clip ~60s,Hailuo 略長 → 取 60s
const PORTRAIT_ETA_SECONDS = 12;
const VIDEO_ETA_SECONDS = 60;

interface ChatInterfaceProps {
  tokenId: string;
  mode?: "local" | "cloud";
}

interface UiMessage extends ChatMessage {
  id: string;
  pending?: boolean;
  audioUrl?: string;
  portraitUrl?: string;
  error?: string;
}

export function ChatInterface({ tokenId, mode = "local" }: ChatInterfaceProps): React.ReactElement {
  const { showError } = useError();
  const { login, isLoggingIn, token, error: loginError } = useSiweLogin(tokenId);
  const [tablet, setTablet] = React.useState<TabletRecord | null>(null);
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [latestPortrait, setLatestPortrait] = React.useState<string | null>(null);
  const [latestAudio, setLatestAudio] = React.useState<string | null>(null);
  const [latestVideo, setLatestVideo] = React.useState<string | null>(null);
  const [generatingPortrait, setGeneratingPortrait] = React.useState(false);
  const [generatingVideo, setGeneratingVideo] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const messagesScrollRef = React.useRef<HTMLDivElement | null>(null);

  // 訊息更新時自動捲到底,避免使用者要手動往下滑看新回覆
  React.useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

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
        if (cancelled) return;
        showError("讀取塔位失敗", e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, showError]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /**
   * 送出訊息流程:
   *   1. 先把 user 訊息和空的 assistant placeholder 都塞進 messages
   *   2. 開 SSE 串流,onToken callback 把 delta 累加到 assistant 訊息
   *   3. 串流結束後並行觸發 voice TTS (短片不自動,需手動點按鈕)
   *   4. 任一步出錯 → 抽掉 placeholder + 彈 ErrorDialog
   */
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
        mode,
        onToken: (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m)),
          );
        },
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: full, pending: false } : m)),
      );

      // Auto-trigger voice on every reply. Portrait stays on-demand (button)
      // because cloud image gen is slow and costs money per call.
      void triggerVoice(tokenId, full, token, mode).then((url) => {
        if (url) {
          setLatestAudio(url);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, audioUrl: url } : m)),
          );
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "發送失敗";
      // Strip the failed assistant bubble entirely; surface the reason via modal.
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
      showError("對話發送失敗", msg);
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
    <Group
      orientation="horizontal"
      className="flex h-[70vh] w-full"
    >
      <Panel defaultSize="55%" minSize="30%" className="flex flex-col">
      <Card className="flex h-full flex-col overflow-hidden">
        <div ref={messagesScrollRef} className="flex-1 min-h-0 overflow-y-auto p-4">
          {/* tablet load errors surface via modal (useError) */}
          {messages.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {`想對 ${shortName(tablet?.metadata, tokenId)} 說些什麼?說一句問候,讓記憶慢慢回應。`}
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
      </Panel>

      <ResizeHandle />

      <Panel defaultSize="25%" minSize="18%" className="flex flex-col">
      <Card className="flex h-full flex-col items-center gap-2 overflow-hidden overflow-y-auto p-4">
        {portraitToShow ? (
          <img
            src={portraitToShow}
            alt={tablet?.metadata?.name ?? `tablet #${tokenId}`}
            className="h-64 w-full shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="flex h-64 w-full shrink-0 items-center justify-center rounded-md bg-paper-soft text-ink-muted">
            尚無肖像
          </div>
        )}
        <p className="text-sm font-medium text-ink">
          {tablet?.metadata?.name ?? `Tablet #${tokenId}`}
        </p>
        {mode === "cloud" && token ? (
          <div className="flex w-full flex-col gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={generatingPortrait}
              onClick={() => {
                setGeneratingPortrait(true);
                const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.pending);
                const seed = lastAssistant?.content ?? "peaceful, looking into the distance";
                void triggerPortrait(tokenId, seed.slice(0, 400), token, mode)
                  .then((res) => {
                    if (res.url) setLatestPortrait(res.url);
                    else if (res.error) showError("AI 肖像生成失敗", res.error);
                  })
                  .finally(() => setGeneratingPortrait(false));
              }}
            >
              {generatingPortrait ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : null}
              {generatingPortrait ? "生成中…" : "AI 生成另一張肖像"}
            </Button>
            <ProgressBar
              active={generatingPortrait}
              etaSeconds={PORTRAIT_ETA_SECONDS}
              label="AI 渲染肖像中..."
            />
          </div>
        ) : null}
      </Card>
      </Panel>

      <ResizeHandle />

      <Panel defaultSize="20%" minSize="15%" className="flex flex-col">
      <Card className="flex h-full flex-col gap-3 overflow-hidden overflow-y-auto p-4">
        <h4 className="text-sm font-semibold text-ink">語音回應</h4>
        {latestAudio ? (
          <audio key={latestAudio} controls autoPlay className="w-full">
            <source src={latestAudio} />
          </audio>
        ) : (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Volume2 className="h-4 w-4" aria-hidden />
            送出訊息後將自動唸出回應。
          </p>
        )}

        {mode === "cloud" ? (
          <div className="mt-2 flex flex-col gap-2 border-t border-ink/10 pt-3">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Film className="h-4 w-4" aria-hidden />
              短片追憶
            </h4>
            {latestVideo ? (
              <video key={latestVideo} src={latestVideo} controls className="w-full rounded-md" />
            ) : (
              <p className="text-xs text-ink-muted">
                以最近一句回覆為描述,生成 5 秒紀念短片(約需 30~90 秒)。
              </p>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={generatingVideo || !token}
              onClick={() => {
                setGeneratingVideo(true);
                const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.pending);
                const seed =
                  lastAssistant?.content?.slice(0, 400) ?? "a quiet, warm scene in soft afternoon light";
                void triggerVideo(tokenId, seed, token!)
                  .then((url) => {
                    if (url) setLatestVideo(url);
                    else showError("短片生成失敗", "未取得影片連結,請稍後再試。");
                  })
                  .catch((e: unknown) => {
                    showError("短片生成失敗", e);
                  })
                  .finally(() => setGeneratingVideo(false));
              }}
            >
              {generatingVideo ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Film className="h-3 w-3" aria-hidden />}
              {generatingVideo ? "生成中…" : "生成 5 秒短片"}
            </Button>
            <ProgressBar
              active={generatingVideo}
              etaSeconds={VIDEO_ETA_SECONDS}
              label="Kling 渲染中..."
            />
            {generatingVideo ? (
              <p className="text-[10px] text-ink-muted">
                fal.ai 排隊 + 渲染,實際時間視伺服器忙碌程度而定。
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
      </Panel>
    </Group>
  );
}

function ResizeHandle(): React.ReactElement {
  return (
    <Separator className="group relative mx-1 flex w-2 cursor-col-resize items-center justify-center select-none">
      <div className="h-full w-px bg-ink/10 transition-colors group-hover:bg-gold/60" />
      <div className="absolute flex h-8 w-4 items-center justify-center rounded bg-paper-soft opacity-0 transition-opacity group-hover:opacity-100">
        <GripVertical className="h-3 w-3 text-ink-muted" aria-hidden />
      </div>
    </Separator>
  );
}

async function triggerPortrait(
  tokenId: string,
  prompt: string,
  jwt: string,
  mode: "local" | "cloud",
): Promise<{ url: string | null; error?: string }> {
  const path = mode === "cloud" ? "cloud-portrait" : "portrait";
  try {
    const res = await fetch(`${BACKEND_URL}/api/personas/${tokenId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      try {
        const data = (await res.json()) as { detail?: string; error?: string };
        return { url: null, error: data.detail ?? data.error ?? `生成失敗 (${res.status})` };
      } catch {
        return { url: null, error: `生成失敗 (${res.status})` };
      }
    }
    if (mode === "cloud") {
      const data = (await res.json()) as { url?: string };
      return { url: data.url ?? null };
    }
    // Local mode: compute returns image/png bytes — wrap in object URL.
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob) };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : "網路錯誤" };
  }
}

async function triggerVoice(
  tokenId: string,
  text: string,
  jwt: string,
  mode: "local" | "cloud",
): Promise<string | null> {
  const path = mode === "cloud" ? "cloud-voice" : "voice";
  try {
    const res = await fetch(`${BACKEND_URL}/api/personas/${tokenId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    // Both local (audio/wav) and cloud (audio/mpeg) endpoints return raw audio.
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function triggerVideo(
  tokenId: string,
  prompt: string,
  jwt: string,
): Promise<string | null> {
  const res = await fetch(`${BACKEND_URL}/api/personas/${tokenId}/cloud-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    let msg = `Upstream ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: string; error?: string };
      msg = data.detail ?? data.error ?? msg;
    } catch {
      /* keep fallback */
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
}
