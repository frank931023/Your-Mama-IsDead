"use client";

/**
 * LamAvatar — 自建 LAM 渲染機驅動的即時 3DGS 說話頭 avatar。
 *
 * 與 SimliAvatar 的差異 (外殼風格一致,內裡完全不同)
 * ─────────────────────────────────────────────────
 *   SimliAvatar 把 TTS 音訊推給 Simli 的雲端 WebRTC,拿回一條 lip-sync 影片軌。
 *   LamAvatar 則:
 *     - 用 WebSocket 直連自建渲染機 (RenderChatClient):一條連線同時拿
 *       LLM 文字 token (串流) + 每句的音訊 + 逐幀 ARKit blendshape。
 *     - 在瀏覽器本地用 WebGL (gaussian-splat-renderer-for-lam) 把一個 3DGS
 *       高斯潑濺人頭即時渲染出來,逐幀餵入表情權重做 lip-sync / 表情。
 *   也就是說「對話」與「avatar 動畫」都在這個元件內完成,不再需要外部 chat/voice。
 *
 * ChatInterface 該怎麼接 (cloud + LAM 模式)
 * ─────────────────────────────────────────
 *   原本 typing/voice 流程是:streamChat (SSE 文字) → triggerVoice (TTS) →
 *   simliRef.playAudio。改用 LamAvatar 後,這三步合一:
 *     1. 仍照舊把 user 訊息 + 空 assistant placeholder 塞進 messages、清空輸入框。
 *     2. 在送出的「使用者手勢同步堆疊」內先呼叫 lamRef.current?.unlockAudio()。
 *     3. 構造完整 OpenAI 風格 messages 陣列:
 *          [ {role:"system", content: 人設 prompt},
 *            ...歷史 {role, content},
 *            {role:"user", content: 本次輸入} ]
 *        然後呼叫 lamRef.current?.sendChat(messages)。system prompt 由前端自備
 *        (這條 WS 不像 /chat 端點會幫你補人設),可沿用後端用的同一份人設文案。
 *     4. 文字顯示改吃 onTextDelta:把 delta 累加到當前 assistant placeholder
 *        (取代 streamChat 的 onToken);onResponseDone 時把 pending 標記清掉。
 *     5. 不再呼叫 triggerVoice / cloud-voice / playAudio:音訊與表情由本元件
 *        自動 prebuffer + 同步播放。onSpeakingChange 可拿來顯示「回應中…」。
 *     6. interrupt():使用者打斷時呼叫 lamRef.current?.interrupt()。
 *   imperative handle 刻意貼近 SimliAvatarHandle (unlockAudio / interrupt 同名),
 *   只是把 playAudio(src) 換成 sendChat(messages),以壓低 ChatInterface 的改動面。
 */
import * as React from "react";
import { Loader2, AlertCircle } from "lucide-react";

import { fetchAvatarSession, ApiError, BACKEND_URL } from "@/lib/api";
import { RenderChatClient } from "@/lib/render-chat";
import { probeHeadBone, applyHeadPose, type HeadBoneHandle } from "@/lib/head-pose";
import { WebGLGuard } from "@/components/baibai/WebGLGuard";
import { cn } from "@/lib/utils";

// 渲染器套件 (gaussian-splat-renderer-for-lam) 是純瀏覽器包:模組頂層就摸 window /
// three / WebGL。**絕對不能在頂層 import** —— 即使本元件標了 "use client",Next.js
// 仍會在 server 端 SSR 預渲染一次,頂層 import 會在 server 求值時直接 throw,把整個
// /tablet/[id]/chat 頁打成 500。所以改用「動態 import」在瀏覽器 runtime 才載入 (見
// init() 內的 await import(...))。型別宣告在 src/types/gaussian-splat-renderer-for-lam.d.ts。
import type { GaussianSplatRenderer } from "gaussian-splat-renderer-for-lam";

export interface LamAvatarHandle {
  /** 在使用者手勢同步堆疊內呼叫,resume AudioContext + 解鎖自動播放。可重複呼叫。 */
  unlockAudio(): void;
  /**
   * 發一輪對話:傳完整 messages 陣列 (system + 歷史 + 最新 user)。
   * 流式回應的文字會經 onTextDelta 上來;音訊 + 表情自動 prebuffer 後播放。
   */
  sendChat(messages: { role: string; content: string }[]): void;
  /** 打斷當前回應 (停音訊 + 清佇列 + 表情歸零)。 */
  interrupt(): void;
}

interface LamAvatarProps {
  tokenId: string;
  jwt: string;
  className?: string;
  /** 未 ready 時當背景的肖像。 */
  posterUrl?: string | null;
  onReady?: () => void;
  onError?: (msg: string) => void;
  /** session 回 401 (JWT 過期) → 請父層重新登入後以新 jwt 重掛本元件。 */
  onAuthError?: () => void;
  /** 流式文字 token,上報給 ChatInterface 累加顯示。 */
  onTextDelta?: (text: string) => void;
  /** 本輪文字串流結束。 */
  onResponseDone?: () => void;
  /** 開始/結束出聲。 */
  onSpeakingChange?: (speaking: boolean) => void;
}

export const LamAvatar = React.forwardRef<LamAvatarHandle, LamAvatarProps>(
  function LamAvatar(
    {
      tokenId,
      jwt,
      className,
      posterUrl,
      onReady,
      onError,
      onAuthError,
      onTextDelta,
      onResponseDone,
      onSpeakingChange,
    },
    ref,
  ) {
    // 渲染器要掛 canvas 的容器。
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const clientRef = React.useRef<RenderChatClient | null>(null);
    // 渲染器是單例 (getInstance);存起來卸載時 disposeModel。
    const rendererRef = React.useRef<GaussianSplatRenderer | null>(null);
    // 頭部擺動:挖到的 head bone handle + 自己的 rAF id (套件不收 head pose,
    // 我們直接驅動引擎內部的 'head' bone)。
    const headBoneRef = React.useRef<HeadBoneHandle | null>(null);
    const headRafRef = React.useRef<number | null>(null);
    // 該 persona 綁定的克隆聲音 label (avatar-session 從 metadata.dsas.avatar.voiceLabel
    // 讀出來)。每輪 sendChat 要顯式帶上,渲染機才會用本人克隆音色而非預設嗓音。
    const voiceRef = React.useRef<string | undefined>(undefined);

    const [status, setStatus] = React.useState<"connecting" | "ready" | "error">("connecting");
    const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

    // 把最新的 prop 回呼放進 ref,讓 RenderChatClient 的回呼不必隨 prop 變動重建
    // 連線 (effect 依賴只留 tokenId/jwt/avatarUrl,語意上「換人/換臉/換 token 才重連」)。
    const cbRef = React.useRef({ onTextDelta, onResponseDone, onSpeakingChange, onError });
    React.useEffect(() => {
      cbRef.current = { onTextDelta, onResponseDone, onSpeakingChange, onError };
    }, [onTextDelta, onResponseDone, onSpeakingChange, onError]);

    React.useEffect(() => {
      let cancelled = false;

      const init = async (): Promise<void> => {
        try {
          setStatus("connecting");
          setErrorMessage(null);

          // (1) 取 WS 會話資訊 (後端鑑權 + 簽短期 render token)。
          const session = await fetchAvatarSession(tokenId, jwt);
          if (cancelled) return;
          // 記下該 persona 的克隆聲音 label,供每輪 sendChat 帶上 (沒克隆過則
          // undefined,渲染機回退到預設嗓音)。
          voiceRef.current = session.voice;

          // (2) WS 走「後端代理」而非直連渲染機:渲染機在 Tailscale 私有 IP,
          // 瀏覽器直連會被 Chrome Private Network Access 擋 (1006)。改連同源的
          // ws://<backend>/api/avatar/ws?token=...,後端在 tailnet 轉發到渲染機。
          const proxyWsUrl =
            BACKEND_URL.replace(/^http/, "ws") +
            `/api/avatar/ws?token=${encodeURIComponent(session.token)}`;
          const client = new RenderChatClient(proxyWsUrl, {
            onTextDelta: (t) => cbRef.current.onTextDelta?.(t),
            onDone: () => cbRef.current.onResponseDone?.(),
            onSpeakingChange: (s) => cbRef.current.onSpeakingChange?.(s),
            onError: (m) => cbRef.current.onError?.(m),
          });
          clientRef.current = client;
          await client.connect();
          if (cancelled) {
            client.close();
            return;
          }

          // (3) 掛渲染器。3DGS zip 的可下載 URL 由後端 avatar-session 從該 tablet
          // 的 metadata.dsas.avatar.avatarUrl 拼好回傳;avatar 還沒生成則沒有。
          if (!session.avatarUrl) {
            throw new Error("這個分身還沒生成 3D 模型 (請先在鑄造時上傳照片生成)");
          }
          const container = containerRef.current;
          if (!container) throw new Error("avatar 容器尚未掛載");
          // 動態 import:純瀏覽器包,只在 runtime 載入,避免 SSR 崩。
          const { GaussianSplatRenderer } = await import("gaussian-splat-renderer-for-lam");
          if (cancelled) return;
          const renderer = await GaussianSplatRenderer.getInstance(container, session.avatarUrl, {
            getExpressionData: () => clientRef.current?.getCurrentExpression() ?? {},
            backgroundColor: "0d0a08", // 與站內深色背景一致,不帶 #
          });
          if (cancelled) {
            renderer?.disposeModel?.();
            return;
          }
          // getInstance 出錯時可能回 undefined,要判空。
          if (!renderer) throw new Error("3D 分身載入失敗");
          rendererRef.current = renderer;

          // (4) 頭部擺動:套件不收 head pose,直接挖引擎內部的 'head' bone 來驅動。
          // 挖得到就開 rAF:說話時用 backend 頭姿、靜默時 Lissajous 漂移;挖不到
          // 就降級 (頭不動,但其餘功能照常,不報錯)。
          try {
            const handle = probeHeadBone(renderer);
            if (handle) {
              headBoneRef.current = handle;
              const driveHead = (): void => {
                const h = headBoneRef.current;
                const client = clientRef.current;
                if (h && client) {
                  try {
                    applyHeadPose(h, client.getCurrentHeadPose());
                  } catch {
                    /* 單幀失敗不影響後續 */
                  }
                }
                headRafRef.current = requestAnimationFrame(driveHead);
              };
              headRafRef.current = requestAnimationFrame(driveHead);
            } else {
              console.warn("[LamAvatar] 找不到 head bone,頭部擺動停用 (其餘功能正常)");
            }
          } catch (e) {
            console.warn("[LamAvatar] head bone 探測失敗,頭部擺動停用:", e);
          }

          setStatus("ready");
          onReady?.();
        } catch (err) {
          if (cancelled) return;
          // 401 = JWT 過期。請父層重新登入 (清 token + 重跑 SIWE),新 jwt 會
          // 觸發本 effect 重掛重連。不顯示硬錯誤。
          if (err instanceof ApiError && err.status === 401) {
            onAuthError?.();
            return;
          }
          const text = err instanceof Error ? err.message : "分身連線失敗";
          setErrorMessage(text);
          setStatus("error");
          onError?.(text);
        }
      };

      void init();

      return () => {
        cancelled = true;
        // 停頭部擺動 rAF。
        if (headRafRef.current != null) {
          cancelAnimationFrame(headRafRef.current);
          headRafRef.current = null;
        }
        headBoneRef.current = null;
        // 關 WS + 停音訊 + 關 AudioContext。
        try {
          clientRef.current?.close();
        } catch {
          /* best-effort */
        }
        clientRef.current = null;
        // 釋放渲染器資源。disposeModel 會 dispose viewer (含 WebGL renderer),
        // 把 GPU context 還回去,避免重掛時觸頂瀏覽器的 WebGL context 上限。
        // 注意:此版套件的 getInstance 靜態單例 (this.instance) 其實從未被賦值,
        // 每次 getInstance 都會 new 一個新 renderer + 新 viewer,所以這裡 dispose
        // 不會留下「拿到舊單例」的問題。若日後套件改成真單例,需要額外清掉靜態
        // instance 才能重掛 —— 套件未暴露這個 API,屆時須上游補。
        try {
          rendererRef.current?.disposeModel?.();
        } catch {
          /* best-effort:套件無公開 dispose 時盡量不崩 */
        }
        rendererRef.current = null;
      };
      // 只在 tokenId / jwt 變動時重連重掛 (換人 / 換 token)。avatarUrl 由 session
      // 內部取得,回呼 prop 走 cbRef,皆不進依賴。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tokenId, jwt]);

    React.useImperativeHandle(
      ref,
      (): LamAvatarHandle => ({
        unlockAudio(): void {
          clientRef.current?.unlockAudio();
        },
        sendChat(messages: { role: string; content: string }[]): void {
          const client = clientRef.current;
          if (!client) {
            onError?.("分身尚未連線");
            return;
          }
          // 每輪一個 request_id,讓串流 / 二進位 frame 能對得上、也方便打斷。
          // 顯式帶上克隆聲音 label:chat 幀的 voice 優先級最高 (渲染機文件),
          // 缺省才回退到 JWT.voice / 預設嗓音。不帶就會聽到預設音色而非本人。
          client.sendChat({
            messages,
            requestId: crypto.randomUUID(),
            ...(voiceRef.current ? { voice: voiceRef.current } : {}),
          });
        },
        interrupt(): void {
          clientRef.current?.interrupt();
        },
      }),
      [onError],
    );

    return (
      <WebGLGuard>
        <div className={cn("relative w-full overflow-hidden rounded-md bg-[#0d0a08]", className)}>
          {/* 渲染器在這個容器內掛 canvas。未 ready 時用 poster 當背景。 */}
          <div
            ref={containerRef}
            className="h-full w-full"
            style={
              status !== "ready" && posterUrl
                ? {
                    backgroundImage: `url(${posterUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
          />

          {status === "connecting" ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-paper-soft/60">
              <div className="flex items-center gap-2 rounded-md bg-paper px-3 py-1.5 text-xs text-ink-muted shadow-sm">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                連線數位分身中…
              </div>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-paper-soft/80 p-3 text-center">
              <div className="flex max-w-full items-start gap-2 rounded-md bg-paper px-3 py-2 text-xs text-red-400 shadow-sm">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span className="break-words">{errorMessage ?? "分身連線失敗"}</span>
              </div>
            </div>
          ) : null}
        </div>
      </WebGLGuard>
    );
  },
);
