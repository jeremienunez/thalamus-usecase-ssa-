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
      transitionDuration: {
        fast: "150ms",
        med: "250ms",
      },
      transitionTimingFunction: {
        palantir: "cubic-bezier(0.2, 0, 0, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
