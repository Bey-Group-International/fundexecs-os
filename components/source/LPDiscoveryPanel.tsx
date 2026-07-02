"use client";

import React from "react";

interface LPMatch {
  id: string;
  name: string;
  type: string;
  aum: number | null;
  typical_check_min: number | null;
  typical_check_max: number | null;
  thesisFitScore: number;
  warmth: number;
  outreachPriority: number;
  lastContact: string | null;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function fitColor(score: number): string {
  if (score >= 70) return "text-emerald-300";
  if (score >= 40) return "text-gold-400";
  return "text-fg-muted";
}

function warmthLabel(w: number): { label: string; cls: string } {
  if (w >= 70) return { label: "Committed", cls: "bg-emerald-300/10 text-emerald-300 border border-emerald-300/20" };
  if (w >= 40) return { label: "Active", cls: "bg-gold-400/10 text-gold-400 border border-gold-400/20" };
  return { label: "Warm", cls: "bg-fg-muted/10 text-fg-muted border border-line" };
}

function priorityLabel(p: number): { label: string; cls: string } {
  if (p === 1) return { label: "High", cls: "bg-emerald-300/10 text-emerald-300 border border-emerald-300/20" };
  if (p === 2) return { label: "Med", cls: "bg-gold-400/10 text-gold-400 border border-gold-400/20" };
  return { label: "Low", cls: "bg-fg-muted/10 text-fg-muted border border-line" };
}

export function LPDiscoveryPanel({ investors }: { investors: LPMatch[] }) {
  const sorted = [...investors].sort((a, b) => a.outreachPriority - b.outreachPriority || b.thesisFitScore - a.thesisFitScore);

  return (
    <div className="bg-surface-0 rounded-2xl border border-line p-6 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-fg-primary">LP Discovery Engine</h2>
        <p className="text-sm text-fg-muted">GPLPMatch-style ranked recommendations based on thesis fit, warmth, and check size.</p>
      </div>

      {sorted.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-fg-muted text-sm">
          No LP recommendations available.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((lp, idx) => {
            const wInfo = warmthLabel(lp.warmth);
            const pInfo = priorityLabel(lp.outreachPriority);
            return (
              <div key={lp.id} className="bg-surface-1 rounded-2xl border border-line p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-xs font-bold text-fg-muted bg-surface-0 border border-line rounded-full w-7 h-7 flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-fg-primary truncate">{lp.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface-0 border border-line text-fg-secondary font-mono">{lp.type}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className={`font-mono text-xs font-bold ${fitColor(lp.thesisFitScore)}`}>
                        {lp.thesisFitScore}% fit
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${wInfo.cls}`}>{wInfo.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${pInfo.cls}`}>{pInfo.label} Priority</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 pl-10">
                  {lp.aum !== null && (
                    <span className="text-xs text-fg-secondary">
                      <span className="text-fg-muted">AUM </span>
                      <span className="font-mono">{fmtUsd(lp.aum)}</span>
                    </span>
                  )}
                  {lp.typical_check_min !== null && lp.typical_check_max !== null && (
                    <span className="text-xs text-fg-secondary">
                      <span className="text-fg-muted">Check </span>
                      <span className="font-mono">{fmtUsd(lp.typical_check_min)}–{fmtUsd(lp.typical_check_max)}</span>
                    </span>
                  )}
                  <span className="text-xs text-fg-secondary">
                    <span className="text-fg-muted">Last contact </span>
                    <span className={lp.lastContact ? "text-fg-secondary" : "text-fg-muted italic"}>
                      {lp.lastContact ?? "No contact"}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
