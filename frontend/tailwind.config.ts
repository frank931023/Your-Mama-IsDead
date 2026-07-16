import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // 「暗夜靈堂 × 鎏金燭光」色系。
      // 語意不變:ink 永遠是前景(文字)、paper 永遠是底色、gold 是香火。
      // 深色化只改值不改名,全站沿用 text-ink / bg-paper 的頁面自動換膚。
      colors: {
        ink: {
          DEFAULT: "#ede5d6",
          soft: "#cfc5b0",
          muted: "#958976",
        },
        paper: {
          DEFAULT: "#0d0b08",
          soft: "#181310",
        },
        gold: {
          DEFAULT: "#c9a45e",
          soft: "#e9d5a4",
          dark: "#a07d3d",
        },
      },
      fontFamily: {
        serif: [
          "var(--font-serif)",
          "'Noto Serif TC'",
          "'Source Han Serif TC'",
          "ui-serif",
          "Georgia",
          "serif",
        ],
        sans: [
          "var(--font-sans)",
          "'Noto Sans TC'",
          "'Inter'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        // 面板:頂部一絲鎏金 hairline + 深沉的墨影
        ritual:
          "inset 0 1px 0 0 rgba(201, 164, 94, 0.18), 0 24px 48px -24px rgba(0, 0, 0, 0.8)",
        // 燭光暈:金色外框 + 柔和輝光,給主要 CTA 與焦點元素
        glow: "0 0 0 1px rgba(201, 164, 94, 0.35), 0 8px 40px -10px rgba(201, 164, 94, 0.45)",
        "glow-lg": "0 0 90px -16px rgba(201, 164, 94, 0.5)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        breathe: {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.05)" },
        },
        // 香火微粒:緩慢上升、輕微飄移後淡出
        drift: {
          "0%": { transform: "translateY(0) translateX(0)", opacity: "0" },
          "12%": { opacity: "0.8" },
          "85%": { opacity: "0.15" },
          "100%": { transform: "translateY(-42vh) translateX(16px)", opacity: "0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.9s cubic-bezier(0.22, 1, 0.36, 1) both",
        breathe: "breathe 5.5s ease-in-out infinite",
        drift: "drift 10s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
