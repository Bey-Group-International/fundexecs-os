"use client";

import { useEffect, useRef, useState } from "react";
import { loadAttribution } from "@/app/(app)/[hub]/[module]/radar-attribution-actions";
import {
  ATTRIBUTION_STAGE_LABELS,
  type Attribution,
  type AttributionStage,
  type MoveAttribution,
} from "@/lib/radar-attribution";

type Phase = "idle" | "loading" | "done";

// Tone for a conversion rate, mirroring SourceFunnel's rateTone buckets.
function rateTone(rate: number): string {
  if (rate >= 50) return "text-status-success";
  if (rate >= 20) return "text-gold-300";
  return "text-fg-muted";
}

// The progression stages we draw bars for, in order. (The "accepted" entry point is
// the bar baseline, so it leads.)
const PROGRESS_STAGES: AttributionStage[] = ["accepted", "contacted", "replied", "met", "mandate"];

// Radar → Outcome Attribution — close the loop on the Source Radar. Every recommended
// move the operator ACCEPTED, traced forward through the same funnel stages
// (contacted → replied → met → mandate), so it's finally visible which recommendations
// actually convert. Read-only: it joins existing data, it writes nothing.
export function RadarAttribution({ live }: { live?: boolean; initialPrompt?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranInitial = useRef(false);

  async function refresh() {
    setPhase("loading");
    setError(null);
    try {
      const res = await loadAttribution();
      if (!res.ok || !res.attribution) {
        setError(res.error ?? "Could not load attribution.");
        setPhase("idle");
        return;
      }
      setAttribution(res.attribution);
      setPhase("done");
    } catch {
      setError("Could not load attribution.");
      setPhase("idle");
    }
  }

  useEffect(() => {
    if (!ranInitial.current) {
      ranInitial.current = true;
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Outcome Attribution
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              local mode
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Which recommendations actually convert. Every Radar move you accepted, traced
          forward — accepted → contacted → replied → met → mandate — so the loop from
          recommendation to mandate is finally measurable.
        </p>
      </header>

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {phase === "done" && attribution ? (
        attribution.counts.accepted > 0 ? (
          <div className="space-y-6">
            {/* Headline conversion */}
            <div className="flex items-baseline gap-2">
              <span className={`font-mono text-2xl font-semibold ${rateTone(attribution.overallConversion)}`}>
                {attribution.overallConversion}%
              </span>
              <span className="text-xs text-fg-muted">accepted Radar moves → mandate</span>
            </div>

            {/* Overall progression bars */}
            <div className="space-y-2">
              {PROGRESS_STAGES.map((stage) => {
                const count = attribution.counts[stage];
                const accepted = Math.max(1, attribution.counts.accepted);
                const width = Math.max(2, Math.round((count / accepted) * 100));
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {ATTRIBUTION_STAGE_LABELS[stage]}
                    </span>
                    <div className="relative h-7 flex-1 overflow-hidden rounded-md border border-line bg-surface-1">
                      <div className="h-full bg-gold-500/20" style={{ width: `${width}%` }} />
                      <span className="absolute inset-y-0 left-2 flex items-center font-mono text-xs font-medium text-fg-primary">
                        {count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Stage-to-stage conversion */}
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Stage-to-stage conversion
              </p>
              <div className="flex flex-wrap gap-2">
                {attribution.conversions.map((c) => (
                  <div
                    key={`${c.from}:${c.to}`}
                    className="rounded-lg border border-line bg-surface-1 px-3 py-1.5"
                  >
                    <div className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      {ATTRIBUTION_STAGE_LABELS[c.from]} → {ATTRIBUTION_STAGE_LABELS[c.to]}
                    </div>
                    <div className={`font-mono text-sm font-semibold ${rateTone(c.rate)}`}>
                      {c.rate}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-move-kind attribution */}
            <MoveKindTable rows={attribution.byMoveKind.filter((r) => r.accepted > 0)} />

            <p className="text-[11px] text-fg-muted">
              Read-only over your existing data. Entities are matched from accepted Radar
              feedback to outreach, inbox, and deals by id, then by name. “Met” counts
              threads with a scheduled meeting (booking/video or a set time); “mandate”
              counts deals — the same stage definitions the Outcome Funnel uses.
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
            No accepted recommendations yet. Act on a move from the{" "}
            <a href="/source/lp_pipeline" className="text-gold-300 hover:underline">Radar</a> — once you
            accept recommendations, their outcomes are traced here.
          </p>
        )
      ) : (
        <p className="mt-6 text-sm text-fg-muted">Loading attribution…</p>
      )}
    </div>
  );
}

function MoveKindTable({ rows }: { rows: MoveAttribution[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        By recommendation
      </p>
      <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[9px] uppercase tracking-wider text-fg-muted">
              <th className="px-3 py-2 font-medium">Move</th>
              <th className="px-3 py-2 text-right font-medium">Accepted</th>
              <th className="px-3 py-2 text-right font-medium">Contacted</th>
              <th className="px-3 py-2 text-right font-medium">Replied</th>
              <th className="px-3 py-2 text-right font-medium">Met</th>
              <th className="px-3 py-2 text-right font-medium">Mandate</th>
              <th className="px-3 py-2 text-right font-medium">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.moveKind} className="border-b border-line/50 last:border-0">
                <td className="px-3 py-2 text-fg-primary">{r.label}</td>
                <td className="px-3 py-2 text-right font-mono text-fg-secondary">{r.accepted}</td>
                <td className="px-3 py-2 text-right font-mono text-fg-secondary">{r.contacted}</td>
                <td className="px-3 py-2 text-right font-mono text-fg-secondary">{r.replied}</td>
                <td className="px-3 py-2 text-right font-mono text-fg-secondary">{r.met}</td>
                <td className="px-3 py-2 text-right font-mono text-fg-secondary">{r.mandate}</td>
                <td className={`px-3 py-2 text-right font-mono ${rateTone(r.conversion)}`}>{r.conversion}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
