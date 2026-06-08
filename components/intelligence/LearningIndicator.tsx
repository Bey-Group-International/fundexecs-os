import { Brain, TrendingUp, Target, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntelligenceCalibration } from '@/lib/queries/intelligence-calibration';

/* ----------------------------------------------------------------------------
 * LearningIndicator — the "getting smarter" strip.
 *
 * Surfaces what the scorer has learned from this org's accept/dismiss history:
 * how many decisions it has seen, how cleanly the score now separates accepts
 * from dismisses, and which factor it has come to trust most. This is the
 * human-readable mirror of the per-factor multipliers the SQL learning step
 * writes — proof to the operator that the inbox is tuning to them.
 * -------------------------------------------------------------------------- */

const FACTOR_LABELS: Record<string, string> = {
  thesis_fit: 'thesis fit',
  persona_fit: 'persona fit',
  signal_quality: 'signal quality',
  raise_or_demand_fit: 'raise / demand fit',
  semantic_fit: 'semantic fit',
  routing: 'specialist routing'
};

function factorLabel(factor: string): string {
  return FACTOR_LABELS[factor] ?? factor.replace(/[_-]+/g, ' ');
}

export interface LearningIndicatorProps {
  calibration: IntelligenceCalibration;
  className?: string;
}

export function LearningIndicator({ calibration, className }: LearningIndicatorProps) {
  const { decisions, acceptanceRate, separation, stage, topFactor } = calibration;

  const headline =
    stage === 'cold'
      ? decisions > 0
        ? `Learning from your first ${decisions} ${decisions === 1 ? 'decision' : 'decisions'}`
        : 'Self-tuning — starts after your first few decisions'
      : stage === 'calibrating'
        ? `Calibrating to your last ${decisions} decisions`
        : `Tuned to your last ${decisions} decisions`;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-hairline bg-bg-1 px-3.5 py-2.5',
        className
      )}
    >
      <span className="inline-flex items-center gap-2">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-azure-1">
          <Brain size={14} strokeWidth={2} aria-hidden />
        </span>
        <span className="text-[12px] font-semibold text-fg-2">{headline}</span>
      </span>

      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {decisions > 0 ? (
          <Pill icon={CheckCircle2} tone="success">
            {Math.round(acceptanceRate * 100)}% accepted
          </Pill>
        ) : null}
        {separation != null && separation > 0 ? (
          <Pill icon={TrendingUp} tone="azure">
            +{separation} pt separation
          </Pill>
        ) : null}
        {topFactor ? (
          <Pill icon={Target} tone="gold">
            Trusting {factorLabel(topFactor.factor)} most
          </Pill>
        ) : null}
      </span>
    </div>
  );
}

function Pill({
  icon: Icon,
  tone,
  children
}: {
  icon: typeof Brain;
  tone: 'success' | 'azure' | 'gold';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'success'
      ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
      : tone === 'azure'
        ? 'border-hairline bg-surface-1 text-azure-1'
        : 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
        cls
      )}
    >
      <Icon size={11} strokeWidth={2} aria-hidden />
      {children}
    </span>
  );
}
