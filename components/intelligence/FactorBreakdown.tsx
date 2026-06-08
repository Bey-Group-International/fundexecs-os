import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ----------------------------------------------------------------------------
 * FactorBreakdown — the five (or six) scoring factors as weighted bars.
 *
 * Each bar's length is the factor's contributed weight relative to the largest
 * factor, so the operator sees *why* a match scored where it did at a glance.
 * When a factor carries an adaptive multiplier (the org's learning has nudged
 * it), an up/down arrow shows the direction the model has tuned it.
 * -------------------------------------------------------------------------- */

export interface BreakdownFactor {
  factor: string;
  weight: number;
  multiplier?: number;
  detail?: string;
}

export interface FactorBreakdownProps {
  factors: BreakdownFactor[];
  className?: string;
}

const LABELS: Record<string, string> = {
  thesis_fit: 'Thesis fit',
  persona_fit: 'Persona fit',
  signal_quality: 'Signal quality',
  raise_or_demand_fit: 'Raise / demand fit',
  semantic_fit: 'Semantic fit',
  routing: 'Specialist routing'
};

function label(factor: string): string {
  return LABELS[factor] ?? factor.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FactorBreakdown({ factors, className }: FactorBreakdownProps) {
  const visible = factors.filter((f) => f.factor !== 'match_reason' && f.factor !== 'ai_judge');
  if (visible.length === 0) return null;
  const max = Math.max(1, ...visible.map((f) => f.weight));

  return (
    <ul className={cn('grid gap-1.5', className)}>
      {visible.map((f) => {
        const pct = Math.max(4, Math.round((f.weight / max) * 100));
        const m = f.multiplier ?? 1;
        const tuned = m > 1.02 ? 'up' : m < 0.98 ? 'down' : null;
        return (
          <li key={f.factor} className="flex items-center gap-2.5">
            <span className="w-[88px] flex-none text-[11px] font-medium text-fg-3">
              {label(f.factor)}
            </span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-1">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-azure-1"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="inline-flex w-9 flex-none items-center justify-end gap-0.5 text-[10.5px] font-semibold tabular-nums text-fg-2">
              {tuned === 'up' ? (
                <ArrowUpRight
                  size={11}
                  strokeWidth={2.4}
                  className="text-success"
                  aria-label="boosted"
                />
              ) : tuned === 'down' ? (
                <ArrowDownRight
                  size={11}
                  strokeWidth={2.4}
                  className="text-warning"
                  aria-label="dampened"
                />
              ) : null}
              {f.weight}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
