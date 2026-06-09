'use client';

import { Sparkles, ThumbsUp, ThumbsDown, Infinity as InfinityIcon } from 'lucide-react';
import { Button } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import type { ProfileRecommendation } from '@/lib/proof-of-truth/earn-profile';

interface RecommendationsProps {
  /** Whether Earn has been asked yet for this question. */
  requested: boolean;
  loading: boolean;
  /** True once Earn responded but was unavailable (degraded / error). */
  degraded: boolean;
  insight: string;
  options: ProfileRecommendation[];
  /** The value currently approved for this question, if any (highlights it). */
  approvedValue: string;
  /** Ask Earn for the first set of recommendations. */
  onRequest: () => void;
  /** Approve an option → its value becomes the answer. */
  onApprove: (value: string) => void;
  /** Disapprove an option → remove + remember as disliked. */
  onDislike: (value: string) => void;
  /** Regenerate the whole set, avoiding disliked values. */
  onRegenerate: () => void;
}

function LoadingState() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
      <EarnCoin size={32} glow className="flex-none" />
      <div className="flex items-center gap-1.5 text-[12.5px] text-fg-3">
        <span>Earn is considering options</span>
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
 * Recommendations — Earn's coin-fronted "Recommend" experience for the current
 * question. On an open (unanswered) question the builder asks Earn automatically
 * so the member is met with suggestions; on an answered one it stays manual via
 * the trigger. Earn returns an insight line plus three distinct option cards,
 * each approvable (👍) or dismissable (👎). A single ♾️ control regenerates the
 * set, avoiding values the member already passed on. Renders the trigger only
 * until asked; renders nothing extra when degraded (the flow falls back to plain
 * manual entry — Earn never blocks).
 */
export function Recommendations({
  requested,
  loading,
  degraded,
  insight,
  options,
  approvedValue,
  onRequest,
  onApprove,
  onDislike,
  onRegenerate
}: RecommendationsProps) {
  if (loading) return <LoadingState />;

  // Not yet asked → show only the Recommend trigger.
  if (!requested) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="gold" size="sm" icon={Sparkles} onClick={onRequest}>
          Recommend
        </Button>
        <span className="text-[11.5px] text-fg-4">Ask Earn for three options.</span>
      </div>
    );
  }

  // Asked, but Earn was unavailable → quiet fallback (manual entry still works).
  if (degraded || options.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="gold" size="sm" icon={Sparkles} onClick={onRequest}>
          Try Earn again
        </Button>
        <span className="text-[11.5px] text-fg-4">
          Earn is unavailable right now — type your own answer below.
        </span>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <EarnCoin size={32} glow className="mt-0.5 flex-none" />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
        {insight && (
          <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-fg-3">
            <Sparkles
              size={13}
              strokeWidth={1.9}
              className="mt-px flex-none text-gold-1"
              aria-hidden
            />
            <span>
              <span className="font-semibold text-fg-2">Earn: </span>
              {insight}
            </span>
          </div>
        )}

        <ul className="mt-3 flex flex-col gap-2">
          {options.map((opt, i) => {
            const approved = approvedValue === opt.value;
            return (
              <li
                key={`${i}-${opt.value.slice(0, 24)}`}
                className={cn(
                  'rounded-xl border bg-surface-2 px-3 py-2.5 transition',
                  approved
                    ? 'border-[var(--gold-line)] shadow-[0_0_0_2px_var(--gold-soft)]'
                    : 'border-hairline'
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                      Option {i + 1}
                      {approved && (
                        <span className="text-gold-1 normal-case tracking-normal">· approved</span>
                      )}
                    </div>
                    <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-fg-1">
                      {opt.value}
                    </p>
                    {opt.note && (
                      <p className="mt-1 text-[11px] leading-relaxed text-fg-4">{opt.note}</p>
                    )}
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onApprove(opt.value)}
                      aria-pressed={approved}
                      aria-label={`Approve option ${i + 1}`}
                      title="Approve"
                      className={cn(
                        'inline-flex h-7 w-7 items-center justify-center rounded-lg border transition',
                        approved
                          ? 'border-transparent bg-gradient-to-br from-gold-1 to-gold-2 text-[#070b14]'
                          : 'border-hairline text-fg-3 hover:bg-surface-3 hover:text-fg-1'
                      )}
                    >
                      <ThumbsUp size={14} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDislike(opt.value)}
                      aria-label={`Dismiss option ${i + 1}`}
                      title="Not for me"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-surface-3 hover:text-fg-2"
                    >
                      <ThumbsDown size={14} strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={InfinityIcon}
            onClick={onRegenerate}
            aria-label="Regenerate three new options"
          >
            New options
          </Button>
          <span className="text-[11px] text-fg-4">Earn avoids what you passed on.</span>
        </div>
      </div>
    </div>
  );
}
