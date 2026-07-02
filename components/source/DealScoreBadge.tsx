"use client";

import { scoreDeal } from "@/lib/deal-scoring";
import type { DealScoreInputs } from "@/lib/deal-scoring";

const TIER_STYLE: Record<string, string> = {
  A: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  B: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  C: "border-status-info/40 bg-status-info/10 text-status-info",
  D: "border-line bg-surface-0 text-fg-muted",
};

export function DealScoreBadge({ inputs }: { inputs: DealScoreInputs }) {
  const score = scoreDeal(inputs);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] ${TIER_STYLE[score.tier]}`}
      title={`Composite: ${score.composite} | Fit: ${score.fit} | Urgency: ${score.urgency} | Momentum: ${score.momentum}`}
    >
      <span className="opacity-60">Score</span>
      <span className="font-semibold">{score.composite}</span>
      <span className="opacity-60">({score.tier})</span>
    </span>
  );
}
