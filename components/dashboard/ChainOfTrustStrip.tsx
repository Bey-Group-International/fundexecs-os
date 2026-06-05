'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface ChainOfTrustStanding {
  /** Whether the member has any chain_of_trust record yet. */
  hasRecord: boolean;
  /** Per-layer completion percentage (0–100). All four are independent. */
  truth: number;
  concept: number;
  execution: number;
  work: number;
  /** Current layer the record sits in (informational — colors the active dot). */
  currentLayer?: 'intent' | 'formation' | 'execution' | 'work';
  /** Optional record id for deep-linking the drawer (Phase 5 will wire). */
  recordId?: string | null;
}

const LAYERS = [
  { key: 'truth' as const, name: 'Truth', color: 'var(--proof-truth)', state: 'intent' },
  { key: 'concept' as const, name: 'Concept', color: 'var(--proof-concept)', state: 'formation' },
  {
    key: 'execution' as const,
    name: 'Execution',
    color: 'var(--proof-execution)',
    state: 'execution'
  },
  { key: 'work' as const, name: 'Work', color: 'var(--proof-work)', state: 'work' }
];

/**
 * ChainOfTrustStrip — compact 4-segment progress strip rendered in every
 * dashboard hero. Reads the member's own chain_of_trust standing. When no
 * record exists yet, renders a CTA card pointing to Settings (Phase 5 will
 * wire the real drawer).
 */
export function ChainOfTrustStrip({ standing }: { standing: ChainOfTrustStanding }) {
  if (!standing.hasRecord) {
    return (
      <Link
        href="/settings"
        className="group flex items-center gap-3 rounded-xl border border-dashed border-hairline bg-surface-1 px-3.5 py-2.5 transition hover:border-[var(--gold-line)] hover:bg-[var(--gold-soft)]"
      >
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-bg-1 text-fg-4 group-hover:border-[var(--gold-line)] group-hover:text-gold-1">
          <ShieldCheck size={15} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Chain of Trust
          </p>
          <p className="truncate text-[12.5px] text-fg-2">
            Start your Chain of Trust — prove your work in four layers.
          </p>
        </div>
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Chain of Trust
        </span>
        {standing.currentLayer ? (
          <Badge tone="azure" className="text-[9px]">
            Active: {standing.currentLayer}
          </Badge>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {LAYERS.map((layer) => {
          const pct = Math.max(0, Math.min(100, standing[layer.key]));
          const active = standing.currentLayer === layer.state;
          return (
            <div key={layer.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn('h-1.5 w-1.5 rounded-full', active && 'animate-pulse')}
                  style={{
                    backgroundColor: layer.color,
                    boxShadow: active ? `0 0 8px ${layer.color}` : 'none'
                  }}
                  aria-hidden
                />
                <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-fg-3">
                  {layer.name}
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={`Proof of ${layer.name}`}
              >
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: layer.color }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-fg-4">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
