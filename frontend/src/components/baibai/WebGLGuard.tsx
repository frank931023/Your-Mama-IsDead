"use client";

/**
 * WebGLGuard — 在掛載 react-three-fiber 的 <Canvas> 之前先確認瀏覽器真的能
 * 建立 WebGL context。
 *
 * 為什麼需要:Three.js 的 WebGLRenderer 建構子在拿不到 WebGL context 時會
 * 直接 throw "Error creating WebGL context."。在 <Canvas> 裡這個 throw 會冒泡
 * 成 React 的 Unhandled Runtime Error,把整頁打掛(白屏)。常見觸發原因:
 *   - 瀏覽器關閉了硬體加速 (chrome://settings → 系統 → 使用硬體加速)
 *   - GPU 驅動被瀏覽器列入黑名單 / 驅動過舊
 *   - 同時開太多 WebGL context(瀏覽器有上限,通常 ~16)
 *
 * 與其讓整頁崩,這個 guard 先用一個拋棄式 <canvas> 探測 WebGL;不可用時改顯示
 * 一張說明卡,告訴使用者怎麼開啟硬體加速,線上靈堂的其餘 DOM(回最上層、留言
 * 等)仍可正常運作。
 */
import * as React from "react";

/** 探測瀏覽器能否建立 WebGL context。在 SSR / 無 document 時回傳 true(交給
 *  client 端再判斷),避免 hydration 前就誤判。 */
function detectWebGL(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return gl != null;
  } catch {
    return false;
  }
}

interface WebGLGuardProps {
  children: React.ReactNode;
  /** 自訂不可用時的內容;不給就用預設說明卡。 */
  fallback?: React.ReactNode;
}

export function WebGLGuard({ children, fallback }: WebGLGuardProps): React.ReactElement {
  // null = 還沒在 client 端判斷過。先當作可用,mount 後再校正,避免 SSR 閃爍。
  const [ok, setOk] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setOk(detectWebGL());
  }, []);

  if (ok === false) {
    return (
      <>
        {fallback ?? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0d0a08] p-8 text-center">
            <p className="text-base font-medium text-paper">無法載入 3D 靈堂場景</p>
            <p className="max-w-md text-sm text-paper/70">
              你的瀏覽器目前無法建立 WebGL(3D 繪圖)畫面。多半是「硬體加速」被關閉了。
            </p>
            <p className="max-w-md text-xs text-paper/50">
              Chrome:設定 → 系統 → 開啟「使用硬體加速」→ 重新啟動瀏覽器。
              或在網址列開 <span className="font-mono">chrome://gpu</span> 檢查 WebGL 狀態。
            </p>
          </div>
        )}
      </>
    );
  }

  // ok === null(尚未判斷)或 true:正常渲染 3D 內容。null 時先渲染,讓 useEffect
  // 跑完;若偵測為 false 會在下一個 render 切到 fallback。
  return <>{children}</>;
}
