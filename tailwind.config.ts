import type { Config } from "tailwindcss";

// Visual system adopted from the FundExecs OS Command Center / Agent Copilot
// designs: warm near-black surfaces, a gold accent, and the Space Grotesk /
// DM Sans / JetBrains Mono type stack. The six per-agent colors are preserved
// for agent identity.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm-black surface ramp (0 = page background)
        surface: {
          0: "#0B0A08",
          1: "#141310",
          2: "#1C1A16",
          3: "#26231D",
        },
        line: "#2C2820",
        gold: {
          300: "#E4CD93",
          400: "#D4AF6A",
          500: "#C2974A",
        },
        fg: {
          primary: "#F5F1E8",
          secondary: "#B7B0A1",
          muted: "#7E7869",
        },
        status: {
          success: "#5FB87A",
          warning: "#D6A24A",
          info: "#5B9BD5",
          danger: "#D46A5A",
        },
        // Agent palette (identity) — see AGENT.md / README "Animated Workspace"
        agent: {
          analyst: "#22d3ee",
          associate: "#6366f1",
          ir: "#f59e0b",
          ops: "#22c55e",
          diligence: "#ef4444",
          admin: "#cbd5e1",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        fxPulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        // Soft entrance — cards/rows lift into place. Used with `both` so the
        // pre-animation state (faded, nudged down) holds before it runs.
        fxFadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Slow breathing glow for live/ambient accents (graph nodes, dots).
        fxGlow: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        // One-shot wiggle for the mailbox when a new message arrives.
        fxShake: {
          "0%, 100%": { transform: "translateX(0) rotate(0deg)" },
          "20%": { transform: "translateX(-2px) rotate(-9deg)" },
          "40%": { transform: "translateX(2px) rotate(9deg)" },
          "60%": { transform: "translateX(-2px) rotate(-6deg)" },
          "80%": { transform: "translateX(2px) rotate(6deg)" },
        },
        // One-shot pop for the lightbulb when a new deal lands.
        fxNudge: {
          "0%, 100%": { transform: "scale(1)" },
          "45%": { transform: "scale(1.28)" },
        },
      },
      animation: {
        pulse: "fxPulse 1.6s ease-in-out infinite",
        "fade-up": "fxFadeUp 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        glow: "fxGlow 3.2s ease-in-out infinite",
        shake: "fxShake 0.6s ease-in-out",
        nudge: "fxNudge 0.5s ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
