/**
 * 祭拜紀念卡產生器
 *
 * 用 HTML5 Canvas 即時繪製一張 1080x1080 的紀念卡,內含:
 *   - 暖橘漸層背景 + 燭光裝飾邊框
 *   - 逝者肖像(圓角)
 *   - 姓名(楷書字型)
 *   - 生卒日期
 *   - 「謹以此心,獻於 ____」儀式銘文
 *   - 底部署名 + 祭拜時間
 *
 * 透過 toBlob 觸發瀏覽器下載,完全在 client 端完成,
 * 不需 server 渲染、不耗外部 API quota。
 */

interface KeepsakeOptions {
  name: string;
  birthDate?: string;
  deathDate?: string;
  portraitUrl?: string;
  fromName?: string;
  message?: string;
  tokenId: string | number;
}

const SIZE = 1080;

export async function generateKeepsake(opts: KeepsakeOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // 背景:深橘到深棕的徑向漸層
  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 100, SIZE / 2, SIZE / 2, SIZE * 0.7);
  grad.addColorStop(0, "#3a2515");
  grad.addColorStop(0.5, "#1f1410");
  grad.addColorStop(1, "#0a0805");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 金色細邊框
  ctx.strokeStyle = "#8a6a32";
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, SIZE - 80, SIZE - 80);
  // 內框
  ctx.strokeStyle = "#d4b26580";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(60, 60, SIZE - 120, SIZE - 120);

  // 載入並繪製肖像
  if (opts.portraitUrl) {
    try {
      const img = await loadImage(opts.portraitUrl);
      const portraitSize = 380;
      const px = (SIZE - portraitSize) / 2;
      const py = 130;
      // 圓角裁切
      ctx.save();
      roundRect(ctx, px, py, portraitSize, portraitSize, 12);
      ctx.clip();
      ctx.drawImage(img, px, py, portraitSize, portraitSize);
      ctx.restore();
      // 肖像金邊
      ctx.strokeStyle = "#d4b265";
      ctx.lineWidth = 3;
      roundRect(ctx, px, py, portraitSize, portraitSize, 12);
      ctx.stroke();
    } catch {
      drawPortraitPlaceholder(ctx, opts.name);
    }
  } else {
    drawPortraitPlaceholder(ctx, opts.name);
  }

  // 姓名
  ctx.fillStyle = "#f5e2b8";
  ctx.textAlign = "center";
  ctx.font = "bold 64px serif";
  ctx.fillText(opts.name, SIZE / 2, 590);

  // 生卒
  if (opts.birthDate || opts.deathDate) {
    ctx.fillStyle = "#d4b26599";
    ctx.font = "26px serif";
    ctx.fillText(`${opts.birthDate || "?"}  –  ${opts.deathDate || "?"}`, SIZE / 2, 632);
  }

  // 中間裝飾線
  ctx.strokeStyle = "#8a6a3280";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SIZE * 0.25, 680);
  ctx.lineTo(SIZE * 0.75, 680);
  ctx.stroke();

  // 銘文
  ctx.fillStyle = "#f5e2b8cc";
  ctx.font = "italic 30px serif";
  ctx.fillText("謹以此心,獻於", SIZE / 2, 730);
  ctx.fillStyle = "#f5e2b8";
  ctx.font = "italic bold 38px serif";
  ctx.fillText(opts.name, SIZE / 2, 780);

  // 留言(如有)
  if (opts.message) {
    ctx.fillStyle = "#d4b265cc";
    ctx.font = "italic 24px serif";
    const wrapped = wrapText(ctx, `「${opts.message}」`, SIZE * 0.7);
    let y = 850;
    for (const line of wrapped.slice(0, 3)) {
      ctx.fillText(line, SIZE / 2, y);
      y += 32;
    }
  }

  // 底部署名 + 日期
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  ctx.fillStyle = "#8a6a32";
  ctx.font = "20px serif";
  ctx.fillText(
    `${opts.fromName || "敬上"}  ・  ${dateStr}  ・  Tablet #${opts.tokenId}`,
    SIZE / 2,
    SIZE - 90,
  );

  // 站名
  ctx.fillStyle = "#8a6a3260";
  ctx.font = "16px sans-serif";
  ctx.fillText("DSAS · 數位塔位", SIZE / 2, SIZE - 60);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob returned null"));
    }, "image/png");
  });
}

/** 觸發瀏覽器下載 blob */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── helpers ──────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPortraitPlaceholder(ctx: CanvasRenderingContext2D, name: string): void {
  const portraitSize = 380;
  const px = (SIZE - portraitSize) / 2;
  const py = 130;
  ctx.fillStyle = "#1a1208";
  roundRect(ctx, px, py, portraitSize, portraitSize, 12);
  ctx.fill();
  ctx.fillStyle = "#8a6a32";
  ctx.textAlign = "center";
  ctx.font = "bold 80px serif";
  ctx.fillText(name.slice(0, 1), SIZE / 2, py + portraitSize / 2 + 30);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    const test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
