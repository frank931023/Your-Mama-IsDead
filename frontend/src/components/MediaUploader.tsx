"use client";

import * as React from "react";
import { Loader2, Upload, X, FileText, Image as ImageIcon, Music, Film } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useError } from "@/components/ErrorDialog";
import { uploadRelay, type UploadedAsset } from "@/lib/api";
import { cn, ipfsToHttps } from "@/lib/utils";

export interface MediaUploaderProps {
  label: string;
  description?: string;
  accept?: string;
  multiple?: boolean;
  /** When set, only one asset is kept at a time. */
  single?: boolean;
  value: UploadedAsset[];
  onChange: (assets: UploadedAsset[]) => void;
}

interface PendingUpload {
  id: string;
  name: string;
  pct: number;
  error: string | null;
}

export function MediaUploader({
  label,
  description,
  accept,
  multiple = true,
  single = false,
  value,
  onChange,
}: MediaUploaderProps): React.ReactElement {
  const { showError } = useError();
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const acceptsMultiple = single ? false : multiple;

  const handleFiles = React.useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const incoming: PendingUpload[] = list.map((f) => ({
        id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
        name: f.name,
        pct: 0,
        error: null,
      }));
      setPending((prev) => [...prev, ...incoming]);

      const results = await Promise.allSettled(
        list.map((file, i) => {
          const id = incoming[i]!.id;
          return uploadRelay(file, (pct) => {
            setPending((prev) => prev.map((p) => (p.id === id ? { ...p, pct } : p)));
          });
        }),
      );

      const successes: UploadedAsset[] = [];
      const failures: { name: string; reason: string }[] = [];
      results.forEach((r, i) => {
        const id = incoming[i]!.id;
        const fileName = incoming[i]!.name;
        if (r.status === "fulfilled") {
          successes.push(r.value);
          setPending((prev) => prev.filter((p) => p.id !== id));
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : "Upload failed";
          failures.push({ name: fileName, reason: msg });
          // drop the row entirely; the modal carries the failure information
          setPending((prev) => prev.filter((p) => p.id !== id));
        }
      });

      if (failures.length > 0) {
        const detail = failures.map((f) => `• ${f.name}\n  ${f.reason}`).join("\n\n");
        showError(failures.length === 1 ? "檔案上傳失敗" : `${failures.length} 個檔案上傳失敗`, detail);
      }

      if (successes.length > 0) {
        if (single) {
          onChange([successes[successes.length - 1]!]);
        } else {
          onChange([...value, ...successes]);
        }
      }
    },
    [onChange, showError, single, value],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files) void handleFiles(e.dataTransfer.files);
  };

  const remove = (uri: string): void => onChange(value.filter((a) => a.uri !== uri));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">{label}</h4>
          {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-4 w-4" aria-hidden />
          選擇檔案
        </Button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink/20 bg-paper-soft/40 p-6 text-center transition-colors",
          dragOver && "border-gold bg-gold/5",
        )}
      >
        <Upload className="h-6 w-6 text-ink-muted" aria-hidden />
        <p className="text-sm text-ink">
          將檔案拖入此區或<button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mx-1 underline underline-offset-2 hover:text-gold-dark"
          >點擊選擇</button>
        </p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple={acceptsMultiple}
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {pending.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {pending.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-md border border-ink/10 bg-paper px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-2 truncate">
                <Loader2 className="h-3 w-3 animate-spin text-ink-muted" aria-hidden />
                <span className="truncate">{p.name}</span>
              </span>
              <span className="text-ink-muted tabular-nums">{p.pct}%</span>
            </li>
          ))}
        </ul>
      ) : null}

      {value.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {value.map((asset) => (
            <li
              key={asset.uri}
              className="group relative flex flex-col gap-1.5 rounded-md border border-ink/10 bg-paper p-2"
            >
              <AssetThumb asset={asset} />
              <p className="truncate text-xs text-ink" title={asset.name}>
                {asset.name}
              </p>
              <p className="truncate text-[10px] text-ink-muted">{asset.uri}</p>
              <button
                type="button"
                onClick={() => remove(asset.uri)}
                className="absolute right-1 top-1 rounded-full bg-ink/70 p-0.5 text-paper opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`移除 ${asset.name}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AssetThumb({ asset }: { asset: UploadedAsset }): React.ReactElement {
  const ct = asset.contentType.toLowerCase();
  if (ct.startsWith("image/")) {
    return (
      <img
        src={ipfsToHttps(asset.uri)}
        alt={asset.name}
        className="h-24 w-full rounded object-cover"
        loading="lazy"
      />
    );
  }
  const Icon = ct.startsWith("video/")
    ? Film
    : ct.startsWith("audio/")
      ? Music
      : ct.startsWith("image/")
        ? ImageIcon
        : FileText;
  return (
    <div className="flex h-24 w-full items-center justify-center rounded bg-paper-soft">
      <Icon className="h-8 w-8 text-ink-muted" aria-hidden />
    </div>
  );
}
