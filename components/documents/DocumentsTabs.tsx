"use client";

// Documents holds two genuinely different things and keeps them legible rather
// than merging them: the Library is the firm's own material (`documents` —
// memos, decks, DDQs, filings), while Agreements is contract paper (`contracts`)
// with counterparties, signature state, and expiry. Both are documents; only one
// of them has a countersignature.
import { useState, type ReactNode } from "react";

type Tab = "library" | "agreements";

export function DocumentsTabs({
  library,
  agreements,
}: {
  library: ReactNode;
  agreements: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("library");

  const btn = (t: Tab, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      title={hint}
      aria-current={tab === t}
      className={`rounded-lg px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition ${
        tab === t
          ? "bg-gold-400 text-on-gold"
          : "border border-line text-fg-secondary hover:text-fg-primary"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        {btn("library", "Library", "Everything your firm holds and creates")}
        {btn("agreements", "Agreements", "Contract paper: subscriptions, side letters, NDAs")}
      </div>

      {/* Both panes stay mounted so switching tabs keeps scroll and open rows. */}
      <div hidden={tab !== "library"}>{library}</div>
      <div hidden={tab !== "agreements"}>{agreements}</div>
    </div>
  );
}
