import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#1a1814",
          soft: "#2c2925",
          muted: "#6b665e",
        },
        paper: {
          DEFAULT: "#f6f1e7",
          soft: "#ece5d3",
        },
        gold: {
          DEFAULT: "#b08a3e",
          soft: "#d4b265",
          dark: "#7e6027",
        },
      },
      fontFamily: {
        serif: ["'Noto Serif TC'", "'Source Han Serif TC'", "ui-serif", "Georgia", "serif"],
        sans: ["'Noto Sans TC'", "'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        ritual: "0 1px 0 0 rgba(176, 138, 62, 0.4), 0 8px 32px -12px rgba(26, 24, 20, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
