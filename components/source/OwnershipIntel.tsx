"use client";

import { useEffect, useRef, useState } from "react";
import {
  buyersForTarget,
  addOnsForPlatform,
  acquisitionHistory,
} from "@/app/(app)/[hub]/[module]/ownership-intel-actions";
import type { BuyerCandidate, AddOnResult, RankedBuyer, AcquisitionSummary } from "@/lib/ownership-intel";
import type { Acquisition } from "@/lib/supabase/database.types";

type Tab = "buyers" | "addons" | "history";
type Phase = "idle" | "working" | "done";

function scoreTone(score: number): string {
  if (score >= 70) return "text-status-success";
  if (score >= 45) return "text-gold-300";
  return "text-fg-muted";
}
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function compactUsd(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

const BUYER_EXAMPLES = [
  "Founder-owned industrial services firm, Southeast US",
  "Regional HVAC distributor",
  "Vertical SaaS for dental practices",
];

// Ownership & Buyer Intelligence — the "Buyers & Ownership" workspace. Three
// lenses on the M&A side of the market, all Claude-optional (deterministic
// fallback with no key):
//   • Buyers   — enter a target → ranked likely buyers with fit + rationale.
//   • Add-ons  — enter a platform → bolt-on candidates that consolidate/expand.
//   • History  — the org's acquisition history with summarized headline facts.
export function OwnershipIntel({ live, initialPrompt }: { live: boolean; initialPrompt?: string }) {
  const [tab, setTab] = useState<Tab>("buyers");
  const [name, setName] = useState(initialPrompt ?? "");
  const [sector, setSector] = useState("");
  const [geography, setGeography] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BuyerCandidate[]>([]);
  const [onFile, setOnFile] = useState<RankedBuyer[]>([]);
  const [saved, setSaved] = useState(0);

  const [platform, setPlatform] = useState<string | null>(null);
  const [addOns, setAddOns] = useState<AddOnResult[]>([]);

  const [history, setHistory] = useState<Acquisition[]>([]);
  const [summary, setSummary] = useState<AcquisitionSummary | null>(null);
  const ranInitial = useRef(false);

  const busy = phase === "working";

  async function runBuyers(q: string) {
    const clean = q.trim();
    if (!clean || busy) return;
    setError(null);
    setPhase("working");
    try {
      const res = await buyersForTarget({
        targetName: clean,
        sector: sector.trim() || null,
        geography: geography.trim() || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not map buyers.");
        setPhase("idle");
        return;
      }
      setTarget(res.target ?? clean);
      setCandidates(res.candidates ?? []);
      setOnFile(res.onFile ?? []);
      setSaved(res.saved ?? 0);
      setPhase("done");
    } catch {
      setError("Could not map buyers.");
      setPhase("idle");
    }
  }

  async function runAddOns(q: string) {
    const clean = q.trim();
    if (!clean || busy) return;
    setError(null);
    setPhase("working");
    try {
      const res = await addOnsForPlatform({
        platformName: clean,
        sector: sector.trim() || null,
        geography: geography.trim() || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not find add-ons.");
        setPhase("idle");
        return;
      }
      setPlatform(res.platform ?? clean);
      setAddOns(res.addOns ?? []);
      setPhase("done");
    } catch {
      setError("Could not find add-ons.");
      setPhase("idle");
    }
  }

  async function runHistory(q: string) {
    if (busy) return;
    setError(null);
    setPhase("working");
    try {
      const res = await acquisitionHistory({ name: q.trim() || null });
      if (!res.ok) {
        setError(res.error ?? "Could not load history.");
        setPhase("idle");
        return;
      }
      setHistory(res.rows ?? []);
      setSummary(res.summary ?? null);
      setPhase("done");
    } catch {
      setError("Could not load history.");
      setPhase("idle");
    }
  }

  function run(q: string) {
    if (tab === "buyers") return runBuyers(q);
    if (tab === "addons") return runAddOns(q);
    return runHistory(q);
  }

  useEffect(() => {
    if (initialPrompt && !ranInitial.current) {
      ranInitial.current = true;
      runBuyers(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const TABS: { key: Tab; label: string }[] = [
    { key: "buyers", label: "Likely buyers" },
    { key: "addons", label: "Add-ons" },
    { key: "history", label: "Acquisition history" },
  ];

  function buyerCard(name: string, score: number, type: string | null | undefined, body: string, key: string, onFile?: boolean) {
    return (
      <div key={key} className="rounded-2xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/40">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-fg-primary">{name}</span>
          <span className={`ml-auto shrink-0 font-mono text-xs ${scoreTone(score)}`}>{score}%</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          {type ? <span className="rounded-full border border-line px-1.5 py-0.5">{humanize(type)}</span> : null}
          {onFile ? <span className="text-status-info">on file</span> : null}
        </div>
        {body ? <p className="mt-1.5 text-xs text-fg-secondary">{body}</p> : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Buyers &amp; Ownership
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              local mode
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Map likely buyers for a target, find bolt-ons for a platform, and track who&apos;s bought
          whom. Discoveries are AI-suggested and unverified — confirm before you act.
        </p>
      </header>

      {/* Tabs */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setPhase("idle");
              setError(null);
            }}
            className={`rounded-full border px-3 py-1 text-[12px] transition ${
              tab === t.key
                ? "border-gold-500/50 bg-gold-500/10 text-fg-primary"
                : "border-line text-fg-muted hover:bg-surface-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(name);
        }}
        className="rounded-2xl border border-gold-500/25 bg-gradient-to-b from-gold-500/[0.06] to-transparent p-4"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            tab === "buyers"
              ? "Target business, e.g. Acme Industrial Services"
              : tab === "addons"
                ? "Platform company, e.g. Southeast HVAC Group"
                : "Filter by company (optional) — leave blank for all"
          }
          className="w-full rounded-lg border border-line bg-surface-0 px-3 py-2.5 text-sm text-fg-primary outline-none focus:border-gold-500"
        />
        {tab !== "history" ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="Sector (optional)"
              className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-xs text-fg-primary outline-none focus:border-gold-500"
            />
            <input
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
              placeholder="Geography (optional)"
              className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-xs text-fg-primary outline-none focus:border-gold-500"
            />
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {tab === "buyers"
              ? BUYER_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    disabled={busy}
                    onClick={() => setName(ex)}
                    className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-surface-2 hover:text-fg-secondary disabled:opacity-50"
                  >
                    {ex.length > 36 ? `${ex.slice(0, 36)}…` : ex}
                  </button>
                ))
              : null}
          </div>
          <button
            type="submit"
            disabled={busy || (tab !== "history" && !name.trim())}
            className="shrink-0 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
          >
            {busy ? "Working…" : tab === "buyers" ? "Map buyers" : tab === "addons" ? "Find add-ons" : "Load history"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {/* Results */}
      {phase === "done" && tab === "buyers" ? (
        <div className="mt-5 space-y-4">
          {onFile.length ? (
            <section className="space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                Buyers on file ranked for {target}
              </p>
              {onFile.map((m, i) =>
                buyerCard(m.buyer.name, m.score, m.buyer.buyerType, m.reasons.join(" "), `f:${m.buyer.name}:${i}`, true),
              )}
            </section>
          ) : null}
          <section className="space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {saved > 0 ? `+${saved} saved · ` : ""}
              {candidates.length} likely buyers for {target}
            </p>
            {candidates.length ? (
              candidates.map((c, i) => buyerCard(c.name, c.fitScore, c.buyerType, c.rationale, `c:${c.name}:${i}`))
            ) : (
              <p className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
                No buyers surfaced — add a sector/geography to sharpen the mapping.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {phase === "done" && tab === "addons" ? (
        <div className="mt-5 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {addOns.length} bolt-ons for {platform}
          </p>
          {addOns.length ? (
            addOns.map((a, i) => (
              <div
                key={`${a.name}:${i}`}
                className="rounded-2xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/40"
              >
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-fg-primary">{a.name}</span>
                  <span className={`ml-auto shrink-0 font-mono text-xs ${scoreTone(a.fitScore)}`}>{a.fitScore}%</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {a.sector ? <span className="text-gold-400">{a.sector}</span> : null}
                  {a.geography ? <span>{a.geography}</span> : null}
                </div>
                {a.rationale ? <p className="mt-1.5 text-xs text-fg-secondary">{a.rationale}</p> : null}
              </div>
            ))
          ) : (
            <p className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
              No bolt-ons surfaced — add a sector to anchor the consolidation thesis.
            </p>
          )}
        </div>
      ) : null}

      {phase === "done" && tab === "history" ? (
        <div className="mt-5 space-y-3">
          {summary && summary.count > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Deals" value={String(summary.count)} />
              <Stat label="Disclosed" value={compactUsd(summary.totalDisclosed)} />
              <Stat label="Span" value={summary.span || "—"} />
              <Stat label="Top acquirer" value={summary.topAcquirer ? `${summary.topAcquirer.name}` : "—"} />
            </div>
          ) : null}
          {history.length ? (
            history.map((r) => (
              <div key={r.id} className="rounded-xl border border-line bg-surface-1 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                  <span className="font-medium text-fg-primary">{r.acquirer_name}</span>
                  <span className="text-fg-muted">acquired</span>
                  <span className="font-medium text-fg-primary">{r.target_name}</span>
                  {r.price_amount ? (
                    <span className="ml-auto font-mono text-xs text-gold-300">{compactUsd(r.price_amount)}</span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {r.structure ? <span className="rounded-full border border-line px-1.5 py-0.5">{humanize(r.structure)}</span> : null}
                  {r.sector ? <span className="text-gold-400">{r.sector}</span> : null}
                  {r.announced_on ? <span>{r.announced_on}</span> : null}
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
              No acquisitions recorded yet. Record deals to build the ownership graph.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
      <span className="block font-mono text-[9px] uppercase tracking-wider text-gold-400">{label}</span>
      <span className="mt-1 block truncate text-sm font-semibold text-fg-primary">{value}</span>
    </div>
  );
}
