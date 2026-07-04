"use client";

import { useEffect, useRef, useState } from "react";
import { loadFunnel } from "@/app/(app)/[hub]/[module]/source-funnel-actions";
import {
  STAGE_LABELS,
  type EngagementSummary,
  type Funnel,
  type FunnelStage,
} from "@/lib/source-funnel";

type Phase = "idle" | "loading" | "done";

// Tone for a conversion rate, mirroring SourceRadar's scoreTone buckets.
function rateTone(rate: number): string {
  if (rate >= 50) return "text-status-success";
  if (rate >= 20) return "text-gold-300";
  return "text-fg-muted";
}

// Source Outcome Funnel — the measurement surface over the sourcing suite. One
// read of how targets move from sourced → contacted → replied → met → mandate,
// with stage-to-stage conversion and a breakdown of what's working by source and
// by signal type. Read-only: it counts existing data, it doesn't write anything.
export function SourceFunnel({ live }: { live?: boolean; initialPrompt?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranInitial = useRef(false);

  async function refresh() {
    setPhase("loading");
    setError(null);
    try {
      const res = await loadFunnel();
      if (!res.ok || !res.funnel) {
        setError(res.error ?? "Could not load the funnel.");
        setPhase("idle");
        return;
      }
      setFunnel(res.funnel);
      setPhase("done");
    } catch {
      setError("Could not load the funnel.");
      setPhase("idle");
    }
  }

  useEffect(() => {
    if (!ranInitial.current) {
      ranInitial.current = true;
      refresh();
    }
     
  }, []);

  const maxCount = funnel
    ? Math.max(1, ...(Object.values(funnel.counts) as number[]))
    : 1;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Outcome Funnel
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              local mode
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          The whole suite, end-to-end — sourced → contacted → replied → met → mandate.
          See what converts and where targets fall out, so every cluster compounds into
          measurable ROI.
        </p>
      </header>

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {phase === "done" && funnel ? (
        funnel.counts.sourced > 0 ? (
          <div className="space-y-6">
            {/* Headline conversion */}
            <div className="flex items-baseline gap-2">
              <span className={`font-mono text-2xl font-semibold ${rateTone(funnel.overallConversion)}`}>
                {funnel.overallConversion}%
              </span>
              <span className="text-xs text-fg-muted">sourced → mandate conversion</span>
            </div>

            {/* The funnel bars */}
            <div className="space-y-2">
              {(Object.keys(funnel.counts) as FunnelStage[]).map((stage) => {
                const count = funnel.counts[stage];
                const width = Math.max(2, Math.round((count / maxCount) * 100));
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {STAGE_LABELS[stage]}
                    </span>
                    <div className="relative h-7 flex-1 overflow-hidden rounded-md border border-line bg-surface-1">
                      <div
                        className="h-full bg-gold-500/20"
                        style={{ width: `${width}%` }}
                      />
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
                {funnel.conversions.map((c) => (
                  <div
                    key={`${c.from}:${c.to}`}
                    className="rounded-lg border border-line bg-surface-1 px-3 py-1.5"
                  >
                    <div className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      {STAGE_LABELS[c.from]} → {STAGE_LABELS[c.to]}
                    </div>
                    <div className={`font-mono text-sm font-semibold ${rateTone(c.rate)}`}>
                      {c.rate}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Act-now performance — the loop's telemetry */}
            {funnel.engagement ? (
              <ActNowPanel engagement={funnel.engagement} />
            ) : null}

            {/* Breakdown by source */}
            {funnel.bySource.length ? (
              <BreakdownTable title="Conversion by source" rows={funnel.bySource} />
            ) : null}

            {/* Breakdown by signal */}
            {funnel.bySignal.length ? (
              <BreakdownTable title="By signal type" rows={funnel.bySignal} />
            ) : null}

            <p className="text-[11px] text-fg-muted">
              Read-only over your existing data. “Met” counts threads with a scheduled
              meeting (booking/video or a set time); “mandate” counts deals in the pipeline.
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
            Nothing in the funnel yet. Build your catalog from{" "}
            <a href="/source/lp_pipeline" className="text-gold-300 hover:underline">Intelligence</a>, then
            run outreach — outcomes show up here as targets move through the suite.
          </p>
        )
      ) : (
        <p className="mt-6 text-sm text-fg-muted">Loading the funnel…</p>
      )}
    </div>
  );
}

// Act-now performance — how the digest + Radar loop is landing. Digest open and
// click rates over digests sent, plus Radar acceptance. Read-only telemetry that
// sits beside the conversion funnel; degrades to 0% / "no digests sent yet" when
// the loop hasn't run.
function ActNowPanel({ engagement }: { engagement: EngagementSummary }) {
  const sent = engagement.digestsSent > 0;
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        Act-now performance
      </p>
      {sent ? (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Open rate" value={`${engagement.openRate}%`} tone={rateTone(engagement.openRate)} />
          <Stat label="Click rate" value={`${engagement.clickRate}%`} tone={rateTone(engagement.clickRate)} />
          <Stat
            label="Radar acceptance"
            value={`${engagement.acceptanceRate}%`}
            tone={rateTone(engagement.acceptanceRate)}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-xs text-fg-secondary">
          No digests sent yet — open, click, and Radar acceptance rates show up here
          once the act-now loop runs.
        </div>
      )}
    </div>
  );
}

// A compact stat card matching the stage-to-stage conversion styling.
function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={`font-mono text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; sourced: number; contacted: number; mandate: number; conversion: number }[];
}) {
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">{title}</p>
      <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[9px] uppercase tracking-wider text-fg-muted">
              <th className="px-3 py-2 font-medium">Group</th>
              <th className="px-3 py-2 text-right font-medium">Sourced</th>
              <th className="px-3 py-2 text-right font-medium">Contacted</th>
              <th className="px-3 py-2 text-right font-medium">Mandate</th>
              <th className="px-3 py-2 text-right font-medium">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.key} className="border-b border-line/50 last:border-0">
                <td className="px-3 py-2 text-fg-primary">{r.label}</td>
                <td className="px-3 py-2 text-right font-mono text-fg-secondary">{r.sourced}</td>
                <td className="px-3 py-2 text-right font-mono text-fg-secondary">{r.contacted}</td>
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
