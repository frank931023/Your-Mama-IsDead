"use client";

/**
 * Hero banner 上的動態粒子層 (純 Canvas,無 asset)。
 *
 * 依主題的 particles 類型畫不同的飄動效果,疊在 hero 背景牆之上、頭貼之下:
 *   sakura / petals  花瓣緩緩飄落 + 旋轉
 *   leaves           落葉 (較大、擺動)
 *   snow             雪花 (小白點,慢)
 *   stars            星閃 (定點明滅 + 微移)
 *   candle           燭光暖點上升 (像火星/香煙的暖光)
 *   none             不畫
 *
 * 用 requestAnimationFrame 驅動,卸載時取消;尺寸跟著容器 resize。
 * 粒子數量保守 (~40-60),桌機行動都順。prefers-reduced-motion 時靜止。
 */
import * as React from "react";
import type { ParticleKind } from "@/lib/memorial-themes";

interface Particle {
  x: number;
  y: number;
  size: number;
  speedY: number;
  speedX: number;
  rot: number;
  rotSpeed: number;
  sway: number;
  phase: number;
  alpha: number;
}

interface MemorialParticlesProps {
  kind: ParticleKind;
  /** 粒子顏色 (花瓣/葉/星…)。預設依 kind 給。 */
  color?: string;
  className?: string;
}

const PALETTE: Record<ParticleKind, string> = {
  sakura: "#f4c2d7",
  petals: "#f0cdbb",
  leaves: "#d68a3c",
  snow: "#ffffff",
  stars: "#ffffff",
  candle: "#ffcf8a",
  none: "#ffffff",
};

export function MemorialParticles({
  kind,
  color,
  className,
}: MemorialParticlesProps): React.ReactElement | null {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    if (kind === "none") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const fill = color ?? PALETTE[kind];
    let w = 0;
    let h = 0;
    let raf = 0;
    let particles: Particle[] = [];

    const count =
      kind === "stars" ? 70 : kind === "snow" ? 60 : kind === "candle" ? 36 : 44;

    const rand = (a: number, b: number): number => a + Math.random() * (b - a);

    const spawn = (initial: boolean): Particle => {
      const base = {
        x: rand(0, w || 1),
        y: initial ? rand(0, h || 1) : -rand(10, 60),
        rot: rand(0, Math.PI * 2),
        phase: rand(0, Math.PI * 2),
        alpha: rand(0.5, 1),
      };
      switch (kind) {
        case "stars":
          return { ...base, y: rand(0, h || 1), size: rand(0.8, 2.2), speedY: 0, speedX: 0, rotSpeed: 0, sway: 0 };
        case "snow":
          return { ...base, size: rand(1.5, 3.5), speedY: rand(0.3, 0.9), speedX: rand(-0.2, 0.2), rotSpeed: 0, sway: rand(0.3, 0.8) };
        case "candle":
          return { ...base, y: initial ? rand(0, h || 1) : (h || 1) + rand(0, 40), size: rand(1.2, 3), speedY: -rand(0.3, 0.8), speedX: rand(-0.15, 0.15), rotSpeed: 0, sway: rand(0.2, 0.6) };
        case "leaves":
          return { ...base, size: rand(7, 13), speedY: rand(0.5, 1.2), speedX: rand(-0.3, 0.3), rotSpeed: rand(-0.02, 0.02), sway: rand(0.8, 1.6) };
        default: // sakura / petals
          return { ...base, size: rand(5, 10), speedY: rand(0.4, 1.0), speedX: rand(-0.25, 0.25), rotSpeed: rand(-0.03, 0.03), sway: rand(0.6, 1.3) };
      }
    };

    const resize = (): void => {
      const parent = canvas.parentElement;
      w = parent?.clientWidth ?? canvas.clientWidth;
      h = parent?.clientHeight ?? canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: count }, () => spawn(true));
    };

    const drawPetal = (p: Particle): void => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha * 0.85;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawDot = (p: Particle, glow: boolean): void => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = fill;
      if (glow) {
        ctx.shadowColor = fill;
        ctx.shadowBlur = p.size * 3;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    let t = 0;
    const frame = (): void => {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        if (!reduce) {
          if (kind === "stars") {
            p.alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + p.phase));
          } else {
            p.y += p.speedY;
            p.x += p.speedX + Math.sin(t + p.phase) * p.sway * 0.4;
            p.rot += p.rotSpeed;
          }
        }
        // 出界回收
        if (kind === "candle") {
          if (p.y < -10) Object.assign(p, spawn(false));
        } else if (kind !== "stars") {
          if (p.y > h + 12 || p.x < -20 || p.x > w + 20) Object.assign(p, spawn(false));
        }
        if (kind === "stars" || kind === "snow") drawDot(p, false);
        else if (kind === "candle") drawDot(p, true);
        else drawPetal(p);
      }
      raf = window.requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [kind, color]);

  if (kind === "none") return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}
