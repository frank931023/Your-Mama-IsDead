"use client";

import * as React from "react";

import { MediaUploader } from "@/components/MediaUploader";
import { Button } from "@/components/ui/Button";
import { useError } from "@/components/ErrorDialog";
import { uploadRelay, type UploadedAsset } from "@/lib/api";
import type { ChatLogEntry } from "@shared/types/tablet";

const PLATFORMS: ReadonlyArray<{ value: ChatLogEntry["platform"]; label: string; format: ChatLogEntry["format"] }> = [
  { value: "line", label: "LINE", format: "txt" },
  { value: "whatsapp", label: "WhatsApp", format: "txt" },
  { value: "facebook", label: "Facebook Messenger", format: "json" },
  { value: "instagram", label: "Instagram DM", format: "json" },
  { value: "telegram", label: "Telegram", format: "json" },
  { value: "discord", label: "Discord", format: "json" },
  { value: "other", label: "其他 / 未列出", format: "txt" },
];

interface ChatLogImporterProps {
  value: ChatLogEntry[];
  onChange: (logs: ChatLogEntry[]) => void;
}

export function ChatLogImporter({ value, onChange }: ChatLogImporterProps): React.ReactElement {
  const { showError } = useError();
  const [platform, setPlatform] = React.useState<ChatLogEntry["platform"]>("line");
  const [format, setFormat] = React.useState<ChatLogEntry["format"]>("txt");
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const p = PLATFORMS.find((p) => p.value === platform);
    if (p) setFormat(p.format);
  }, [platform]);

  const handleFile = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const asset: UploadedAsset = await uploadRelay(file);
      const entry: ChatLogEntry = { platform, uri: asset.uri, format };
      onChange([...value, entry]);
    } catch (e) {
      showError("對話紀錄上傳失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const remove = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-900">
        對話紀錄可能含有活人個資。Prototype 會將檔案永久存入 IPFS,請只上傳已逝者單方訊息或已取得對話對象同意之內容。
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink" htmlFor="chatlog-platform">
            平台
          </label>
          <select
            id="chatlog-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ChatLogEntry["platform"])}
            className="h-10 rounded-md border border-ink/20 bg-paper px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink" htmlFor="chatlog-format">
            檔案格式
          </label>
          <select
            id="chatlog-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ChatLogEntry["format"])}
            className="h-10 rounded-md border border-ink/20 bg-paper px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
          >
            <option value="txt">txt</option>
            <option value="json">json</option>
            <option value="html">html</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".txt,.json,.html,.htm,.zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            loading={uploading}
            onClick={() => fileRef.current?.click()}
          >
            上傳對話紀錄
          </Button>
        </div>
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {value.map((entry, idx) => (
            <li
              key={`${entry.uri}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-md border border-ink/10 bg-paper px-3 py-2 text-xs"
            >
              <div className="flex flex-col">
                <span className="font-medium text-ink">
                  {PLATFORMS.find((p) => p.value === entry.platform)?.label ?? entry.platform} ·{" "}
                  {entry.format}
                </span>
                <span className="truncate text-ink-muted">{entry.uri}</span>
              </div>
              <button
                type="button"
                className="text-ink-muted hover:text-ink hover:underline"
                onClick={() => remove(idx)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer">或拖拉多個對話紀錄一起上傳(預設與目前選單相同平台)</summary>
        <div className="mt-2">
          <MediaUploader
            label="批次上傳"
            description="批次上傳的檔案將共用上方所選的「平台 / 格式」"
            multiple
            accept=".txt,.json,.html,.htm,.zip"
            value={[]}
            onChange={(assets) => {
              const newEntries: ChatLogEntry[] = assets.map((a) => ({
                platform,
                uri: a.uri,
                format,
              }));
              onChange([...value, ...newEntries]);
            }}
          />
        </div>
      </details>
    </div>
  );
}
