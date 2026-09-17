"use client";

// Documents holds three genuinely different things and keeps them legible
// rather than merging them:
//
//   Library    — the firm's own material (`documents`): memos, decks, DDQs,
//                filings. What you hold.
//   Create     — the ways a document comes into being: templates, drafting from
//                firm data, a blank page. What you make.
//   Agreements — contract paper (`contracts`) with counterparties, signature
//                state and expiry. What you have signed.
//
// All three are documents; only one of them has a countersignature, and only
// one of them is a starting point rather than a record. Library and Agreements
// used to sit alone, which read as a single odd distinction — the pair only
// makes sense once the third thing it was implicitly missing is present.
import { useState, type ReactNode } from "react";

type Tab = "library" | "create" | "agreements";

export function DocumentsTabs({
  library,
  create,
  agreements,
}: {
  library: ReactNode;
  create: ReactNode;
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
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {btn("library", "Library", "Everything your firm holds — uploaded, linked, or written")}
        {btn("create", "Create", "Start a document: templates, drafting from your firm data, or blank")}
        {btn("agreements", "Agreements", "Contract paper: subscriptions, side letters, NDAs")}
      </div>

      {/* All three panes stay mounted so switching tabs keeps scroll, open rows,
          and a half-filled form. */}
      <div hidden={tab !== "library"}>{library}</div>
      <div hidden={tab !== "create"}>{create}</div>
      <div hidden={tab !== "agreements"}>{agreements}</div>
    </div>
  );
}
