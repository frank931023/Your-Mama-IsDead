"use client";

/**
 * 進度條元件 (estimate-based)
 *
 * 給沒有真實進度回報的非同步任務 (圖片生成、影片渲染) 顯示一個
 * 「合理估計」的進度條 + 已等待秒數,改善「傻傻地等」的體驗。
 *
 * 行為:
 *   - 在 etaSeconds 之內,進度根據已花時間線性逼近 95%
 *   - 超過 etaSeconds 後,進度卡在 95% 持續閃爍直到 active=false
 *   - active=false 時,進度條與計時器消失
 *
 * 用法:
 *   <ProgressBar active={generating} etaSeconds={60} label="Kling 渲染中..." />
 */
import * as React from "react";

interface ProgressBarProps {
  active: boolean;
  /** 預期完成秒數,作為進度條對應的時間刻度 */
  etaSeconds: number;
  /** 顯示在進度條上方的標題 (例:"AI 渲染中...") */
  label: string;
}

export function ProgressBar({ active, etaSeconds, label }: ProgressBarProps): React.ReactElement | null {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 200);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  // 進度上限 95%,留 5% 給「最後等待 API 回 response」的空間
  const ratio = Math.min(elapsed / etaSeconds, 1);
  const pct = Math.round(ratio * 95);
  const overdue = elapsed > etaSeconds;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span>{label}</span>
        <span className="tabular-nums">
          {elapsed.toFixed(1)}s {overdue ? "(較預期久)" : `/ 約 ${etaSeconds}s`}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
        <div
          className={`h-full rounded-full bg-gold transition-[width] duration-200 ease-out ${
            overdue ? "animate-pulse" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
