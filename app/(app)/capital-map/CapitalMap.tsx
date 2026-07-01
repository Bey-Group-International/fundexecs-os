"use client";

import { useMemo, useState, useTransition } from "react";
import type { CapitalMapEntry, Temperature } from "@/lib/capital-map";
import type { ListingMatch } from "@/lib/matching";
import type { GateTier } from "@/lib/gates";
import { TIER_LABEL } from "@/lib/gates";
import { queueNextAction, type QueueActionResult } from "./actions";
import { RecordLifecycleActions } from "@/components/RecordLifecycleActions";

const TEMP_STYLE: Record<Temperature, { dot: string; label: string }> = {
  cold: { dot: "#6b7280", label: "Cold" },
  warm: { dot: "#e8a33d", label: "Warm" },
  active: { dot: "#5b9bd5", label: "Active" },
  committed: { dot: "#67c587", label: "Committed" },
};

const TEMP_ORDER: Temperature[] = ["committed", "active", "warm", "cold"];

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

type SortKey = "warmth" | "fit" | "committed" | "name";

export function CapitalMap({
  entries,
  matchesByInvestor = {},
}: {
  entries: CapitalMapEntry[];
  matchesByInvestor?: Record<string, ListingMatch[]>;
}) {
  const [query, setQuery] = useState("");
  const [temps, setTemps] = useState<Set<Temperature>>(new Set());
  const [sort, setSort] = useState<SortKey>("warmth");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = entries.filter((e) => {
      if (temps.size && !temps.has(e.temperature)) return false;
      if (!q) return true;
      return (
        e.investor.name.toLowerCase().includes(q) ||
        (e.investor.jurisdiction ?? "").toLowerCase().includes(q) ||
        e.investor.investor_type.toLowerCase().includes(q)
      );
    });
    rows = [...rows].sort((a, b) => {
      switch (sort) {
        case "fit":
          return (b.thesisFit?.score ?? 0) - (a.thesisFit?.score ?? 0);
        case "committed":
          return b.committedAmount - a.committedAmount;
        case "name":
          return a.investor.name.localeCompare(b.investor.name);
        case "warmth":
        default:
          return b.warmth - a.warmth;
      }
    });
    return rows;
  }, [entries, query, temps, sort]);

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

  function toggleTemp(t: Temperature) {
    setTemps((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <SummaryRow entries={entries} />
      <CoverageCallout entries={entries} />
      <GateLegend />
      <ControlsBar
        query={query}
        setQuery={setQuery}
        temps={temps}
        toggleTemp={toggleTemp}
        sort={sort}
        setSort={setSort}
        onClearAll={() => { setQuery(""); setTemps(new Set()); setSort("warmth"); }}
        showing={visible.length}
        total={entries.length}
      />
      {visible.length === 0 ? (
        <div className="fx-card p-8 text-center text-sm text-fg-muted">
          No investors match these filters.
        </div>
      ) : (
        visible.map((entry, i) => (
          <InvestorCard
            key={entry.investor.id}
            entry={entry}
            index={i}
            matches={matchesByInvestor[entry.investor.id] ?? []}
          />
        ))
      )}
    </div>
  );
}

// At-a-glance portfolio read plus a temperature funnel so the operator can see
// the shape of the book, not just its size.
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

  const counts = TEMP_ORDER.map((t) => ({
    temp: t,
    n: entries.filter((e) => e.temperature === t).length,
  })).filter((c) => c.n > 0);

  return (
    <div className="flex flex-col gap-2">
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
      {/* Temperature funnel — proportional bar across the pipeline. */}
      <div className="flex h-2 w-full animate-fade-up overflow-hidden rounded-full border border-line/60 bg-surface-0">
        {counts.map((c) => (
          <span
            key={c.temp}
            title={`${TEMP_STYLE[c.temp].label}: ${c.n}`}
            style={{ width: `${(c.n / entries.length) * 100}%`, backgroundColor: TEMP_STYLE[c.temp].dot }}
          />
        ))}
      </div>
    </div>
  );
}

// "Work next" prompt: high-fit investors with no mapped warm path are the
// clearest gap — strong fit, no way in yet.
function CoverageCallout({ entries }: { entries: CapitalMapEntry[] }) {
  const gaps = entries.filter((e) => (e.thesisFit?.score ?? 0) >= 70 && !e.introPath);
  if (!gaps.length) return null;
  const names = gaps.slice(0, 3).map((e) => e.investor.name).join(", ");
  return (
    <div className="animate-fade-up rounded-xl border border-gold-500/30 bg-gold-500/[0.06] px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">Coverage gap</p>
      <p className="mt-0.5 text-sm text-fg-secondary">
        <span className="font-medium text-fg-primary">{gaps.length}</span> high-fit{" "}
        {gaps.length === 1 ? "investor has" : "investors have"} no warm path yet — {names}
        {gaps.length > 3 ? `, +${gaps.length - 3} more` : ""}. Build the relationship graph or
        research a route in.
      </p>
    </div>
  );
}

function ControlsBar({
  query,
  setQuery,
  temps,
  toggleTemp,
  sort,
  setSort,
  onClearAll,
  showing,
  total,
}: {
  query: string;
  setQuery: (s: string) => void;
  temps: Set<Temperature>;
  toggleTemp: (t: Temperature) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  onClearAll: () => void;
  showing: number;
  total: number;
}) {
  const isDirty = query !== "" || temps.size > 0 || sort !== "warmth";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search investors…"
        className="min-w-[160px] flex-1 rounded-lg border border-line bg-surface-0 px-3 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
      />
      <div className="flex items-center gap-1">
        {TEMP_ORDER.map((t) => {
          const on = temps.has(t);
          return (
            <button
              key={t}
              onClick={() => toggleTemp(t)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                on ? "border-gold-500/60 bg-gold-500/10 text-fg-primary" : "border-line text-fg-muted hover:text-fg-secondary"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TEMP_STYLE[t].dot }} />
              {TEMP_STYLE[t].label}
            </button>
          );
        })}
      </div>
      {isDirty && (
        <button
          onClick={onClearAll}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-muted transition hover:border-gold-500/40 hover:text-fg-primary"
        >
          Clear all
        </button>
      )}
      <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-muted">
        <span className="font-mono uppercase tracking-wider">Sort</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-md border border-line bg-surface-0 px-2 py-1 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
        >
          <option value="warmth">Warmth</option>
          <option value="fit">Thesis fit</option>
          <option value="committed">Committed</option>
          <option value="name">Name</option>
        </select>
        <span className="hidden font-mono text-[10px] sm:inline">
          {showing}/{total}
        </span>
      </label>
    </div>
  );
}

function GateLegend() {
  return (
    <div className="fx-glass flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Gate</span>
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

// A deterministic, mock-safe first-touch draft built from what the map already
// knows — name, type, the strongest thesis-fit reason, and the best-matched live
// listing. Gives the operator something to react to instantly, no API key needed.
function outreachDraft(entry: CapitalMapEntry, top?: ListingMatch): string {
  const { investor } = entry;
  const first = investor.contact_name?.trim().split(/\s+/)[0] || investor.name;
  const reason = entry.thesisFit?.reasons[0]?.replace(/\.$/, "").toLowerCase();
  const opener =
    entry.temperature === "committed"
      ? `Wanted to share where things stand and keep you close to the next milestones.`
      : entry.temperature === "active"
        ? `Following up on our conversation — I think the timing lines up well on your end.`
        : `I've been building a focused view of allocators we'd most want alongside us, and you came to the top.`;
  const fitLine = reason ? ` Your mandate stands out because ${reason}.` : "";
  const listingLine = top
    ? ` Specifically, we've just opened ${top.listing.title}${
        top.listing.amount ? ` (${usd.format(top.listing.amount)})` : ""
      }, which looks like a clean fit for your book.`
    : "";
  return `Hi ${first},\n\n${opener}${fitLine}${listingLine}\n\nWould a short call next week be worth it? Happy to send a one-pager ahead of time.\n\nBest,`;
}

function InvestorCard({
  entry,
  index,
  matches,
}: {
  entry: CapitalMapEntry;
  index: number;
  matches: ListingMatch[];
}) {
  const { investor, temperature, thesisFit, introPath, nextActions, committedAmount } = entry;
  const temp = TEMP_STYLE[temperature];
  const [result, setResult] = useState<QueueActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const topMatch = matches[0];

  return (
    <div
      className="fx-card fx-card-hover relative animate-fade-up overflow-hidden p-5"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
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
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: temp.dot }} />
            </span>
            <h3 className="truncate font-display text-lg font-medium text-fg-primary">{investor.name}</h3>
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
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Thesis fit</div>
            </div>
          </div>
        ) : null}
      </div>

      {thesisFit && thesisFit.reasons.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {thesisFit.reasons.map((r, i) => (
            <li key={i} className="rounded-md border border-line bg-surface-0/80 px-2 py-0.5 text-xs text-fg-secondary">
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      {introPath ? (
        <p className="mt-3 text-sm text-fg-secondary">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">Warm path</span>{" "}
          {introPath.hops.join("  →  ")}
          {introPath.introducer !== "You" ? (
            <span className="text-fg-muted"> · {introPath.introducer} can introduce you</span>
          ) : null}
        </p>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Warm path</span>{" "}
          No mapped connection yet — cold outreach or build the relationship graph.
        </p>
      )}

      {/* Matched live listings — the marketplace flywheel surfaced inline. */}
      {matches.length ? (
        <div className="mt-3 rounded-lg border border-gold-500/25 bg-gold-500/[0.05] px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
            Fits {matches.length} live {matches.length === 1 ? "listing" : "listings"}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {matches.map((m) => (
              <li key={m.listing.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-fg-primary">{m.listing.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-gold-300">{m.score} fit</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
              <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[na.tier]}`}>
                T{na.tier}
              </span>
              {isPending ? "Queuing…" : na.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowDraft((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line/70 px-3 py-1.5 text-sm text-fg-muted transition hover:border-gold-500/40 hover:text-fg-secondary"
        >
          {showDraft ? "Hide draft" : "Preview outreach"}
        </button>
        <RecordLifecycleActions
          hub="capital-map"
          module=""
          table="investors"
          id={investor.id}
          className="ml-auto"
          deleteClassName=""
        />
      </div>

      {showDraft ? (
        <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-surface-0 px-3 py-2.5 font-sans text-sm leading-relaxed text-fg-secondary">
          {outreachDraft(entry, topMatch)}
        </pre>
      ) : null}

      {result && activeAction ? (
        <p className={`mt-2.5 text-xs ${result.ok ? "text-status-success" : "text-status-danger"}`}>
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
    </div>
  );
}

// Compact radial gauge for thesis fit — fills with the score and shifts
// cold→gold→green as fit climbs.
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
