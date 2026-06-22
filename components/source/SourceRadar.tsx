"use client";

import { useEffect, useRef, useState } from "react";
import { loadRadar, scanRadarSignals } from "@/app/(app)/[hub]/[module]/source-radar-actions";
import { addEntityToPipeline } from "@/app/(app)/[hub]/[module]/sourcing-intel-actions";
import type { RadarItem, RadarMoveKind } from "@/lib/source-radar";
import type { EntityKind } from "@/lib/sourcing-intel";

type Phase = "idle" | "loading" | "done";
type KindFilter = EntityKind | "all";

const KINDS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "company", label: "Companies" },
  { key: "investor", label: "Investors" },
  { key: "fund", label: "Funds" },
  { key: "advisor", label: "Advisors" },
  { key: "lender", label: "Lenders" },
  { key: "provider", label: "Providers" },
];

// Local tone helpers (no value-import from the signal engine, which pulls server deps).
function scoreTone(score: number): string {
  if (score >= 66) return "text-status-success";
  if (score >= 33) return "text-gold-300";
  return "text-fg-muted";
}
function propTone(score: number): string {
  if (score >= 66) return "border-status-danger/40 bg-status-danger/10 text-status-danger";
  if (score >= 33) return "border-gold-500/40 bg-gold-500/10 text-gold-300";
  return "border-line text-fg-muted";
}
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
const MOVE_TONE: Record<RadarMoveKind, string> = {
  buyers: "border-status-info/40 bg-status-info/10 text-status-info",
  outreach: "border-gold-500/40 bg-gold-500/10 text-gold-200",
  pipeline: "border-status-success/40 bg-status-success/10 text-status-success",
  signals: "border-line text-fg-secondary",
  research: "border-line text-fg-secondary",
};

// Source Radar — the compounding command surface. One ranked "act now" list that
// fuses the catalog (who), signals + propensity (why now), and mandate fit (why
// us), then routes each target into the cluster that acts on it.
export function SourceRadar({ live }: { live: boolean; initialPrompt?: string }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<RadarItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const ranInitial = useRef(false);

  async function refresh(k: KindFilter = kind) {
    setPhase("loading");
    setError(null);
    try {
      const res = await loadRadar(k === "all" ? null : k);
      if (!res.ok) {
        setError(res.error ?? "Could not load the radar.");
        setPhase("idle");
        return;
      }
      setItems(res.items ?? []);
      setPhase("done");
    } catch {
      setError("Could not load the radar.");
      setPhase("idle");
    }
  }

  useEffect(() => {
    if (!ranInitial.current) {
      ranInitial.current = true;
      refresh("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onKind(k: KindFilter) {
    setKind(k);
    await refresh(k);
  }

  async function scan() {
    if (scanning) return;
    setScanning(true);
    setNote(null);
    try {
      const res = await scanRadarSignals();
      setNote(res.ok ? `Scanned ${res.scanned ?? 0} entities · ${res.generated ?? 0} new signals.` : res.error ?? "Scan failed.");
      if (res.ok) await refresh();
    } catch {
      setNote("Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function addToPipeline(item: RadarItem) {
    if (!item.entityId || busyId || added.has(item.entityId)) return;
    setBusyId(item.entityId);
    try {
      const res = await addEntityToPipeline(item.entityId);
      if (res.ok) setAdded((prev) => new Set(prev).add(item.entityId!));
      else setError(res.error ?? "Could not add to pipeline.");
    } catch {
      setError("Could not add to pipeline.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Source Radar
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              local mode
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Who to act on now — your catalog ranked by signal momentum, sell/raise propensity, and
          mandate fit. Each target routes to the move that compounds it.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => onKind(k.key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                kind === k.key
                  ? "border-gold-500/50 bg-gold-500/10 text-fg-primary"
                  : "border-line text-fg-muted hover:bg-surface-2"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={scanning}
          className="shrink-0 rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Scan for signals"}
        </button>
      </div>
      {note ? <p className="mt-2 text-[11px] text-gold-300">{note}</p> : null}

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {phase === "done" ? (
        items.length ? (
          <div className="mt-5 space-y-3">
            {items.map((it, i) => {
              const isAdded = it.entityId ? added.has(it.entityId) : false;
              return (
                <div key={it.entityId ?? `${it.name}:${i}`} className="rounded-2xl border border-line bg-surface-1 p-4">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 w-9 shrink-0 font-mono text-lg font-semibold ${scoreTone(it.score)}`}>
                      {it.score}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-fg-primary">{it.name}</span>
                        {it.inPipeline ? (
                          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-status-info">
                            in pipeline
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        <span className="rounded-full border border-line px-1.5 py-0.5">{humanize(it.kind)}</span>
                        {it.geography ? <span>{it.geography}</span> : null}
                        {it.categories.slice(0, 2).map((c) => (
                          <span key={c} className="text-gold-400">{humanize(c)}</span>
                        ))}
                        <span className="text-fg-muted">fit {it.fit}</span>
                      </div>
                      <p className="mt-1.5 text-xs text-fg-secondary">{it.signalSummary}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${propTone(it.propensity.sell)}`}>
                          sell {it.propensity.sell}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${propTone(it.propensity.raise)}`}>
                          raise {it.propensity.raise}
                        </span>
                        {it.signalCount > 0 ? (
                          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                            {it.signalCount} signal{it.signalCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {it.move.kind === "pipeline" ? (
                        <button
                          type="button"
                          onClick={() => addToPipeline(it)}
                          disabled={busyId === it.entityId || isAdded}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition hover:opacity-80 disabled:opacity-50 ${MOVE_TONE.pipeline}`}
                        >
                          {isAdded ? "Added ✓" : busyId === it.entityId ? "Adding…" : it.move.label}
                        </button>
                      ) : it.move.href ? (
                        <a
                          href={it.move.href}
                          className={`inline-block rounded-md border px-2.5 py-1 text-[11px] font-medium transition hover:opacity-80 ${MOVE_TONE[it.move.kind]}`}
                        >
                          {it.move.label} →
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-fg-muted">
              Ranked by why-now × why-us. Moves route into the owning cluster — buyers, outreach, or
              the pipeline — so every signal turns into an action.
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
            Nothing on the radar yet. Build your catalog from{" "}
            <a href="/source/intel" className="text-gold-300 hover:underline">Intelligence</a>, then
            “Scan for signals” to surface what’s moving.
          </p>
        )
      ) : (
        <p className="mt-6 text-sm text-fg-muted">Loading the radar…</p>
      )}
    </div>
  );
}
