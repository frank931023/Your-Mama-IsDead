"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";

// Below the ceremony protocol's 32-character limit, including emoji code units.
const MAX_NAME_LENGTH = 24;
const normalizeName = (value: string): string =>
  value.replace(/[\u0000-\u001f\u007f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();

interface HallNameEntryProps {
  identity: string;
  memorialName: string;
  onExit: () => void;
  children: (name: string) => React.ReactNode;
}

/** Mount the hall (and its presence connection) only after confirming a name. */
export function HallNameEntry({ identity, memorialName, onExit, children }: HallNameEntryProps): React.ReactElement {
  const storageKey = `dsas:hall-name:${identity}`;
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [enteredName, setEnteredName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = normalizeName(window.localStorage.getItem(storageKey) ?? "");
      if (saved.length <= MAX_NAME_LENGTH) setDraft(saved);
    } catch {
      // Disabled storage must not prevent entering the hall.
    }
    setReady(true);
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [storageKey]);

  if (enteredName) return <>{children(enteredName)}</>;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="hall-name-title"
      aria-describedby="hall-name-description"
      onCancel={(event) => { event.preventDefault(); onExit(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-gold/25 bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <form
        className="p-6 sm:p-8"
        onSubmit={(event) => {
          event.preventDefault();
          const name = normalizeName(draft);
          if (!name || name.length > MAX_NAME_LENGTH) {
            setError(`請輸入 1–${MAX_NAME_LENGTH} 字的稱呼。`);
            return;
          }
          try {
            if (remember) window.localStorage.setItem(storageKey, name);
            else window.localStorage.removeItem(storageKey);
          } catch {
            // The chosen name still works for this visit without persistence.
          }
          dialogRef.current?.close();
          setEnteredName(name);
        }}
      >
        <p className="text-xs tracking-[0.2em] text-gold-dark">進入紀念空間</p>
        <h2 id="hall-name-title" className="mt-3 font-serif text-2xl">讓親友知道您是誰</h2>
        <p id="hall-name-description" className="mt-3 text-sm leading-relaxed text-ink-muted">
          即將進入「{memorialName}」的靈堂。請填寫希望親友看到的稱呼，可使用暱稱，無需連接錢包。
        </p>
        <label htmlFor="hall-display-name" className="mt-6 block text-sm font-medium">您的稱呼</label>
        <input
          id="hall-display-name"
          autoFocus
          autoComplete="nickname"
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          placeholder="例如：小安、陳阿姨"
          aria-invalid={!!error}
          aria-describedby={error ? "hall-name-help hall-name-error" : "hall-name-help"}
          onChange={(event) => { setDraft(event.target.value); setError(null); }}
          className="mt-2 h-12 w-full rounded-lg border border-ink/20 bg-paper px-3 text-base focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
        />
        <p id="hall-name-help" className="mt-2 text-xs leading-relaxed text-ink-muted">稱呼會顯示於人物名牌、祭拜通知，並作為留言預設署名。</p>
        {error && <p id="hall-name-error" role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <label className="mt-5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4 accent-gold" />
          在這台裝置記住稱呼
        </label>
        <p className="mt-1 pl-6 text-xs text-ink-muted">下次可沿用或修改；共用裝置可取消勾選。</p>
        <div className="mt-7 flex gap-3">
          <Button type="button" variant="outline" onClick={onExit} className="flex-1">返回</Button>
          <Button type="submit" disabled={!ready} className="flex-1">進入靈堂</Button>
        </div>
      </form>
    </dialog>
  );
}
