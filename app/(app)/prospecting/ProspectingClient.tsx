"use client";

import { useState } from "react";

// Mirrors the ProspectingPlan shape from lib/relationship/prospecting-copilot.
type ScoredProspect = {
  candidate: {
    name: string;
    title?: string | null;
    company?: string | null;
    location?: string | null;
    email?: string | null;
  };
  fit: number;
  priority: number;
  band: "high" | "medium" | "low";
  fitReasons: string[];
  eligibleForOutreach: boolean;
  holdReason?: string;
};

type Plan = {
  goal: { goal: string; persona: string; sequenceKey: string; agentKey: string };
  persona: string;
  prospects: ScoredProspect[];
  segments: { high: ScoredProspect[]; medium: ScoredProspect[]; low: ScoredProspect[] };
  readyForOutreach: ScoredProspect[];
  heldForReview: ScoredProspect[];
  routedAgent: string;
  sequenceKey: string;
  outreachAngle: string;
  nextActions: string[];
};

const EXAMPLES = [
  "Raise capital for Fund I",
  "Source acquisition targets in HVAC",
  "Find lenders for this deal",
  "Recruit operating partners",
];

function bandClass(band: string): string {
  if (band === "high") return "bg-gold-500/20 text-gold-300 border-gold-500/50";
  if (band === "medium") return "bg-surface-2 text-gold-400 border-line";
  return "bg-surface-2 text-ink-400 border-line/60";
}

function humanAgent(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line/60 bg-surface-1 px-4 py-3">
      <div className="text-2xl font-semibold text-gold-300">{value}</div>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
    </div>
  );
}

function ProspectRow({ p }: { p: ScoredProspect }) {
  const c = p.candidate;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/40 px-4 py-3 text-sm">
      <div className="min-w-[12rem] flex-1">
        <div className="font-medium text-surface-0">{c.name}</div>
        <div className="text-xs text-ink-400">
          {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
          {c.location ? ` · ${c.location}` : ""}
        </div>
      </div>
      <div className="w-16 text-center">
        <div className="text-xs text-ink-400">Fit</div>
        <div className="font-semibold text-surface-0">{p.fit}</div>
      </div>
      <div className="w-20 text-center">
        <div className="text-xs text-ink-400">Priority</div>
        <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${bandClass(p.band)}`}>
          {p.priority}
        </span>
      </div>
      <div className="w-40 text-right">
        {p.eligibleForOutreach ? (
          <span className="text-xs font-medium text-emerald-400">✓ Outreach-ready</span>
        ) : (
          <span className="text-xs text-amber-400" title={p.holdReason}>
            ⏳ {p.holdReason ?? "Held for review"}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ProspectingClient() {
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(g: string) {
    const target = g.trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const res = await fetch("/api/relationship/prospecting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setPlan((await res.json()) as Plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-surface-0">Prospecting</h1>
        <p className="text-sm text-ink-400">
          Tell Earn a goal. It sources, scores, and compliance-gates prospects, then routes an
          approval-ready outreach plan. Nothing is sent without your review.
        </p>
      </header>

      <div className="rounded-2xl border border-line/60 bg-surface-1 p-4 shadow-2xl">
        <div className="flex gap-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run(goal)}
            placeholder="e.g. Raise capital for Fund I"
            className="flex-1 rounded-xl border border-line bg-surface-0 px-4 py-2.5 text-sm text-surface-0 outline-none focus:border-gold-500/60"
          />
          <button
            onClick={() => run(goal)}
            disabled={loading || !goal.trim()}
            className="rounded-xl bg-gold-500 px-5 py-2.5 text-sm font-medium text-surface-0 disabled:opacity-50"
          >
            {loading ? "Building…" : "Build plan"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setGoal(ex);
                run(ex);
              }}
              className="rounded-full border border-line/60 bg-surface-2 px-3 py-1 text-xs text-ink-400 hover:text-gold-300"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {plan && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-line/60 bg-surface-1 p-4">
            <div className="text-xs uppercase tracking-wide text-ink-400">Target persona</div>
            <div className="mt-1 text-surface-0">{plan.persona}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2 py-1 text-gold-300">
                Routed to: {humanAgent(plan.routedAgent)}
              </span>
              <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-ink-400">
                Sequence: {plan.sequenceKey}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Prospects" value={plan.prospects.length} />
            <Tile label="High priority" value={plan.segments.high.length} />
            <Tile label="Outreach-ready" value={plan.readyForOutreach.length} />
            <Tile label="Held for review" value={plan.heldForReview.length} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-line/60 bg-surface-1">
            <div className="border-b border-line/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-400">
              Scored prospects
            </div>
            {plan.prospects.length === 0 ? (
              <div className="px-4 py-6 text-sm text-ink-400">
                No prospects surfaced. Set an Apollo key and mandate geographies, or refine the goal.
              </div>
            ) : (
              plan.prospects.map((p, i) => <ProspectRow key={p.candidate.email ?? p.candidate.name + i} p={p} />)
            )}
          </div>

          <div className="rounded-2xl border border-line/60 bg-surface-1 p-4">
            <div className="text-xs uppercase tracking-wide text-ink-400">Recommended next actions</div>
            <ul className="mt-2 space-y-1.5">
              {plan.nextActions.map((a, i) => (
                <li key={i} className="flex gap-2 text-sm text-surface-0">
                  <span className="text-gold-400">{i + 1}.</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line/40 pt-3 text-xs text-ink-400">{plan.outreachAngle}</div>
          </div>
        </div>
      )}
    </div>
  );
}
