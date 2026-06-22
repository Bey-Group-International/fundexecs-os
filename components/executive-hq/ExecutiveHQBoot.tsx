"use client";

import { useEffect, useState } from "react";

const BOOT_STEPS = [
  "Connecting agents...",
  "Syncing deal flow...",
  "Loading capital signals...",
  "Authenticating executives...",
  "Almost ready...",
];

const SIDEBAR_ICONS = [
  { label: "Portfolio", symbol: "💼" },
  { label: "Analytics", symbol: "📈" },
  { label: "Research", symbol: "🔍" },
  { label: "Automation", symbol: "⚙️" },
  { label: "Compliance", symbol: "⚖️" },
  { label: "Capital", symbol: "🪙" },
];

type Props = {
  onComplete?: () => void;
  durationMs?: number;
};

export function ExecutiveHQBoot({ onComplete, durationMs = 2800 }: Props) {
  const [progress, setProgress] = useState(0);
  const [visibleSteps, setVisibleSteps] = useState<number>(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const startTime = Date.now();
    const targetProgress = 100;
    const stepInterval = durationMs / BOOT_STEPS.length;

    const progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(Math.round((elapsed / durationMs) * targetProgress), 100);
      setProgress(pct);
      setVisibleSteps(Math.floor((elapsed / stepInterval)));
      if (pct >= 100) {
        clearInterval(progressTimer);
        setTimeout(() => {
          setDone(true);
          onComplete?.();
        }, 320);
      }
    }, 40);

    return () => clearInterval(progressTimer);
  }, [durationMs, onComplete]);

  if (done) return null;

  const filledBlocks = Math.round((progress / 100) * 18);

  return (
    <div
      className="relative flex min-h-[600px] w-full select-none flex-col items-center justify-center overflow-hidden"
      style={{ background: "#06090f", fontFamily: "var(--font-mono, monospace)" }}
    >
      <style>{`
        @keyframes coin-bounce {
          0%, 100% { transform: translateY(0px) rotate(-2deg); }
          50% { transform: translateY(-10px) rotate(2deg); }
        }
        @keyframes sparkle {
          0%, 100% { opacity: 0; transform: scale(0.6); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes step-fade {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Outer ornate border */}
      <div
        className="relative mx-auto flex w-full max-w-lg flex-col items-center px-4 py-6"
        style={{
          border: "2px solid #b49320",
          boxShadow: "0 0 0 1px #b4932040, inset 0 0 60px rgba(180,147,32,0.06), 0 0 40px rgba(180,147,32,0.12)",
          borderRadius: "4px",
        }}
      >
        {/* Corner stars */}
        {["top-left", "top-right", "bottom-left", "bottom-right"].map((pos) => (
          <span
            key={pos}
            className="absolute text-base"
            style={{
              top: pos.includes("top") ? "-1px" : "auto",
              bottom: pos.includes("bottom") ? "-1px" : "auto",
              left: pos.includes("left") ? "8px" : "auto",
              right: pos.includes("right") ? "8px" : "auto",
              color: "#b49320",
              textShadow: "0 0 8px #b49320",
              animation: `sparkle ${1.5 + Math.random()}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 0.8}s`,
            }}
          >
            ★
          </span>
        ))}

        {/* Layout: sidebar icons + center content */}
        <div className="flex w-full items-stretch gap-3">
          {/* Left sidebar icons */}
          <div className="flex flex-col gap-2">
            {SIDEBAR_ICONS.map((icon, i) => (
              <div
                key={icon.label}
                className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-sm border text-lg"
                style={{
                  borderColor: progress > (i / SIDEBAR_ICONS.length) * 100 ? "#b4932060" : "#b4932025",
                  background: progress > (i / SIDEBAR_ICONS.length) * 100 ? "#b4932015" : "transparent",
                  transition: "all 0.3s ease",
                  opacity: progress > (i / SIDEBAR_ICONS.length) * 100 ? 1 : 0.3,
                }}
                title={icon.label}
              >
                <span style={{ fontSize: 14 }}>{icon.symbol}</span>
              </div>
            ))}
          </div>

          {/* Center */}
          <div className="flex flex-1 flex-col items-center gap-3">
            {/* Title */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1.5">
                <span style={{ color: "#b49320", fontSize: 10, textShadow: "0 0 8px #b49320" }}>✦</span>
                <span
                  className="font-display font-black uppercase tracking-[0.2em]"
                  style={{
                    fontSize: 22,
                    background: "linear-gradient(180deg, #f5d86a 0%, #b49320 60%, #8a6e10 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    textShadow: "none",
                    filter: "drop-shadow(0 0 12px rgba(180,147,32,0.6))",
                  }}
                >
                  FundExecs OS
                </span>
                <span style={{ color: "#b49320", fontSize: 10, textShadow: "0 0 8px #b49320" }}>✦</span>
              </div>
              <p
                className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em]"
                style={{ color: "#b49320aa" }}
              >
                Private Markets Operating System
              </p>
            </div>

            {/* Earnest Fundmaker coin mascot */}
            <div className="relative flex items-center justify-center">
              {/* Sparkle dots */}
              {[
                { top: "10%", left: "15%", delay: "0s" },
                { top: "5%", right: "18%", delay: "0.4s" },
                { bottom: "20%", left: "8%", delay: "0.8s" },
                { bottom: "10%", right: "10%", delay: "0.2s" },
              ].map((style, i) => (
                <span
                  key={i}
                  className="absolute text-xs"
                  style={{
                    ...style,
                    color: "#fbbf24",
                    animation: "sparkle 1.2s ease-in-out infinite",
                    animationDelay: style.delay,
                  }}
                >
                  ✦
                </span>
              ))}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/fundexecs/characters/earnest-fundmaker/high-def.png"
                alt="Earnest Fundmaker"
                width={100}
                height={100}
                className="relative z-10"
                style={{
                  animation: "coin-bounce 1.8s ease-in-out infinite",
                  filter: "drop-shadow(0 8px 24px rgba(251,191,36,0.35))",
                  imageRendering: "auto",
                }}
                draggable={false}
              />
            </div>

            {/* Terminal status line */}
            <p
              className="font-mono text-[11px]"
              style={{ color: "#22c55e", textShadow: "0 0 8px #22c55e60" }}
            >
              Initializing AI Executive Team...
              <span style={{ animation: "cursor-blink 0.8s step-start infinite" }}>▮</span>
            </p>

            {/* Progress bar */}
            <div
              className="w-full rounded-sm border p-2"
              style={{ borderColor: "#b4932040", background: "#0a0e18" }}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                  Loading...
                </span>
                <span className="font-mono text-[11px] font-bold text-white">
                  {progress}%
                </span>
              </div>
              {/* Pixel progress bar */}
              <div className="flex gap-[2px]">
                {Array.from({ length: 18 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-3 flex-1 rounded-[1px] transition-all duration-100"
                    style={{
                      background: i < filledBlocks
                        ? `linear-gradient(180deg, #f5d86a, #b49320)`
                        : "#1a1f2e",
                      boxShadow: i < filledBlocks ? "0 0 4px rgba(180,147,32,0.6)" : "none",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Terminal steps */}
            <div className="w-full space-y-1">
              {BOOT_STEPS.slice(0, Math.min(visibleSteps + 1, BOOT_STEPS.length)).map((step, i) => (
                <p
                  key={step}
                  className="font-mono text-[10px]"
                  style={{
                    color: "#22c55e",
                    opacity: i < visibleSteps ? 0.5 : 1,
                    animation: "step-fade 0.3s ease-out",
                  }}
                >
                  <span style={{ color: "#22c55e80" }}>&gt; </span>
                  {step}
                </p>
              ))}
            </div>

            {/* Footer */}
            <p
              className="font-mono text-[10px] tracking-wider"
              style={{ color: "#b49320aa" }}
            >
              FundExecs.com
            </p>
          </div>

          {/* Right sidebar icons (mirror) */}
          <div className="flex flex-col gap-2">
            {SIDEBAR_ICONS.map((icon, i) => (
              <div
                key={icon.label}
                className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-sm border text-lg"
                style={{
                  borderColor: progress > (i / SIDEBAR_ICONS.length) * 100 ? "#b4932060" : "#b4932025",
                  background: progress > (i / SIDEBAR_ICONS.length) * 100 ? "#b4932015" : "transparent",
                  transition: "all 0.3s ease",
                  opacity: progress > (i / SIDEBAR_ICONS.length) * 100 ? 1 : 0.3,
                }}
              >
                <span style={{ fontSize: 14 }}>{icon.symbol}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
