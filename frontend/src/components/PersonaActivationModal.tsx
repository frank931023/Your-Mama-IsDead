"use client";

/**
 * 數位分身啟動模式選擇 Modal
 *
 * 使用者按下「啟動數位分身互動」會彈出這個 Modal,提供兩種啟動方式:
 *   1. 親身打造 (本地離線訓練)        — 目前 disabled,待離線 pipeline 完工
 *   2. 雲端即時喚起 (cloud API)       — 主路徑,直接打 OpenAI/Anthropic 等
 *
 * 開啟時會 GET /api/personas/cloud-status 詢問 backend,根據哪些 .env
 * key 已設定來決定卡片是否可點擊與顯示哪個 provider 的徽章。
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Cpu, Cloud, X, AlertCircle } from "lucide-react";
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
          chatProvider: null,
          voiceProvider: null,
          imageProvider: null,
          videoProvider: null,
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

  const cloudReady = status?.chat ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="persona-modal-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-lg bg-paper shadow-2xl"
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
            請選擇要以哪種方式,讓這份記憶重新與您交談。
          </p>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <ChoiceCard
            icon={<Cpu className="h-5 w-5" aria-hidden />}
            title="親身打造的記憶"
            tag="尚未開放"
            disabled
            description={
              <>
                以家人留下的影音、信件、對話為基礎,在自己的設備上訓練專屬模型,讓記憶更貼近本人原貌。
                <span className="mt-2 block text-xs text-ink-muted">
                  此功能仍在測試中。目前需要較高配置的設備與時間,我們很快會準備好,請稍候。
                </span>
              </>
            }
            onClick={() => undefined}
          />
          <ChoiceCard
            icon={<Cloud className="h-5 w-5" aria-hidden />}
            title="雲端即時喚起"
            tag={cloudReady ? "推薦" : "未配置"}
            disabled={loadingStatus || !cloudReady}
            highlight={cloudReady}
            description={
              <>
                透過雲端服務,將塔位中保留的故事與影像,即刻轉化為一場與摯愛的對談。無需等待。
                <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                  <li className="flex items-center gap-1.5">
                    <Dot ok={status?.chat ?? false} /> 文字對話
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Dot ok={status?.voice ?? false} /> 語音回應
                    {status?.voiceProvider === "elevenlabs" ? "(高品質)" : ""}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Dot ok={status?.image ?? false} /> 影像懷想
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Dot ok={status?.video ?? false} /> 短片追憶 {status?.video ? "" : "(需設定 FAL_API_KEY)"}
                  </li>
                </ul>
              </>
            }
            onClick={() => {
              router.push(`/tablet/${tokenId}/chat?mode=cloud`);
              onClose();
            }}
          />
        </div>

        {!loadingStatus && !cloudReady ? (
          <div className="mx-6 mb-6 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              雲端服務尚未就緒。請聯絡管理員確認 <code>.env</code> 已設定 <code>OPENAI_API_KEY</code>(對話 / 語音)以及選用的 <code>FAL_API_KEY</code>(影像 / 短片)。
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

function Dot({ ok }: { ok: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-600" : "bg-ink/30"}`}
    />
  );
}
