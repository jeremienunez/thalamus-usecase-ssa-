import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0A0E14",
        panel: "#0F1419",
        elevated: "#151B23",
        hover: "#1C232D",
        active: "#232B37",
        hairline: "#1F2937",
        "hairline-hot": "#2D3748",
        primary: "#E6EDF3",
        muted: "#8B949E",
        dim: "#6E7681",
        numeric: "#C9D1D9",
        cyan: "#22D3EE",
        amber: "#F59E0B",
        hot: "#F87171",
        cold: "#34D399",
        field: "#A78BFA",
        osint: "#60A5FA",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        nano: ["10px", { lineHeight: "14px", letterSpacing: "0.04em" }],
        micro: ["11px", { lineHeight: "14px" }],
        label: ["11px", { lineHeight: "16px", letterSpacing: "0.1em" }],
        caption: ["12px", { lineHeight: "16px" }],
        body: ["14px", { lineHeight: "20px" }],
        h2: ["16px", { lineHeight: "24px" }],
        h1: ["20px", { lineHeight: "28px" }],
        display: ["28px", { lineHeight: "32px" }],
      },
      borderRadius: {
        sm: "2px",
      },
      boxShadow: {
        hud: "0 0 0 1px rgba(34,211,238,0.06), 0 8px 24px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.02) inset",
        elevated: "0 12px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03) inset",
        pop: "0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(34,211,238,0.10)",
        glow: "0 0 24px rgba(34,211,238,0.35)",
        "glow-hot": "0 0 24px rgba(248,113,113,0.45)",
      },
      zIndex: {
        rail: "20",
        hud: "30",
        drawer: "40",
        palette: "50",
        toast: "60",
      },
      transitionDuration: {
        fast: "150ms",
        med: "250ms",
      },
      transitionTimingFunction: {
        palantir: "cubic-bezier(0.2, 0, 0, 1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.2, 0, 0, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
