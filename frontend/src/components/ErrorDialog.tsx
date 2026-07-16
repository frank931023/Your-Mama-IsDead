"use client";

/**
 * 全站統一錯誤 Modal + Context
 *
 * 用法:
 *   const { showError } = useError();
 *   showError("標題", e instanceof Error ? e.message : String(e));
 *
 * 設計重點:
 *   - 用 React Context 全域分享,任何深度的元件都能彈訊息
 *   - 多錯誤排隊顯示 (避免短時間連續錯誤被吞掉)
 *   - 自動去重 (相同 title+detail 不會連彈兩次)
 *   - ESC 或點背景關閉
 *   - 將 Provider 包在 providers.tsx 最內層,確保 z-index 最高
 */
import * as React from "react";
import { AlertTriangle, X } from "lucide-react";

import { Button } from "@/components/ui/Button";

export interface ErrorEntry {
  id: string;
  title: string;
  detail?: string;
}

interface ErrorContextValue {
  showError: (title: string, detail?: string | unknown) => void;
}

const ErrorContext = React.createContext<ErrorContextValue | null>(null);

/**
 * 整個 App 只包一次(在 providers.tsx)。
 * 所有子元件都可以 const { showError } = useError() 取得 hook。
 */
export function ErrorDialogProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [queue, setQueue] = React.useState<ErrorEntry[]>([]);

  const showError = React.useCallback((title: string, detail?: string | unknown): void => {
    const detailStr = normaliseDetail(detail);
    setQueue((prev) => {
      // de-dupe identical errors fired in quick succession
      if (prev.some((e) => e.title === title && e.detail === detailStr)) return prev;
      return [...prev, { id: cryptoId(), title, detail: detailStr }];
    });
  }, []);

  const current = queue[0] ?? null;
  const dismiss = (): void => setQueue((prev) => prev.slice(1));

  // ESC closes
  React.useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  return (
    <ErrorContext.Provider value={{ showError }}>
      {children}
      {current ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="error-dialog-title"
          onClick={dismiss}
        >
          <div
            className="relative w-full max-w-lg rounded-lg border border-red-500/30 bg-paper shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={dismiss}
              className="absolute right-3 top-3 rounded-full p-1.5 text-ink-muted hover:bg-paper-soft hover:text-ink"
              aria-label="關閉"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>

            <div className="flex items-start gap-3 border-b border-ink/10 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden />
              </div>
              <div className="flex-1 pt-1">
                <h2 id="error-dialog-title" className="font-serif text-lg text-ink">
                  {current.title}
                </h2>
                {queue.length > 1 ? (
                  <p className="mt-0.5 text-xs text-ink-muted">
                    還有 {queue.length - 1} 則訊息待處理
                  </p>
                ) : null}
              </div>
            </div>

            {current.detail ? (
              <div className="px-5 py-4">
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper-soft/60 px-3 py-2 text-xs leading-relaxed text-ink">
                  {current.detail}
                </pre>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-ink/10 px-5 py-3">
              <Button variant="ghost" size="sm" onClick={dismiss}>
                我知道了
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </ErrorContext.Provider>
  );
}

export function useError(): ErrorContextValue {
  const ctx = React.useContext(ErrorContext);
  if (!ctx) {
    // Soft-fail: log and noop. Avoids blowing up SSR / forgotten provider.
    return {
      showError: (t, d) => {
        // eslint-disable-next-line no-console
        console.error("[useError without provider]", t, d);
      },
    };
  }
  return ctx;
}

function normaliseDetail(detail: string | unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (typeof detail === "string") return detail;
  if (detail instanceof Error) return detail.message;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `err-${Date.now()}-${Math.random()}`;
}
