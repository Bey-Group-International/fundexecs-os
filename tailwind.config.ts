import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Agent palette — see AGENT.md / README "Animated Workspace"
        agent: {
          analyst: "#22d3ee", // cyan
          associate: "#6366f1", // indigo
          ir: "#f59e0b", // gold
          ops: "#22c55e", // green
          diligence: "#ef4444", // red
          admin: "#cbd5e1", // silver
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
