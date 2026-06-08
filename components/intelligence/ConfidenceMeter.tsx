import { cn } from '@/lib/utils';

/* ----------------------------------------------------------------------------
 * ConfidenceMeter — a 0-100 fill with a calibration band.
 *
 * The fill width is the raw match score; the colour is the *calibrated* band
 * (how the score reads against what this org has actually accepted). Before the
 * model has learned anything the band is `unknown` and the meter renders
 * neutral — honest about not yet knowing.
 * -------------------------------------------------------------------------- */

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';

const BAND_META: Record<ConfidenceBand, { accent: string; word: string }> = {
  high: { accent: 'var(--success)', word: 'High confidence' },
  medium: { accent: 'var(--azure-1)', word: 'Worth a look' },
  low: { accent: 'var(--warning)', word: 'Low confidence' },
  unknown: { accent: 'var(--fg-4)', word: 'Uncalibrated' }
};

export interface ConfidenceMeterProps {
  value: number;
  band: ConfidenceBand;
  /** Override the band word (e.g. to show "Tuned" context). */
  label?: string;
  className?: string;
}

export function ConfidenceMeter({ value, band, label, className }: ConfidenceMeterProps) {
  const meta = BAND_META[band];
  const pct = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-5">
          Confidence
        </span>
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: meta.accent }}>
          {pct}
          <span className="font-normal text-fg-5">/100</span>
        </span>
      </div>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-1"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Confidence ${pct} of 100, ${label ?? meta.word}`}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width]"
          style={{ width: `${pct}%`, backgroundColor: meta.accent }}
        />
      </div>
      <span className="text-[10.5px] font-medium" style={{ color: meta.accent }}>
        {label ?? meta.word}
      </span>
    </div>
  );
}
