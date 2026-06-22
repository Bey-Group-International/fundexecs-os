"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "Connecting agents...",
  "Syncing deal flow...",
  "Loading investor rooms...",
  "Checking approval gates...",
  "Almost ready...",
];

export function DashboardLoadingExperience() {
  const [progress, setProgress] = useState(12);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setProgress((value) => (value >= 96 ? 96 : value + Math.ceil((100 - value) / 8)));
    }, 260);
    return () => window.clearInterval(interval);
  }, []);

  const visibleSteps = STEPS.slice(0, Math.max(1, Math.ceil((progress / 100) * STEPS.length)));

  return (
    <div className="grid min-h-[520px] place-items-center rounded-[2rem] border border-gold-500/35 bg-[#030813] p-4 text-center shadow-[0_28px_100px_-56px_rgba(251,191,36,0.85)]">
      <div className="relative w-full max-w-xl overflow-hidden rounded-[1.75rem] border-4 border-double border-gold-500/80 bg-[radial-gradient(circle_at_50%_20%,rgba(251,191,36,0.14),transparent_34%),linear-gradient(180deg,#071225,#02050b)] p-6">
        <div className="pointer-events-none absolute inset-4 border border-gold-500/20" aria-hidden />
        <div className="relative">
          <p className="font-display text-4xl font-black tracking-tight text-gold-300 drop-shadow-[0_4px_0_rgba(0,0,0,0.8)] sm:text-5xl">
            FUNDEXECS OS
          </p>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.25em] text-fg-secondary">
            Private Markets Operating System
          </p>
          <div
            className="mx-auto mt-8 grid h-32 w-32 place-items-center rounded-full border-4 border-yellow-700 bg-gradient-to-br from-yellow-200 via-yellow-400 to-yellow-600 text-5xl shadow-[inset_-8px_-10px_0_rgba(0,0,0,0.18),0_14px_0_rgba(0,0,0,0.45)] motion-safe:animate-boot"
            aria-hidden
            style={{ imageRendering: "pixelated" }}
          >
            ☺
          </div>
          <p className="mt-7 font-mono text-sm font-semibold text-status-success">
            Initializing AI Executive Team...
            <span className="ml-1 inline-block h-4 w-2 translate-y-0.5 bg-status-success motion-safe:animate-pulse" />
          </p>
          <div className="mx-auto mt-5 max-w-md rounded-xl border-2 border-gold-500/80 bg-black/35 p-4">
            <div className="flex items-center justify-center gap-4 font-mono text-xl font-bold text-fg-primary">
              <span>LOADING...</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-3 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-0.5 rounded-lg border border-gold-500/70 bg-black p-1">
              {Array.from({ length: 24 }).map((_, index) => {
                const lit = index < Math.round((progress / 100) * 24);
                return (
                  <span
                    key={index}
                    className={`h-4 rounded-[2px] ${lit ? "bg-gold-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]" : "bg-surface-2"}`}
                  />
                );
              })}
            </div>
            <ul className="mt-4 space-y-2 text-left font-mono text-sm text-status-success">
              {visibleSteps.map((step) => (
                <li key={step}>{">"} {step}</li>
              ))}
            </ul>
          </div>
          <p className="mt-5 font-display text-2xl font-semibold text-gold-300">FundExecs.com</p>
        </div>
      </div>
    </div>
  );
}
