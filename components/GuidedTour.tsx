"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// A self-guided demo walkthrough. Floats bottom-right on every authed page so a
// tester always knows the next thing to do. Progress + collapsed state persist
// in localStorage, so it survives navigation and can be resumed or reset.

interface TourStep {
  title: string;
  body: string;
  href: string;
  cta: string;
}

const STEPS: TourStep[] = [
  {
    title: "Load demo data",
    body: "On the Command Center, click “Load demo data” to populate deals, assets, and deliverables instantly.",
    href: "/dashboard",
    cta: "Open Command Center",
  },
  {
    title: "Give Earn a prompt",
    body: "Open Earn and type, e.g. “Source multifamily targets in Texas under $50M.” The Associate plans it into steps.",
    href: "/workspace",
    cta: "Open Earn",
  },
  {
    title: "Approve & automate",
    body: "Review the plan, then Approve & automate. The agents execute each step and stream real deliverables.",
    href: "/workspace",
    cta: "Go to Earn",
  },
  {
    title: "Create an automation",
    body: "In Automations, save “Every Monday, summarize what moved in our pipeline” and hit Run now to see it work.",
    href: "/automations",
    cta: "Open Automations",
  },
  {
    title: "See it in the Command Center",
    body: "Deals, assets, and the latest deliverables now populate the Command Center — the system of record for the work.",
    href: "/dashboard",
    cta: "Back to Command Center",
  },
];

const DONE_KEY = "fx_tour_done_v1";
const COLLAPSED_KEY = "fx_tour_collapsed_v1";

export function GuidedTour() {
  const [mounted, setMounted] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const d = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
      if (Array.isArray(d)) setDone(d);
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // ignore malformed storage
    }
  }, []);

  function persistDone(next: number[]) {
    setDone(next);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function persistCollapsed(v: boolean) {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
    } catch {
      // ignore
    }
  }

  function toggleStep(i: number) {
    persistDone(done.includes(i) ? done.filter((x) => x !== i) : [...done, i]);
  }

  // Avoid hydration mismatch — render nothing until we've read localStorage.
  if (!mounted) return null;

  const completed = done.length;
  const nextIdx = STEPS.findIndex((_, i) => !done.includes(i));

  if (collapsed) {
    return (
      <button
        onClick={() => persistCollapsed(false)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-gold-500/40 bg-surface-1 px-3.5 py-2 text-xs font-medium text-gold-300 shadow-lg transition hover:bg-surface-2"
      >
        <span className="font-mono">◆ Guided tour</span>
        <span className="rounded-full bg-gold-500/15 px-1.5 py-0.5 font-mono text-[10px] text-gold-300">
          {completed}/{STEPS.length}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[320px] rounded-xl border border-line bg-surface-1 shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            Guided tour
          </span>
          <span className="rounded-full bg-gold-500/15 px-1.5 py-0.5 font-mono text-[10px] text-gold-300">
            {completed}/{STEPS.length}
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
            onClick={() => persistCollapsed(true)}
            aria-label="Collapse tour"
            className="rounded p-0.5 text-fg-muted transition hover:text-fg-primary"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-2">
        {STEPS.map((step, i) => {
          const isDone = done.includes(i);
          const isNext = i === nextIdx;
          return (
            <div
              key={step.title}
              className={`rounded-lg p-2.5 transition ${
                isNext ? "bg-surface-2" : ""
              }`}
            >
              <div className="flex items-start gap-2.5">
                <button
                  onClick={() => toggleStep(i)}
                  aria-label={isDone ? "Mark step incomplete" : "Mark step complete"}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] transition ${
                    isDone
                      ? "border-emerald-400 bg-emerald-400/20 text-emerald-300"
                      : "border-line text-transparent hover:border-gold-500/50"
                  }`}
                >
                  ✓
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${
                      isDone ? "text-fg-muted line-through" : "text-fg-primary"
                    }`}
                  >
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

        {completed === STEPS.length ? (
          <p className="px-2.5 py-2 text-center text-xs text-emerald-300">
            🎉 That&rsquo;s the full loop — you&rsquo;ve seen FundExecs OS end to end.
          </p>
        ) : null}
      </div>
    </div>
  );
}
