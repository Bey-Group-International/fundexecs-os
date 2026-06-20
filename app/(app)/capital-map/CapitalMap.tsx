"use client";

import { useState, useTransition } from "react";
import type { CapitalMapEntry, Temperature } from "@/lib/capital-map";
import type { GateTier } from "@/lib/gates";
import { TIER_LABEL } from "@/lib/gates";
import { queueNextAction, type QueueActionResult } from "./actions";

const TEMP_STYLE: Record<Temperature, { dot: string; label: string }> = {
  cold: { dot: "#6b7280", label: "Cold" },
  warm: { dot: "#e8a33d", label: "Warm" },
  active: { dot: "#5b9bd5", label: "Active" },
  committed: { dot: "#67c587", label: "Committed" },
};

// Tier → badge color. Mirrors the gate semantics: green = free, gold = sign-off,
// red = never delegable.
const TIER_STYLE: Record<GateTier, string> = {
  1: "border-status-success/40 text-status-success",
  2: "border-gold-500/50 text-gold-400",
  3: "border-status-danger/50 text-status-danger",
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  notation: "compact",
});

export function CapitalMap({ entries }: { entries: CapitalMapEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="fx-card animate-fade-up p-10 text-center">
        <p className="text-sm text-fg-muted">
          No investors yet. Add LPs in Source › LP Pipeline — or ask Earn to build
          a target list — and they appear here scored and mapped.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SummaryRow entries={entries} />
      <GateLegend />
      {entries.map((entry, i) => (
        <InvestorCard key={entry.investor.id} entry={entry} index={i} />
      ))}
    </div>
  );
}

// At-a-glance portfolio read: how many investors, dollars committed, how much of
// the book has a mapped warm path, and the average thesis fit across the scored.
function SummaryRow({ entries }: { entries: CapitalMapEntry[] }) {
  const committed = entries.reduce((sum, e) => sum + (e.committedAmount || 0), 0);
  const warmPaths = entries.filter((e) => e.introPath).length;
  const scored = entries.filter((e) => e.thesisFit);
  const avgFit = scored.length
    ? Math.round(scored.reduce((s, e) => s + (e.thesisFit?.score ?? 0), 0) / scored.length)
    : null;

  const stats: { label: string; value: string; accent?: string }[] = [
    { label: "Investors", value: String(entries.length) },
    { label: "Committed", value: committed > 0 ? usd.format(committed) : "—", accent: "text-status-success" },
    { label: "Warm paths", value: `${warmPaths}/${entries.length}`, accent: "text-gold-400" },
    { label: "Avg thesis fit", value: avgFit != null ? `${avgFit}` : "—" },
  ];

  return (
    <div className="grid animate-fade-up grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="fx-stat">
          <div className={`font-display text-2xl font-semibold tracking-tight ${s.accent ?? "text-fg-primary"}`}>
            {s.value}
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function GateLegend() {
  return (
    <div className="fx-glass flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
        Gate
      </span>
      {([1, 2, 3] as GateTier[]).map((tier) => (
        <span key={tier} className="flex items-center gap-1.5">
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[tier]}`}
          >
            T{tier}
          </span>
          <span className="text-xs text-fg-secondary">{TIER_LABEL[tier]}</span>
        </span>
      ))}
      <span className="ml-auto text-xs text-fg-muted">
        T1 runs free · T2 needs sign-off · T3 always you
      </span>
    </div>
  );
}

function InvestorCard({ entry, index }: { entry: CapitalMapEntry; index: number }) {
  const { investor, temperature, thesisFit, introPath, nextActions, committedAmount } = entry;
  const temp = TEMP_STYLE[temperature];
  const [result, setResult] = useState<QueueActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);

  return (
    <div
      className="fx-card fx-card-hover relative animate-fade-up overflow-hidden p-5"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      {/* Temperature accent rail along the left edge. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: `linear-gradient(to bottom, ${temp.dot}, transparent)` }}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0" title={temp.label}>
              <span
                className="absolute inline-flex h-full w-full animate-glow rounded-full opacity-60"
                style={{ backgroundColor: temp.dot }}
              />
              <span
                className="relative inline-flex h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: temp.dot }}
              />
            </span>
            <h3 className="truncate font-display text-lg font-medium text-fg-primary">
              {investor.name}
            </h3>
          </div>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {temp.label}
            {investor.jurisdiction ? ` · ${investor.jurisdiction}` : ""}
            {committedAmount > 0 ? ` · ${usd.format(committedAmount)} committed` : ""}
          </p>
        </div>

        {thesisFit ? (
          <div className="flex items-center gap-3">
            <FitMeter score={thesisFit.score} />
            <div className="text-right">
              <div className="font-display text-xl font-semibold text-fg-primary">
                {thesisFit.score}
                <span className="text-sm text-fg-muted">/100</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Thesis fit
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {thesisFit && thesisFit.reasons.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {thesisFit.reasons.map((r, i) => (
            <li
              key={i}
              className="rounded-md border border-line bg-surface-0/80 px-2 py-0.5 text-xs text-fg-secondary"
            >
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      {introPath ? (
        <p className="mt-3 text-sm text-fg-secondary">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
            Warm path
          </span>{" "}
          {introPath.hops.join("  →  ")}
          {introPath.introducer !== "You" ? (
            <span className="text-fg-muted"> · {introPath.introducer} can introduce you</span>
          ) : null}
        </p>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Warm path
          </span>{" "}
          No mapped connection yet — cold outreach or build the relationship graph.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {nextActions.map((na) => {
          const isPending = pending && activeAction === na.action;
          return (
            <button
              key={na.action}
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setActiveAction(na.action);
                  const res = await queueNextAction(investor.id, na.action, na.label);
                  setResult(res);
                })
              }
              title={na.rationale}
              className="group inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-0/80 px-3 py-1.5 text-sm text-fg-primary transition hover:-translate-y-px hover:border-gold-500 hover:bg-surface-0 disabled:opacity-50"
            >
              <span
                className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[na.tier]}`}
              >
                T{na.tier}
              </span>
              {isPending ? "Queuing…" : na.label}
            </button>
          );
        })}
      </div>

      {result && activeAction ? (
        <p
          className={`mt-2.5 text-xs ${
            result.ok ? "text-status-success" : "text-status-danger"
          }`}
        >
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
    </div>
  );
}

// Compact radial gauge for thesis fit — a single SVG ring that fills with the
// score and shifts cold→gold→warm as fit climbs. Reads at a glance next to the
// numeric score.
function FitMeter({ score }: { score: number }) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 70 ? "#67c587" : score >= 40 ? "#D4AF6A" : "#7E7869";
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0 -rotate-90">
      <circle cx="20" cy="20" r={r} fill="none" stroke="#2C2820" strokeWidth="3" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct)}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}
