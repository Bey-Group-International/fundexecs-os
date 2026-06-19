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
      <div className="rounded-xl border border-line bg-surface-1 p-10 text-center">
        <p className="text-sm text-fg-muted">
          No investors yet. Add LPs in Source › LP Pipeline — or ask Earn to build
          a target list — and they appear here scored and mapped.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <GateLegend />
      {entries.map((entry) => (
        <InvestorCard key={entry.investor.id} entry={entry} />
      ))}
    </div>
  );
}

function GateLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-line bg-surface-1 px-4 py-2.5">
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

function InvestorCard({ entry }: { entry: CapitalMapEntry }) {
  const { investor, temperature, thesisFit, introPath, nextActions, committedAmount } = entry;
  const temp = TEMP_STYLE[temperature];
  const [result, setResult] = useState<QueueActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: temp.dot }}
              title={temp.label}
            />
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
          <div className="text-right">
            <div className="font-display text-xl font-semibold text-fg-primary">
              {thesisFit.score}
              <span className="text-sm text-fg-muted">/100</span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              Thesis fit
            </div>
          </div>
        ) : null}
      </div>

      {thesisFit && thesisFit.reasons.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {thesisFit.reasons.map((r, i) => (
            <li
              key={i}
              className="rounded-md border border-line bg-surface-0 px-2 py-0.5 text-xs text-fg-secondary"
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
        {nextActions.map((na) => (
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
            className="group inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-0 px-3 py-1.5 text-sm text-fg-primary transition hover:border-gold-500 disabled:opacity-50"
          >
            <span
              className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[na.tier]}`}
            >
              T{na.tier}
            </span>
            {na.label}
          </button>
        ))}
      </div>

      {result && activeAction ? (
        <p
          className={`mt-2.5 text-xs ${
            result.ok ? "text-fg-secondary" : "text-status-danger"
          }`}
        >
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
    </div>
  );
}
