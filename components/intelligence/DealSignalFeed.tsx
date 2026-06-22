"use client";

// components/intelligence/DealSignalFeed.tsx
// Deal Intelligence Feed — CB Insights clone.
// Shows a chronological feed of deal signals with sector tags and thesis match badges.
import { useState } from "react";
import {
  SIGNAL_TYPE_LABELS,
  SIGNAL_TYPE_ICONS,
  SIGNAL_TYPE_COLORS,
  formatSignalSize,
  timeAgo,
} from "@/lib/deal-intelligence";
import type { DealSignal, SignalType } from "@/lib/deal-intelligence";

interface Props {
  signals: DealSignal[];
}

const THESIS_BADGE = (score: number) => {
  if (score >= 80) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (score >= 60) return "border-gold-500/40 bg-gold-500/10 text-gold-300";
  if (score >= 40) return "border-amber-500/30 bg-amber-500/8 text-amber-400";
  return "border-line bg-surface-2 text-fg-muted";
};

function SignalCard({ signal }: { signal: DealSignal }) {
  const typeColor = SIGNAL_TYPE_COLORS[signal.signalType];
  const icon = SIGNAL_TYPE_ICONS[signal.signalType];

  return (
    <div className={`flex gap-4 rounded-xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/20 ${!signal.readAt ? "border-l-2 border-l-gold-500/50" : ""}`}>
      {/* Icon */}
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${typeColor} bg-current/5 text-sm`}>
        {icon}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${typeColor}`}>
            {SIGNAL_TYPE_LABELS[signal.signalType]}
          </span>
          {signal.sector && (
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[9px] text-fg-muted">
              {signal.sector}
            </span>
          )}
          {signal.thesisMatchScore > 0 && (
            <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold ${THESIS_BADGE(signal.thesisMatchScore)}`}>
              {signal.thesisMatchScore}% thesis fit
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-fg-muted">{timeAgo(signal.publishedAt)}</span>
        </div>

        <p className="mt-2 text-sm font-medium leading-snug text-fg-primary">{signal.title}</p>
        {signal.summary && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-secondary">{signal.summary}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-3">
          {signal.companyName && (
            <span className="font-mono text-[10px] text-fg-muted">{signal.companyName}</span>
          )}
          {(signal.dealSizeMin || signal.dealSizeMax) && (
            <span className="font-mono text-[10px] text-gold-400">
              {formatSignalSize(signal.dealSizeMin, signal.dealSizeMax)}
            </span>
          )}
          {signal.geography && (
            <span className="font-mono text-[10px] text-fg-muted">{signal.geography}</span>
          )}
          {signal.sourceUrl && (
            <a
              href={signal.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto font-mono text-[10px] text-gold-400/70 transition hover:text-gold-400"
            >
              View source →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function DealSignalFeed({ signals }: Props) {
  const [filter, setFilter] = useState<SignalType | "all">("all");
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  const filtered = signals.filter((s) => {
    if (filter !== "all" && s.signalType !== filter) return false;
    if (showSavedOnly && !s.savedAt) return false;
    return true;
  });

  // Get unique signal types present in the feed
  const presentTypes = Array.from(new Set(signals.map((s) => s.signalType)));

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition ${filter === "all" ? "border-gold-500/40 bg-gold-500/10 text-gold-300" : "border-line bg-surface-1 text-fg-muted hover:border-gold-500/20"}`}
        >
          All
        </button>
        {presentTypes.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setFilter(type)}
            className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition ${filter === type ? `${SIGNAL_TYPE_COLORS[type]} bg-current/5` : "border-line bg-surface-1 text-fg-muted hover:border-gold-500/20"}`}
          >
            {SIGNAL_TYPE_ICONS[type]} {SIGNAL_TYPE_LABELS[type]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowSavedOnly((p) => !p)}
          className={`ml-auto rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition ${showSavedOnly ? "border-gold-500/40 bg-gold-500/10 text-gold-300" : "border-line text-fg-muted hover:border-gold-500/20"}`}
        >
          Saved
        </button>
      </div>

      {/* Feed */}
      <div className="flex flex-col gap-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-surface-1/50 p-8 text-center">
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">No signals match your filters</p>
          </div>
        ) : (
          filtered.map((signal) => <SignalCard key={signal.id} signal={signal} />)
        )}
      </div>

      <p className="text-center font-mono text-[10px] text-fg-muted">
        {filtered.length} signal{filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
