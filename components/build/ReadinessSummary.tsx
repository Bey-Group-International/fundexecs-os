"use client";
// The Build hub's Investor Readiness, as one calm card in the page flow.
//
// It used to be a ~380px panel fixed to the bottom-right corner of every Build
// page: it sat on top of the content, and on a phone it covered most of the
// screen and shared a corner with the Ask Earn button. Now the card is always
// visible as a single summary row (score, stage, the next step) and the full
// breakdown opens in place on request. The open/closed choice is remembered, and
// "i" still toggles it from the keyboard.

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { BuildReadiness } from "@/lib/build-readiness";

const STORAGE_KEY = "build-readiness-expanded";

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0");
  } catch {
    // Private mode / storage disabled: it just won't be remembered.
  }
}

export function ReadinessSummary({
  readiness,
  children,
}: {
  readiness: BuildReadiness;
  /** The full breakdown, shown when the card is opened. */
  children: ReactNode;
}) {
  const { overall, stage, nextAction } = readiness;
  // Closed on the server and on first paint (keeps hydration stable); the effect
  // restores the saved choice.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(readExpanded());
  }, []);

  const toggle = useCallback(() => {
    setExpanded((v) => {
      writeExpanded(!v);
      return !v;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "i" && e.key !== "I") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <section aria-label="Investor readiness" data-testid="readiness-summary" className="mb-5 rounded-2xl border border-line bg-surface-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-gold-400/60 font-display text-sm font-semibold text-fg-primary"
        >
          {overall}%
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-sm font-medium text-fg-primary">
            Investor readiness: {overall}% <span className="text-fg-muted">· {stage.label}</span>
          </p>
          {nextAction ? (
            <p className="truncate text-xs text-fg-secondary" title={nextAction.label}>
              Next: {nextAction.label}
            </p>
          ) : (
            <p className="text-xs text-fg-secondary">Foundation complete.</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {nextAction ? (
            <Link href={nextAction.href} className="fx-action-link">
              Do next step →
            </Link>
          ) : null}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls="readiness-details"
            title="Show or hide details (press i)"
            className="fx-action-link"
          >
            {expanded ? "Hide details" : "Details"}
          </button>
        </div>
      </div>
      {expanded ? (
        <div id="readiness-details" className="border-t border-line px-4 py-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
