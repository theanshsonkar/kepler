import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        canvas: "var(--canvas)",
        ink: "var(--ink)",
        quiet: "var(--quiet)",
        line: "var(--line)",
        signal: "var(--signal)",
        safe: "var(--safe)",
        warning: "var(--warning)",
      },
      boxShadow: {
        lift: "0 18px 55px rgba(20, 21, 18, 0.10)",
        button: "0 2px 0 rgba(0,0,0,.22)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Arial", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      animation: {
        rise: "rise 700ms cubic-bezier(.2,.8,.2,1) both",
        "soft-pulse": "soft-pulse 2.2s ease-in-out infinite",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "soft-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: ".45" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
