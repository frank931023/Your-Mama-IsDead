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
import Link from "next/link";
import { Send, Loader2, AlertCircle, Mic, Square, MessageSquare, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useError } from "@/components/ErrorDialog";
import { ProgressBar } from "@/components/ProgressBar";
import { SimliAvatar, type SimliAvatarHandle } from "@/components/SimliAvatar";
import { LamAvatar, type LamAvatarHandle } from "@/components/LamAvatar";
import { useSiweLogin } from "@/lib/wallet";
import { streamChat, type ChatMessage } from "@/lib/chat-stream";
import {
  BACKEND_URL,
  fetchTablet,
  fetchPersonaPrompt,
  getCloudStatus,
  transcribeAudio,
  type TabletRecord,
} from "@/lib/api";
import { ipfsToHttps, cn, shortName } from "@/lib/utils";

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
  const { login, logout, isLoggingIn, token, error: loginError } = useSiweLogin(tokenId);
  const [tablet, setTablet] = React.useState<TabletRecord | null>(null);
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  // AI-regenerated portrait used as the avatar/poster fallback (kept; the
  // explicit "regenerate portrait" button was removed in the avatar redesign).
  const [latestPortrait] = React.useState<string | null>(null);
  const [latestAudio, setLatestAudio] = React.useState<string | null>(null);
  const [avatarAvailable, setAvatarAvailable] = React.useState(false);
  // 哪种 avatar provider: "lam"(自建渲染机, WS) | "simli"(云) | null。
  const [avatarProvider, setAvatarProvider] = React.useState<"lam" | "simli" | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const messagesScrollRef = React.useRef<HTMLDivElement | null>(null);
  const simliRef = React.useRef<SimliAvatarHandle | null>(null);
  const lamRef = React.useRef<LamAvatarHandle | null>(null);
  // LAM 模式: 当前正在接收流式回应的 assistant 气泡 id,供 onTextDelta 累加。
  const lamAssistantIdRef = React.useRef<string | null>(null);

  const useLam = avatarProvider === "lam" && avatarAvailable && mode === "cloud";
  // LAM 模式下,若該 tablet 還沒克隆聲音 (metadata.dsas.avatar.voiceLabel 為空),
  // avatar 會用渲染機的預設聲音。提示使用者去塔位補傳區生成逝者本人的克隆聲音。
  const needsVoiceClone =
    useLam && !!tablet?.metadata && !tablet.metadata.dsas?.avatar?.voiceLabel;
  // Guard so a 401 from the avatar session only triggers ONE re-login attempt —
  // if the fresh token is also rejected we stop, instead of looping forever.
  const avatarReauthedRef = React.useRef(false);

  // Mic / voice conversation mode. When true the UI goes full-screen avatar and
  // the user talks instead of typing (mic → Whisper STT → same chat pipeline).
  const [voiceMode, setVoiceMode] = React.useState(false);
  // Recording state machine: idle → recording → transcribing (STT) → back to idle.
  const [recState, setRecState] = React.useState<"idle" | "recording" | "transcribing">("idle");
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const recChunksRef = React.useRef<Blob[]>([]);
  const recStreamRef = React.useRef<MediaStream | null>(null);

  // Handle a stale-JWT 401 from <SimliAvatar>: clear the cached token and
  // re-run SIWE once. The new token flows back in via the `token` prop, which
  // re-mounts SimliAvatar with a valid jwt.
  const handleAvatarAuthError = React.useCallback(() => {
    if (avatarReauthedRef.current) return; // already retried once — give up
    avatarReauthedRef.current = true;
    logout();
    login().catch(() => {
      /* surfaced via loginError */
    });
  }, [login, logout]);

  // Show the Simli talking-head only in cloud mode and only when the backend
  // reports a configured SIMLI_API_KEY. Local mode keeps the static portrait
  // because the local compute server doesn't proxy Simli sessions.
  const useAvatar = mode === "cloud" && avatarAvailable;

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
        showError("讀取燈塔失敗", e instanceof Error ? e.message : String(e));
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

  // Probe cloud capability once on mount; surfaces SIMLI_API_KEY presence so we
  // can decide whether to render <SimliAvatar> instead of the static portrait.
  React.useEffect(() => {
    if (mode !== "cloud") return;
    let cancelled = false;
    getCloudStatus()
      .then((s) => {
        if (cancelled) return;
        setAvatarAvailable(s.avatar);
        setAvatarProvider(s.avatarProvider);
      })
      .catch(() => {
        /* swallow — avatar simply stays disabled if status probe fails */
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  /**
   * 送出訊息流程:
   *   1. 先把 user 訊息和空的 assistant placeholder 都塞進 messages
   *   2. 開 SSE 串流,onToken callback 把 delta 累加到 assistant 訊息
   *   3. 串流結束後並行觸發 voice TTS (短片不自動,需手動點按鈕)
   *   4. 任一步出錯 → 抽掉 placeholder + 彈 ErrorDialog
   */
  // Core send path, parameterised by text so BOTH the typed input and the
  // mic-mode transcript funnel through the exact same chat → voice → Simli
  // pipeline. `send()` (form submit) wraps this with the input box value.
  const sendText = async (rawText: string): Promise<void> => {
    const text = rawText.trim();
    if (!text || !token || sending) return;
    setSending(true);

    // Unlock audio NOW, synchronously, while we still have the user-gesture
    // grant from the click/submit that triggered send(). Browsers only honour
    // AudioContext.resume() + media-playback unlock inside the gesture's sync
    // stack; once we `await streamChat` below the grant is gone, so the Simli
    // lip-sync audio pipeline would stay suspended (avatar renders but never
    // moves). No-op when the avatar isn't mounted.
    if (useLam) lamRef.current?.unlockAudio();
    else if (useAvatar) simliRef.current?.unlockAudio();

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

    // ── LAM 模式:对话走 LamAvatar 的 WS (LLM+TTS+表情都在渲染机) ──────────────
    // 不走后端 cloud-chat/cloud-voice。文字经 onTextDelta 回来累加;音频+表情由
    // LamAvatar 自动 prebuffer 播放。WS persona-agnostic,故 messages[0] 要自带
    // system prompt (与后端 cloud-chat 同一份 buildPersonaSystemPrompt)。
    //
    // RAG:每轮把本次问题 (text) 传给 persona-prompt?q=,后端用它对该 persona 的
    // 对话纪录记忆库检索,把命中的逝者真实语料拼进 system prompt。所以【不缓存】
    // prompt — 每轮都要按当前问题重新检索 (与缓存 personaPromptRef 的旧逻辑相反)。
    if (useLam) {
      try {
        const { prompt: personaPrompt, memoryUsed } = await fetchPersonaPrompt(tokenId, token, text);
        // RAG 可觀測性:瀏覽器 console 直接看本輪注入了幾段逝者真實語料 (0 = 沒命中
        // / 沒上傳對話紀錄)。完整命中明細在「後端」console 的 [RAG] 日誌。
        console.log(
          `%c[RAG] 本輪注入 ${memoryUsed} 段記憶`,
          memoryUsed > 0 ? "color:#10b981;font-weight:bold" : "color:#999",
          memoryUsed > 0 ? "(AI 會參考逝者本人說過的話)" : "(純 metadata persona;若已上傳對話紀錄請看後端 [RAG] 日誌)",
        );
        lamAssistantIdRef.current = assistantMsg.id;
        const wsMessages = [
          { role: "system", content: personaPrompt },
          ...history,
          { role: "user", content: text },
        ];
        lamRef.current?.sendChat(wsMessages);
        // 不在这里 setSending(false):等 onResponseDone 回调 (见 avatarEl 处)。
      } catch (e) {
        const msg = e instanceof Error ? e.message : "發送失敗";
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
        showError("對話發送失敗", msg);
        setSending(false);
      }
      return;
    }

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
        if (!url) return;
        setLatestAudio(url);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, audioUrl: url } : m)),
        );
        // When the avatar is up, route TTS through Simli for lip-sync. The
        // right-panel <audio> tag drops its autoPlay flag in that case so we
        // don't hear the same clip twice (Simli echoes the audio back via its
        // own <audio> element synced to the video).
        if (useAvatar && simliRef.current) {
          simliRef.current.playAudio(url).catch((err: unknown) => {
            // Avatar playback errors are non-fatal — the audio tag still has
            // the clip and the user can replay manually.
            console.warn("Simli playAudio failed", err);
          });
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

  // ── LAM 模式的流式回调 (传给 <LamAvatar>) ──────────────────────────────────
  // 文字 token 累加到当前 assistant 气泡;一轮结束清 pending + 放开 sending。
  const handleLamTextDelta = React.useCallback((delta: string): void => {
    const id = lamAssistantIdRef.current;
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + delta, pending: false } : m)),
    );
  }, []);

  const handleLamResponseDone = React.useCallback((): void => {
    const id = lamAssistantIdRef.current;
    if (id) {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pending: false } : m)));
    }
    lamAssistantIdRef.current = null;
    setSending(false);
  }, []);

  const handleLamError = React.useCallback(
    (msg: string): void => {
      showError("分身回應失敗", msg);
      const id = lamAssistantIdRef.current;
      if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
      lamAssistantIdRef.current = null;
      setSending(false);
    },
    [showError],
  );

  // Form-submit wrapper: send what's in the input box, then clear it.
  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendText(text);
  };

  // ── Mic recording ────────────────────────────────────────────────────────
  // Start capturing the mic. Unlock the avatar audio pipeline here too — this
  // click is a user gesture, so the Simli playback gets ungated for the reply.
  const startRecording = async (): Promise<void> => {
    if (recState !== "idle" || sending) return;
    try {
      if (useAvatar) simliRef.current?.unlockAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      recChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        // Release the mic immediately so the browser indicator turns off.
        recStreamRef.current?.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
        const blob = new Blob(recChunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        void transcribeAndSend(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecState("recording");
    } catch (e) {
      showError("無法使用麥克風", e instanceof Error ? e.message : "請允許瀏覽器存取麥克風");
      setRecState("idle");
    }
  };

  // Stop recording → MediaRecorder.onstop fires → transcribeAndSend().
  const stopRecording = (): void => {
    if (recState !== "recording") return;
    mediaRecorderRef.current?.stop();
    setRecState("transcribing");
  };

  // STT the recorded blob, then push the transcript through the normal chat
  // pipeline (same as typing). Empty transcript (silence) is a no-op.
  const transcribeAndSend = async (blob: Blob): Promise<void> => {
    if (!token) {
      setRecState("idle");
      return;
    }
    try {
      const text = await transcribeAudio(tokenId, blob, token);
      setRecState("idle");
      if (text.trim()) await sendText(text);
    } catch (e) {
      setRecState("idle");
      showError("語音辨識失敗", e instanceof Error ? e.message : String(e));
    }
  };

  // Stop the mic stream if the component unmounts mid-recording.
  React.useEffect(() => {
    return () => {
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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

  const personName = tablet?.metadata?.name ?? `Tablet #${tokenId}`;

  // Reusable avatar element (or static portrait fallback). Rendered large in
  // both layouts; only its sizing wrapper differs.
  // provider 决定用自建 LAM (WS + 浏览器 WebGL 3DGS) 还是 Simli 云。
  const avatarEl =
    useLam && token ? (
      <LamAvatar
        ref={lamRef}
        tokenId={tokenId}
        jwt={token}
        posterUrl={portraitToShow}
        className="h-full w-full"
        onAuthError={handleAvatarAuthError}
        onTextDelta={handleLamTextDelta}
        onResponseDone={handleLamResponseDone}
        onError={handleLamError}
      />
    ) : useAvatar && token ? (
      <SimliAvatar
        ref={simliRef}
        tokenId={tokenId}
        jwt={token}
        posterUrl={portraitToShow}
        className="h-full w-full"
        onAuthError={handleAvatarAuthError}
      />
    ) : portraitToShow ? (
      <img
        src={portraitToShow}
        alt={personName}
        className="h-full w-full rounded-md object-cover"
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center rounded-md bg-paper-soft text-ink-muted">
        尚無肖像
      </div>
    );

  // The mode toggle button (typing ⇄ voice). Voice mode is only meaningful with
  // a live avatar + cloud STT, so hide it when the avatar isn't available.
  const modeToggle = useAvatar ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => setVoiceMode((v) => !v)}
    >
      {voiceMode ? (
        <>
          <MessageSquare className="h-4 w-4" aria-hidden />
          文字模式
        </>
      ) : (
        <>
          <Mic className="h-4 w-4" aria-hidden />
          語音模式
        </>
      )}
    </Button>
  ) : null;

  // ── Voice mode: full-screen avatar + a big mic button ─────────────────────
  if (voiceMode && useAvatar) {
    return (
      <div className="relative flex h-[78vh] w-full flex-col overflow-hidden rounded-lg bg-ink">
        <div className="absolute inset-0">{avatarEl}</div>

        {/* Top bar: name + back-to-typing toggle */}
        <div className="relative z-10 flex items-center justify-between p-3">
          <span className="rounded-md bg-ink/50 px-2 py-1 text-sm font-medium text-paper backdrop-blur">
            {personName}
          </span>
          {modeToggle}
        </div>

        {/* Bottom-centred mic control + status */}
        <div className="relative z-10 mt-auto flex flex-col items-center gap-3 p-6">
          <p className="text-sm text-paper/80">
            {recState === "recording"
              ? "聆聽中……再按一次結束"
              : recState === "transcribing"
                ? "辨識中……"
                : sending
                  ? "分身回應中……"
                  : "按下麥克風開始說話"}
          </p>
          <button
            type="button"
            disabled={recState === "transcribing" || sending}
            onClick={() => (recState === "recording" ? stopRecording() : void startRecording())}
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full shadow-lg transition-colors disabled:opacity-50",
              recState === "recording"
                ? "animate-pulse bg-red-600 text-white"
                : "bg-gold text-ink hover:bg-gold-soft",
            )}
            aria-label={recState === "recording" ? "停止錄音" : "開始錄音"}
          >
            {recState === "transcribing" ? (
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
            ) : recState === "recording" ? (
              <Square className="h-8 w-8" aria-hidden />
            ) : (
              <Mic className="h-9 w-9" aria-hidden />
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Typing mode: left conversation (scrolls) + right large avatar ─────────
  return (
    <div className="flex h-[78vh] w-full gap-3">
      {/* Left: conversation, fixed height with its own scrollbar */}
      <Card className="flex h-full w-1/2 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink/10 p-3">
          <h4 className="text-sm font-semibold text-ink">{personName}</h4>
          {modeToggle}
        </div>
        {needsVoiceClone ? (
          <Link
            href={`/tablet/${tokenId}#supplement`}
            className="flex items-center gap-2 border-b border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold-dark hover:bg-gold/20"
          >
            <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              還沒生成 {shortName(tablet?.metadata, tokenId)} 的克隆聲音 —— 目前用預設嗓音。
              <span className="underline underline-offset-2">前往補傳區上傳錄音生成本人聲音 →</span>
            </span>
          </Link>
        ) : null}
        <div ref={messagesScrollRef} className="flex-1 min-h-0 overflow-y-auto p-4">
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
                  {/* trimStart:LLM 串流首個 delta 常是換行 (或 <think> 剝離後殘留
                      前導空白),whitespace-pre-wrap 會把它渲染成開頭空行。去掉開頭
                      空白,內文段落間的換行保留。 */}
                  {m.content.replace(/^\s+/, "") || (m.pending ? "…" : "")}
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

      {/* Right: large avatar filling the half */}
      <div className="flex h-full w-1/2 items-stretch overflow-hidden rounded-lg bg-ink">
        {avatarEl}
      </div>
    </div>
  );
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
