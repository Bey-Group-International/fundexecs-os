'use client';

import { useState } from 'react';
import { ArrowRight, Gauge, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { assessFundReadiness } from '@/lib/actions/fund-readiness';
import type { FundReadinessResult } from '@/lib/capital-formation/fund-readiness';

/* ============================================================================
 * components/build/FundReadinessCard — Earn's institutional readiness read.
 *
 * An on-demand assessment: the operator asks Earn to grade how ready their
 * fund is to raise, and gets a 0–100 score, a verdict an LP would recognize,
 * a dimension breakdown, and the three highest-leverage next moves. Reads the
 * live workspace via `assessFundReadiness` — nothing is persisted.
 * ========================================================================= */

function scoreColor(score: number): string {
  return score >= 75 ? 'var(--success)' : score >= 50 ? 'var(--gold-1)' : 'var(--fg-3)';
}

export function FundReadinessCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundReadinessResult | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await assessFundReadiness();
      if (res.ok) setResult(res.result);
      else setError(res.error);
    } catch {
      setError('Could not assess readiness — try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-[18px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
            <Gauge size={16} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Fund readiness · graded by Earn
            </div>
            <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
              Are you ready to raise?
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
          {loading ? 'Assessing…' : result ? 'Re-assess' : 'Assess readiness'}
        </Button>
      </div>

      {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

      {!result && !error && (
        <p className="mt-3 max-w-[68ch] text-[12.5px] leading-relaxed text-fg-4">
          Earn reads your live workspace — your profile, formation progress, materials, and LP
          pipeline — and grades how ready your fund is for institutional eyes, the way an LP&apos;s
          investment committee would.
        </p>
      )}

      {result && (
        <div className="mt-4 flex flex-col gap-4">
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

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {result.dimensions.map((d) => (
              <div key={d.label} className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-semibold text-fg-1">{d.label}</span>
                  <span
                    className="text-[12.5px] font-semibold [font-feature-settings:'tnum']"
                    style={{ color: scoreColor(d.score) }}
                  >
                    {d.score}
                  </span>
                </div>
                <ProgressBar value={d.score} height={5} label={`${d.label} readiness`} />
                <p className="mt-1.5 text-[11px] leading-relaxed text-fg-4">{d.note}</p>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Earn&apos;s next moves
            </div>
            <div className="flex flex-col gap-1.5">
              {result.moves.map((m) => (
                <div
                  key={m.label}
                  className="flex items-start gap-2.5 rounded-[11px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-2.5"
                >
                  <ArrowRight size={15} className="mt-0.5 flex-none text-gold-1" aria-hidden />
                  <div>
                    <div className="text-[12.5px] font-semibold text-fg-1">{m.label}</div>
                    <div className="text-[11.5px] leading-relaxed text-fg-3">{m.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {result.degraded && (
            <div className="flex items-center gap-2 text-[11px] text-fg-5">
              <EarnCoin size={16} />
              Computed from your workspace signals — re-assess once Earn is reachable for a fuller
              read.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
