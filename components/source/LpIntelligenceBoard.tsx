"use client";

// components/source/LpIntelligenceBoard.tsx
// The LP Intelligence board — a scored, tiered prioritization view over the
// firm's allocators. Complements the LP Pipeline CRM: where that lists and
// works LPs, this ranks them by fit against the current raise (mandate) with an
// explainable per-LP breakdown. Data is scored server-side by LpIntelligenceLive.
import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LpScoredFactor, LpTier } from "@/lib/lp-scoring";
import { updateLpSignals } from "@/components/source/lp-signal-actions";

export interface ScoredLp {
  id: string;
  name: string;
  investorType: string;
  aum: number | null;
  checkMin: number | null;
  checkMax: number | null;
  jurisdiction: string | null;
  // Enrichable scoring signals, editable inline from the score breakdown.
  sectors: string[];
  openToEmergingManagers: boolean | null;
  allocationSignal: string | null;
  committed: number;
  score: number;
  tier: LpTier;
  factors: LpScoredFactor[];
}

interface Props {
  lps: ScoredLp[];
  hasMandate: boolean;
  strategy: string | null;
}

const TIER_META: Record<LpTier, { label: string; badge: string; bar: string }> = {
  high: {
    label: "High fit",
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    bar: "bg-emerald-400",
  },
  medium: {
    label: "Medium fit",
    badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    bar: "bg-amber-400",
  },
  low: {
    label: "Low fit",
    badge: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200",
    bar: "bg-fg-muted/40",
  },
};

function formatUsd(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function humanizeType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function checkBand(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${formatUsd(min)}–${formatUsd(max)}`;
  return min != null ? `${formatUsd(min)}+` : `≤${formatUsd(max)}`;
}

const fieldClass =
  "w-full rounded border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-fg-primary placeholder:text-fg-muted/50 focus:border-gold-500/40 focus:outline-none";
const fieldLabel = "block font-mono text-[9px] uppercase tracking-widest text-fg-muted mb-0.5";

// Inline enrichment form shown inside the "why this score" detail. Editing any
// of these three signals re-scores the LP: sectors feed Sector alignment,
// openness feeds Emerging-manager openness, and the allocation note feeds
// Recent activity. Submits to the updateLpSignals server action, then refreshes.
function LpSignalEditor({ lp }: { lp: ScoredLp }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sectors, setSectors] = useState(lp.sectors.join(", "));
  const [openness, setOpenness] = useState(
    lp.openToEmergingManagers === true ? "yes" : lp.openToEmergingManagers === false ? "no" : "unknown",
  );
  const [allocation, setAllocation] = useState(lp.allocationSignal ?? "");

  function handleSave() {
    setError(null);
    const formData = new FormData();
    formData.set("id", lp.id);
    formData.set("sectors", sectors);
    formData.set("openToEmergingManagers", openness);
    formData.set("allocationSignal", allocation);
    start(async () => {
      const result = await updateLpSignals(formData);
      if (result.error) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-gold-500/20 bg-surface-2 p-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-gold-300">
        Enrich signals — sharpen this score
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_2fr]">
        <div>
          <label className={fieldLabel}>Sectors (comma-separated)</label>
          <input
            className={fieldClass}
            value={sectors}
            onChange={(e) => setSectors(e.target.value)}
            placeholder="SaaS, Fintech, Healthcare"
          />
        </div>
        <div>
          <label className={fieldLabel}>Open to emerging?</label>
          <select
            className={fieldClass}
            value={openness}
            onChange={(e) => setOpenness(e.target.value)}
          >
            <option value="unknown">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div>
          <label className={fieldLabel}>Allocation signal</label>
          <input
            className={fieldClass}
            value={allocation}
            onChange={(e) => setAllocation(e.target.value)}
            placeholder="Actively deploying 2026 vintage"
          />
        </div>
      </div>
      {error && (
        <p className="mt-2 font-mono text-[10px] text-red-400">{error}</p>
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded border border-gold-500/40 bg-gold-500/10 px-3 py-1 font-mono text-[9px] uppercase tracking-widest text-gold-300 hover:bg-gold-500/20 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save signals"}
        </button>
      </div>
    </div>
  );
}

function LpRow({ lp }: { lp: ScoredLp }) {
  const [open, setOpen] = useState(false);
  const meta = TIER_META[lp.tier];

  return (
    <>
      <tr
        tabIndex={0}
        role="button"
        aria-expanded={open}
        aria-label={`${lp.name} fit breakdown`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="cursor-pointer border-b border-line hover:bg-surface-2/40"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-fg-primary">{lp.name}</span>
            {lp.committed > 0 && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-emerald-300">
                Committed
              </span>
            )}
          </div>
          {lp.jurisdiction && (
            <p className="mt-0.5 text-xs text-fg-muted">{lp.jurisdiction}</p>
          )}
        </td>
        <td className="px-4 py-3 text-fg-muted">{humanizeType(lp.investorType)}</td>
        <td className="px-4 py-3 font-mono text-xs text-fg-secondary">
          {checkBand(lp.checkMin, lp.checkMax)}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-fg-secondary">{formatUsd(lp.aum)}</td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${meta.badge}`}>
            {lp.score}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${meta.badge}`}>
            {meta.label}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-surface-2/20">
          <td colSpan={6} className="px-4 py-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              Why this score
            </p>
            <div className="flex flex-col gap-2">
              {lp.factors.map((f) => {
                const max = f.weight * 100;
                const pct = max > 0 ? Math.round((f.contribution / max) * 100) : 0;
                return (
                  <div key={f.label} className="grid grid-cols-[140px_1fr] items-center gap-3">
                    <span className="text-xs text-fg-secondary">{f.label}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-gold-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-fg-muted">
                        {f.contribution.toFixed(0)}
                      </span>
                      <span className="hidden min-w-0 flex-[2] truncate text-[11px] text-fg-muted sm:block">
                        {f.note}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <LpSignalEditor lp={lp} />
          </td>
        </tr>
      )}
    </>
  );
}

export function LpIntelligenceBoard({ lps, hasMandate, strategy }: Props) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | LpTier>("all");

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const lp of lps) c[lp.tier]++;
    return c;
  }, [lps]);

  const filtered = useMemo(() => {
    let list = lps;
    if (tierFilter !== "all") list = list.filter((l) => l.tier === tierFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.investorType.toLowerCase().includes(q) ||
          l.jurisdiction?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [lps, tierFilter, search]);

  const tierChip = (key: "all" | LpTier, label: string) => (
    <button
      type="button"
      onClick={() => setTierFilter(key)}
      className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
        tierFilter === key
          ? "bg-gold-500 text-black"
          : "border border-line text-fg-muted hover:text-fg-primary"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          LP Intelligence
        </p>
        <p className="mt-1 text-sm text-fg-secondary">
          Your allocators, ranked by fit against{" "}
          {strategy ? (
            <span className="text-fg-primary">
              your {strategy.replace(/_/g, " ")} mandate
            </span>
          ) : (
            "your current raise"
          )}
          . Open any LP to see exactly why it scored the way it did.
        </p>
      </div>

      {!hasMandate && (
        <div className="rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-3">
          <p className="text-xs text-gold-300">
            Scoring is running on investor type alone. Set your strategy and an
            active thesis (check band + geographies) to sharpen every LP&rsquo;s
            fit score.{" "}
            <Link href="/build/thesis" className="font-semibold underline hover:no-underline">
              Set your thesis →
            </Link>
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search LPs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[160px] flex-1 rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/40 focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          {tierChip("all", `All ${lps.length}`)}
          {tierChip("high", `High ${counts.high}`)}
          {tierChip("medium", `Med ${counts.medium}`)}
          {tierChip("low", `Low ${counts.low}`)}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-fg-muted">
            {lps.length === 0
              ? "No LPs yet. Add allocators in the LP Pipeline to score them here."
              : "No LPs match your filters."}
          </p>
          {lps.length === 0 && (
            <Link
              href="/source/lp_pipeline"
              className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:text-gold-300"
            >
              Go to LP Pipeline →
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-subtle">
                {["LP", "Type", "Check Band", "AUM", "Score", "Tier"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((lp) => (
                <LpRow key={lp.id} lp={lp} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
