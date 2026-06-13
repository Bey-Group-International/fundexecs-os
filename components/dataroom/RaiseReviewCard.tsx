'use client';

import { useState } from 'react';
import { AlertTriangle, FileSearch, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { reviewRaiseNarrative } from '@/lib/actions/material-review';
import type { MaterialReviewResult } from '@/lib/capital-formation/material-review';

/* ============================================================================
 * components/dataroom/RaiseReviewCard — "review my deck like an LP".
 *
 * Earn reads the raise narrative assembled from the operator's Source of Truth
 * and reviews it the way a skeptical institutional LP would: a verdict, a
 * 0–100 readiness score, what lands, what's missing, the red flags, and
 * concrete edits. A live read via `reviewRaiseNarrative` — nothing persisted.
 * ========================================================================= */

function scoreColor(score: number): string {
  return score >= 75 ? 'var(--success)' : score >= 50 ? 'var(--gold-1)' : 'var(--fg-3)';
}

function FindingList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        {title}
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-[10px] border border-hairline bg-surface-1 px-3 py-2 text-[12px] leading-relaxed text-fg-2"
          >
            <span
              className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: tone }}
              aria-hidden
            />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RaiseReviewCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thin, setThin] = useState(false);
  const [result, setResult] = useState<MaterialReviewResult | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await reviewRaiseNarrative();
      if (res.ok) {
        setResult(res.result);
        setThin(res.thin);
      } else {
        setError(res.error);
      }
    } catch {
      setError('Could not run the review — try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-[18px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
            <FileSearch size={16} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Diligence brain · Earn
            </div>
            <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
              Review my raise like an LP
            </h2>
          </div>
        </div>
        <Button
          variant={result ? 'ghost' : 'gold'}
          size="sm"
          icon={loading ? Loader2 : Sparkles}
          disabled={loading}
          onClick={run}
        >
          {loading ? 'Reviewing…' : result ? 'Re-review' : 'Review like an LP'}
        </Button>
      </div>

      {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

      {!result && !error && (
        <p className="mt-3 max-w-[68ch] text-[12.5px] leading-relaxed text-fg-4">
          Earn reads the raise narrative built from your Source of Truth — thesis, strategy, track
          record, team, and terms — and reviews it the way a skeptical institutional LP would on a
          first read, then tells you exactly what to fix.
        </p>
      )}

      {result && (
        <div className="mt-4 flex flex-col gap-4">
          {thin && (
            <div className="flex items-center gap-2.5 rounded-[11px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-2.5 text-[11.5px] text-fg-2">
              <AlertTriangle size={14} className="flex-none text-gold-1" aria-hidden />
              Your Source of Truth is thin — fill in your thesis, track record, and terms, then
              re-review for a sharper read.
            </div>
          )}

          <div className="flex items-center gap-4 rounded-[13px] border border-hairline bg-surface-1 px-4 py-3.5">
            <div className="flex-none text-center">
              <div
                className="text-[34px] font-semibold leading-none [font-feature-settings:'tnum']"
                style={{ color: scoreColor(result.score) }}
              >
                {result.score}
              </div>
              <div className="mt-1 text-[10px] text-fg-5">of 100</div>
            </div>
            <p className="text-[12.5px] leading-relaxed text-fg-2">{result.verdict}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FindingList title="What lands" items={result.strengths} tone="var(--success)" />
            <FindingList title="Gaps" items={result.gaps} tone="var(--gold-1)" />
            <FindingList title="Red flags" items={result.redFlags} tone="var(--danger)" />
            <FindingList
              title="Suggested edits"
              items={result.suggestedEdits}
              tone="var(--azure-1)"
            />
          </div>

          {result.degraded && (
            <div className="flex items-center gap-2 text-[11px] text-fg-5">
              <EarnCoin size={16} />
              Earn was briefly unavailable — re-review for a substantive read.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
