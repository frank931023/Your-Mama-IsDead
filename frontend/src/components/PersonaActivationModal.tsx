"use client";

/**
 * 數位分身互動模式選擇 Modal
 *
 * 使用者按下「啟動數位分身互動」會彈出這個 Modal,選擇互動形式:
 *   1. 純文字對談            — 無聲音、無人像,安靜的文字往返
 *   2. 文字對談 + 聲音人像   — 打字輸入,分身以本人聲音與 3D 人像回應
 *   3. 語音對話 + 聲音人像   — 全螢幕人像,直接用麥克風跟分身說話
 *
 * 選定後 router.push 到 /tablet/[tokenId]/chat?ui=text|avatar|voice。
 * 開啟時會 GET /api/personas/cloud-status 詢問 backend,根據對話 / 人像
 * 服務是否就緒決定卡片是否可點。
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, ScanFace, Mic, X, AlertCircle } from "lucide-react";
import type { TabletMetadata } from "@shared/types/tablet";

import { Button } from "@/components/ui/Button";
import { getCloudStatus, type CloudStatus } from "@/lib/api";
import { displayName } from "@/lib/utils";

interface Props {
  tokenId: string;
  metadata?: TabletMetadata | null;
  open: boolean;
  onClose: () => void;
}

export function PersonaActivationModal({ tokenId, metadata, open, onClose }: Props): React.ReactElement | null {
  const router = useRouter();
  const [status, setStatus] = React.useState<CloudStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoadingStatus(true);
    getCloudStatus()
      .then(setStatus)
      .catch(() =>
        setStatus({
          chat: false,
          voice: false,
          image: false,
          video: false,
          avatar: false,
          chatProvider: null,
          voiceProvider: null,
          imageProvider: null,
          videoProvider: null,
          avatarProvider: null,
        }),
      )
      .finally(() => setLoadingStatus(false));
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const chatReady = status?.chat ?? false;
  const avatarReady = status?.avatar ?? false;
  // 語音對話要 STT(麥克風辨識)+ 人像;STT 走雲端 chat key,所以兩者都要就緒。
  const voiceReady = avatarReady && chatReady;
  const hasVoiceClone = !!metadata?.dsas?.avatar?.voiceLabel;

  const go = (ui: "text" | "avatar" | "voice"): void => {
    router.push(`/tablet/${tokenId}/chat?ui=${ui}`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="persona-modal-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl rounded-lg bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1.5 text-ink-muted hover:bg-paper-soft hover:text-ink"
          aria-label="關閉"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="border-b border-ink/10 p-6">
          <h2 id="persona-modal-title" className="font-serif text-2xl text-ink">
            喚起 {displayName(metadata, tokenId)} 的記憶
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            請選擇要以哪種形式,讓這份記憶重新與您交談。
          </p>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-3">
          <ChoiceCard
            icon={<MessageSquare className="h-5 w-5" aria-hidden />}
            title="純文字對談"
            tag={chatReady ? "最快開始" : "未配置"}
            disabled={loadingStatus || !chatReady}
            description={
              <>
                安靜的文字往返,沒有聲音與人像。適合想慢慢打字、慢慢讀的時刻。
                <span className="mt-2 block text-xs text-ink-muted">
                  回覆會參考他留下的對話紀錄與親友分享的回憶。
                </span>
              </>
            }
            onClick={() => go("text")}
          />
          <ChoiceCard
            icon={<ScanFace className="h-5 w-5" aria-hidden />}
            title="文字對談・聲音與人像"
            tag={avatarReady ? "推薦" : "未配置"}
            disabled={loadingStatus || !avatarReady}
            highlight={avatarReady}
            description={
              <>
                打字輸入,分身會以{hasVoiceClone ? "本人克隆的聲音" : "聲音"}與 3D 人像回應你。
                <span className="mt-2 block text-xs text-ink-muted">
                  {hasVoiceClone
                    ? "已生成本人聲音,將以他的嗓音回應。"
                    : "尚未克隆本人聲音,將先以預設嗓音回應(可至塔位頁補傳錄音)。"}
                </span>
              </>
            }
            onClick={() => go("avatar")}
          />
          <ChoiceCard
            icon={<Mic className="h-5 w-5" aria-hidden />}
            title="語音對話・聲音與人像"
            tag={voiceReady ? "最沉浸" : "未配置"}
            disabled={loadingStatus || !voiceReady}
            description={
              <>
                全螢幕人像,按住麥克風直接開口說話,像一通跨越時空的視訊電話。
                <span className="mt-2 block text-xs text-ink-muted">
                  需要瀏覽器麥克風權限;說完後分身會用聲音回應你。
                </span>
              </>
            }
            onClick={() => go("voice")}
          />
        </div>

        {!loadingStatus && !chatReady && !avatarReady ? (
          <div className="mx-6 mb-6 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              互動服務尚未就緒。請聯絡管理員確認 render 渲染機已啟動,或 <code>.env</code> 已設定{" "}
              <code>OPENAI_API_KEY</code> / <code>ANTHROPIC_API_KEY</code>(文字對談)。
            </div>
          </div>
        ) : null}

        <div className="border-t border-ink/10 px-6 py-3 text-right">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  tag,
  description,
  onClick,
  disabled = false,
  highlight = false,
}: {
  icon: React.ReactNode;
  title: string;
  tag?: string;
  description: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  highlight?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "group flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors",
        disabled
          ? "cursor-not-allowed border-ink/10 bg-paper-soft/50 opacity-60"
          : highlight
            ? "border-gold bg-gold/5 hover:bg-gold/10"
            : "border-ink/15 bg-paper hover:border-gold/50 hover:bg-paper-soft/40",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium text-ink">
          {icon}
          {title}
        </span>
        {tag ? (
          <span
            className={[
              "rounded-full px-2 py-0.5 text-xs",
              disabled
                ? "bg-ink/10 text-ink-muted"
                : highlight
                  ? "bg-gold/20 text-gold-dark"
                  : "bg-ink/5 text-ink-muted",
            ].join(" ")}
          >
            {tag}
          </span>
        ) : null}
      </div>
      <div className="text-sm text-ink-muted">{description}</div>
    </button>
  );
}
