"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  scanSignals,
  topSignals,
  type SubjectSignals,
} from "@/app/(app)/[hub]/[module]/sourcing-signals-actions";
import type { SignalRecord, SignalType } from "@/lib/sourcing-signals";

type Phase = "idle" | "loading" | "done";

// Signal-type metadata defined locally so this client bundle never value-imports
// the engine (which pulls server-only deps — import type only, per convention).
const SIGNAL_LABELS: Record<SignalType, string> = {
  funding_round: "Funding round",
  hiring: "Hiring surge",
  ownership_change: "Ownership change",
  news: "In the news",
  growth: "Growth spike",
  raise_intent: "Raise intent",
  sale_intent: "Sale intent",
};

function toneClass(score: number): string {
  if (score >= 66) return "text-status-success";
  if (score >= 33) return "text-gold-300";
  return "text-fg-muted";
}
function badgeClass(score: number): string {
  if (score >= 66) return "border-emerald-400/40 text-emerald-300";
  if (score >= 33) return "border-gold-500/40 text-gold-300";
  return "border-line text-fg-muted";
}
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function PropensityBadge({ label, value }: { label: string; value: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${badgeClass(value)}`}
      title={`${label}: ${value}%`}
    >
      {label} {value}%
    </span>
  );
}

function SignalRow({ s }: { s: SignalRecord }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="mt-0.5 shrink-0 rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
        {SIGNAL_LABELS[s.signalType] ?? humanize(s.signalType)}
      </span>
      <span className={`shrink-0 font-mono text-[11px] ${toneClass(s.strength)}`}>{s.strength}%</span>
      <span className="min-w-0 flex-1 text-xs text-fg-secondary">
        {s.summary ?? `${humanize(s.signalType)} signal.`}
        {s.sourceUrl ? (
          <a
            href={s.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1.5 font-mono text-[10px] text-status-info hover:underline"
          >
            ↗ source
          </a>
        ) : null}
      </span>
    </div>
  );
}

function SubjectCard({ subject }: { subject: SubjectSignals }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            {subject.entityId ? (
              <Link
                href={`/source/intel?entity=${subject.entityId}`}
                className="truncate text-sm font-medium text-fg-primary hover:text-gold-200"
              >
                {subject.subjectName}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium text-fg-primary">{subject.subjectName}</span>
            )}
            {subject.kind ? (
              <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                {humanize(subject.kind)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-fg-secondary">{subject.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <PropensityBadge label="Sell" value={subject.propensity.sell} />
          <PropensityBadge label="Raise" value={subject.propensity.raise} />
        </div>
      </div>

      {subject.signals.length ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
          >
            {open ? "▾ hide" : "▸ show"} {subject.signals.length} signal
            {subject.signals.length === 1 ? "" : "s"}
          </button>
          {open ? (
            <div className="mt-1 divide-y divide-line/60 border-t border-line/60">
              {subject.signals.map((s) => (
                <SignalRow key={s.id} s={s} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Sourcing Signals — the dedicated triggers workspace. A propensity-ranked
// watchlist of the firm's market signals (funding rounds, hiring, ownership
// changes, news, growth, raise/sale intent) over the intelligence catalog, with
// one-click "scan for signals" and deep links back to each entity. Mirrors the
// SourcingIntel surface; signals are generated deterministically (Claude-optional)
// so the feed works with no model key.
export function SourceSignals({
  live,
  initialPrompt,
}: {
  live: boolean;
  initialPrompt?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [subjects, setSubjects] = useState<SubjectSignals[]>([]);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranInitial = useRef(false);

  async function loadFeed() {
    setPhase("loading");
    setError(null);
    try {
      const res = await topSignals();
      if (!res.ok) {
        setError(res.error ?? "Could not load the signal feed.");
        setPhase("done");
        return;
      }
      setSubjects(res.subjects ?? []);
      setPhase("done");
    } catch {
      setError("Could not load the signal feed.");
      setPhase("done");
    }
  }

  async function scan() {
    if (scanning) return;
    setScanning(true);
    setNote(null);
    setError(null);
    try {
      const res = await scanSignals();
      if (!res.ok) {
        setError(res.error ?? "Could not scan for signals.");
      } else {
        setNote(
          res.subject
            ? `Scanned ${res.subject.subjectName} — ${res.recorded ?? 0} new signal${(res.recorded ?? 0) === 1 ? "" : "s"}.`
            : "Scan complete.",
        );
        await loadFeed();
      }
    } catch {
      setError("Could not scan for signals.");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (!ranInitial.current) {
      ranInitial.current = true;
      loadFeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Signals &amp; Triggers
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              local mode
            </span>
          ) : null}
          <Link
            href="/source/intel"
            className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-gold-200"
          >
            → Intelligence
          </Link>
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          {initialPrompt ? `“${initialPrompt}” — ` : ""}
          A propensity-ranked watchlist of market triggers across the firm&apos;s intelligence
          catalog. Scan an entity for fresh signals and read its likelihood to sell or raise.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gold-500/25 bg-gradient-to-b from-gold-500/[0.06] to-transparent p-4">
        <button
          type="button"
          onClick={scan}
          disabled={scanning}
          className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "✶ Scan for signals"}
        </button>
        <button
          type="button"
          onClick={loadFeed}
          disabled={phase === "loading"}
          className="rounded-md border border-line px-3 py-2 text-sm text-fg-secondary transition hover:bg-surface-2 disabled:opacity-50"
        >
          {phase === "loading" ? "Refreshing…" : "Refresh feed"}
        </button>
        {note ? <span className="text-[11px] text-gold-300">{note}</span> : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {phase === "done" ? (
        subjects.length ? (
          <div className="mt-5 space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {subjects.length} subject{subjects.length === 1 ? "" : "s"} on the watchlist · ranked by propensity
            </p>
            {subjects.map((s) => (
              <SubjectCard key={s.entityId ?? s.subjectName} subject={s} />
            ))}
            <p className="text-[11px] text-fg-muted">
              Signals are AI-generated and unverified — confirm them against a live source before
              acting. Propensity is a deterministic read of the signal mix.
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
            No signals yet. Add entities in{" "}
            <Link href="/source/intel" className="text-gold-200 hover:underline">
              Intelligence
            </Link>
            , then “Scan for signals” to start the watchlist.
          </p>
        )
      ) : null}
    </div>
  );
}
