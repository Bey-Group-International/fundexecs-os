"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EarnIcon, SparkIcon } from "./icons";

const PROMPTS = [
  "Summarize my hottest deal",
  "Who should I follow up with?",
  "Draft an LP update",
  "What needs my approval?",
];

// The Earn entry point on the mobile home screen. AI-first: the operator asks
// Earn in natural language instead of hunting through menus. Submitting routes
// into the full Earn copilot with the question pre-loaded.
export function MobileEarnPanel({ name }: { name: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const first = name.trim().split(/\s+/)[0] || "there";

  function launch(q?: string) {
    const text = (q ?? value).trim();
    router.push(text ? `/earn?ask=${encodeURIComponent(text)}` : "/earn");
  }

  return (
    <section className="fx-ambient relative overflow-hidden rounded-3xl border border-gold-500/25 bg-surface-1/80 p-4">
      <div className="relative flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 text-gold-300">
          <EarnIcon width={22} height={22} />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold-400">Earn · Executive copilot</p>
          <p className="mt-0.5 text-[14px] font-semibold text-fg-primary">Hi {first} — what are we moving forward?</p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          launch();
        }}
        className="relative mt-3.5"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="text"
          enterKeyHint="send"
          aria-label="Ask Earn"
          placeholder="Ask Earn to start a task…"
          className="w-full rounded-2xl border border-line bg-surface-0/70 py-3 pl-4 pr-12 text-[15px] text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none focus:ring-2 focus:ring-gold-400/30"
        />
        <button
          type="submit"
          aria-label="Send to Earn"
          className="fx-tap absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-500 text-surface-0 transition active:scale-95"
        >
          <SparkIcon width={18} height={18} />
        </button>
      </form>

      <div className="relative mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => launch(p)}
            className="fx-tap shrink-0 rounded-full border border-line/70 bg-surface-0/50 px-3 py-1.5 text-[12px] text-fg-secondary transition active:border-gold-500/40 active:text-fg-primary"
          >
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}
