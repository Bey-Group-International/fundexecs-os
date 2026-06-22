"use client";

import { Markdown } from "@/components/Markdown";
import type { EarnModelKey } from "@/lib/earn-conversation";

// One model's run in a side-by-side comparison: the answer streamed back for the
// same source question, with a per-card loading state while it fills in.
export interface ModelComparison {
  model: EarnModelKey;
  label: string;
  content: string;
  loading: boolean;
}

// A rough client-side token estimate for an answer — ~4 characters per token.
// Display-only; it never touches the streaming contract.
export function estimateTokens(content: string): number {
  return Math.round(content.length / 4);
}

// Responsive grid of compact cards — each model's label header plus its answer —
// shown beneath a completed Earn answer when the operator compares across models.
export function ModelCompare({ comparisons }: { comparisons: ModelComparison[] }) {
  if (!comparisons.length) return null;
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {comparisons.map((c) => (
        <div
          key={c.model}
          className="min-w-0 rounded-xl border border-line/70 bg-surface-0/45 p-3"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[10px] uppercase tracking-wider text-gold-300">
              {c.label}
            </span>
            {c.loading ? (
              <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                <span className="h-1 w-1 animate-pulse rounded-full bg-gold-400" />
                Running
              </span>
            ) : (
              <span className="font-mono text-[9px] text-fg-muted">
                ≈ {estimateTokens(c.content)} tokens
              </span>
            )}
          </div>
          {c.content ? (
            <Markdown>{c.content}</Markdown>
          ) : c.loading ? (
            <p className="text-xs text-fg-muted">Awaiting answer…</p>
          ) : (
            <p className="text-xs text-fg-muted">No answer returned.</p>
          )}
        </div>
      ))}
    </div>
  );
}
