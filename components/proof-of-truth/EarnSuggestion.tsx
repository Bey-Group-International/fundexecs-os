'use client';

import { Lightbulb, Sparkles, Wand2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import type { ProfileSuggestion } from '@/lib/proof-of-truth/earn-profile';

interface EarnSuggestionProps {
  loading: boolean;
  suggestion: ProfileSuggestion | null;
  /** True once Earn responded but was unavailable (degraded / error). */
  degraded: boolean;
  onUse: () => void;
  onWriteOwn: () => void;
}

function LoadingState() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
      <EarnCoin size={32} glow className="flex-none" />
      <div className="flex items-center gap-1.5 text-[12.5px] text-fg-3">
        <span>Earn is thinking</span>
        <span className="inline-flex gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-1 [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-1 [animation-delay:200ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-1 [animation-delay:400ms]" />
        </span>
      </div>
    </div>
  );
}

/**
 * EarnSuggestion — renders Earn's coin-fronted message for the current question:
 * the recommendation, an insight, and the reasoning, each clearly distinguished,
 * with "Use this" and "Write my own" actions. Renders nothing when degraded (the
 * flow falls back to plain manual entry — Earn never blocks).
 */
export function EarnSuggestion({
  loading,
  suggestion,
  degraded,
  onUse,
  onWriteOwn
}: EarnSuggestionProps) {
  if (loading) return <LoadingState />;
  if (degraded || !suggestion) return null;

  return (
    <div className="flex gap-3">
      <EarnCoin size={32} glow className="mt-0.5 flex-none" />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
        {suggestion.recommendation && (
          <p className="text-[13px] leading-relaxed text-fg-1">{suggestion.recommendation}</p>
        )}

        {suggestion.insight && (
          <div className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-fg-3">
            <Sparkles
              size={13}
              strokeWidth={1.9}
              className="mt-px flex-none text-gold-1"
              aria-hidden
            />
            <span>
              <span className="font-semibold text-fg-2">Why it matters: </span>
              {suggestion.insight}
            </span>
          </div>
        )}

        {suggestion.reasoning && (
          <div className="mt-1.5 flex items-start gap-2 text-[11.5px] leading-relaxed text-fg-4">
            <Lightbulb
              size={13}
              strokeWidth={1.9}
              className="mt-px flex-none text-fg-4"
              aria-hidden
            />
            <span>
              <span className="font-semibold text-fg-3">How I got here: </span>
              {suggestion.reasoning}
            </span>
          </div>
        )}

        {suggestion.suggestedValue && (
          <div className="mt-3 rounded-xl border border-hairline bg-surface-2 px-3 py-2">
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Suggested
            </div>
            <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-fg-1">
              {suggestion.suggestedValue}
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="gold" size="sm" icon={Wand2} onClick={onUse}>
            Use this
          </Button>
          <Button variant="ghost" size="sm" icon={PenLine} onClick={onWriteOwn}>
            Write my own
          </Button>
        </div>
      </div>
    </div>
  );
}
