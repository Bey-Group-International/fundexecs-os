"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { setTourHidden } from "@/app/(app)/tour-actions";

// First-run setup guide. Surfaces on every authed page until the operator
// completes the 5-step foundation. Progress + collapsed state persist in
// localStorage so it survives navigation and can be resumed or reset.

interface SetupStep {
  title: string;
  body: string;
  href: string;
  cta: string;
}

const STEPS: SetupStep[] = [
  {
    title: "Complete your firm profile",
    body: "Add your firm name, entity type, and primary strategy so Earn can match you with the right counterparties.",
    href: "/build/profile",
    cta: "Open Profile",
  },
  {
    title: "Define your investment thesis",
    body: "Set target sectors, check size, geography, and stage. This is Earn's mandate — the tighter it is, the better the matches.",
    href: "/build/thesis",
    cta: "Open Thesis",
  },
  {
    title: "Set up your brand kit",
    body: "Upload your logo and set primary colors. Earn uses these in every memo, deck, and investor package it produces.",
    href: "/build/brand",
    cta: "Open Brand Studio",
  },
  {
    title: "Build your LP pipeline",
    body: "Add your target LPs, family offices, or capital partners. Source Hub shows your full outreach funnel in one view.",
    href: "/source/lp_pipeline",
    cta: "Open LP Pipeline",
  },
  {
    title: "Give Earn your first command",
    body: 'Type a plain-language objective — "Source multifamily targets under $50M in Texas" — and watch Earn plan, delegate, and execute.',
    href: "/workspace",
    cta: "Open Earn",
  },
];

// Keys are suffixed with orgId so switching orgs doesn't bleed state.
function storageKeys(orgId: string) {
  return {
    done: `fx_setup_done_v2:${orgId}`,
    collapsed: `fx_setup_collapsed_v2:${orgId}`,
    hidden: `fx_setup_hidden_v2:${orgId}`,
  };
}

export function GuidedTour({ orgId, initialHidden = false }: { orgId: string; initialHidden?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(initialHidden);

  useEffect(() => {
    setMounted(true);
    const keys = storageKeys(orgId);
    try {
      const d = JSON.parse(localStorage.getItem(keys.done) ?? "[]");
      if (Array.isArray(d)) setDone(d);
      setCollapsed(localStorage.getItem(keys.collapsed) === "1");
      // DB is the source of truth for hidden; only read localStorage if DB says not hidden.
      if (!initialHidden) setHidden(localStorage.getItem(keys.hidden) === "1");
    } catch {
      // ignore malformed storage
    }

    function openTour() {
      persistHidden(false);
      persistCollapsed(false);
    }
    function hideTour() {
      persistHidden(true);
    }
    window.addEventListener("fx:open-tour", openTour);
    window.addEventListener("fx:hide-tour", hideTour);
    return () => {
      window.removeEventListener("fx:open-tour", openTour);
      window.removeEventListener("fx:hide-tour", hideTour);
    };
  // Per-orgId mount setup: reads initial state from localStorage once and wires
  // the window listeners. initialHidden / persist* are intentionally read at
  // setup time only — re-running on their identity would re-register listeners
  // and clobber user-changed state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function persistDone(next: number[]) {
    setDone(next);
    try { localStorage.setItem(storageKeys(orgId).done, JSON.stringify(next)); } catch { /* ignore */ }
  }
  function persistCollapsed(v: boolean) {
    setCollapsed(v);
    try { localStorage.setItem(storageKeys(orgId).collapsed, v ? "1" : "0"); } catch { /* ignore */ }
  }
  function persistHidden(v: boolean) {
    setHidden(v);
    try { localStorage.setItem(storageKeys(orgId).hidden, v ? "1" : "0"); } catch { /* ignore */ }
    try { window.dispatchEvent(new Event("fx:tour-visibility-changed")); } catch { /* ignore */ }
    setTourHidden(v).catch(() => { /* best-effort DB sync */ });
  }

  function toggleStep(i: number) {
    persistDone(done.includes(i) ? done.filter((x) => x !== i) : [...done, i]);
  }

  if (!mounted) return null;
  if (hidden) return null;

  const completed = done.length;
  const nextIdx = STEPS.findIndex((_, i) => !done.includes(i));
  const allDone = completed === STEPS.length;
  const pct = Math.round((completed / STEPS.length) * 100);

  if (collapsed) {
    return (
      <div className="fixed bottom-24 right-4 z-40 flex items-center gap-1 rounded-full border border-gold-500/40 bg-surface-1 pr-1 shadow-lg">
        <button
          onClick={() => persistCollapsed(false)}
          className="flex items-center gap-2 rounded-full py-2 pl-3.5 pr-1 text-xs font-medium text-gold-300 transition hover:text-gold-200"
        >
          <span className="font-mono">◆ Setup guide</span>
          <span className="rounded-full bg-gold-500/15 px-1.5 py-0.5 font-mono text-[10px] text-gold-300">
            {completed}/{STEPS.length}
          </span>
        </button>
        <button
          onClick={() => persistHidden(true)}
          aria-label="Close — bring it back from Settings → Setup guide"
          title="Close — bring it back from Settings → Setup guide"
          className="flex h-6 w-6 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 z-40 w-[320px] rounded-xl border border-line bg-surface-1 shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            Setup guide
          </span>
          <span className="rounded-full bg-gold-500/15 px-1.5 py-0.5 font-mono text-[10px] text-gold-300">
            {pct}%
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {completed > 0 ? (
            <button
              onClick={() => persistDone([])}
              className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
            >
              Reset
            </button>
          ) : null}
          <button
            onClick={() => persistHidden(true)}
            title="Hide — bring it back from Settings → Setup guide"
            className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
          >
            Hide
          </button>
          <button
            onClick={() => persistCollapsed(true)}
            aria-label="Collapse setup guide"
            className="rounded p-0.5 text-fg-muted transition hover:text-fg-primary"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 w-full bg-surface-2">
        <div
          className="h-full bg-gold-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-2">
        {STEPS.map((step, i) => {
          const isDone = done.includes(i);
          const isNext = i === nextIdx;
          return (
            <div
              key={step.title}
              className={`rounded-lg p-2.5 transition ${isNext ? "bg-surface-2" : ""}`}
            >
              <div className="flex items-start gap-2.5">
                <button
                  onClick={() => toggleStep(i)}
                  aria-label={isDone ? "Mark incomplete" : "Mark complete"}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] transition ${
                    isDone
                      ? "border-status-success bg-status-success/20 text-status-success"
                      : "border-line text-transparent hover:border-gold-500/50"
                  }`}
                >
                  ✓
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${isDone ? "text-fg-muted line-through" : "text-fg-primary"}`}>
                    <span className="mr-1 font-mono text-[11px] text-gold-400">{i + 1}.</span>
                    {step.title}
                  </p>
                  {!isDone ? (
                    <>
                      <p className="mt-1 text-xs leading-snug text-fg-secondary">{step.body}</p>
                      <Link
                        href={step.href}
                        className="mt-2 inline-block rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
                      >
                        {step.cta} →
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {allDone ? (
          <p className="px-2.5 py-2 text-center text-xs text-status-success">
            🎉 Foundation complete — Earn is fully briefed and ready to work.
          </p>
        ) : null}
      </div>
    </div>
  );
}
