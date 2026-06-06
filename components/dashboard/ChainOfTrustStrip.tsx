'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useTrustDrawer } from '@/components/shell/trust/TrustDrawerHost';

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
  /** Record id used to deep-link the drawer when one exists. */
  recordId?: string | null;
  /** Member profile id used to start a record when none exists yet. */
  memberProfileId?: string | null;
  /** Display name used to seed the new chain's title. */
  memberDisplayName?: string | null;
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
 * dashboard hero. Clickable when a `<TrustDrawerHost />` ancestor is mounted:
 *   - has record → opens drawer at the record id,
 *   - no record + memberProfileId set → opens drawer in "starter" mode that
 *     creates the member-profile chain on demand,
 *   - no host context available → renders inert (link only).
 */
export function ChainOfTrustStrip({ standing }: { standing: ChainOfTrustStanding }) {
  const drawer = useTrustDrawer();

  if (!standing.hasRecord) {
    const canStart = !!standing.memberProfileId;
    const startTitle = standing.memberDisplayName
      ? `${standing.memberDisplayName}'s Proof of Truth`
      : 'Member Proof of Truth';
    if (canStart) {
      return (
        <button
          type="button"
          onClick={() =>
            drawer.open({
              starter: {
                subjectEntityType: 'member_profile',
                subjectEntityId: standing.memberProfileId as string,
                title: startTitle
              }
            })
          }
          data-testid="cot-strip-start"
          className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-hairline bg-surface-1 px-3.5 py-2.5 text-left transition hover:border-[var(--gold-line)] hover:bg-[var(--gold-soft)]"
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
        </button>
      );
    }
    return (
      <Link
        href="/settings"
        data-testid="cot-strip-empty-link"
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

  // Gamified growth score: each proof layer is a step toward completing the
  // private-market lifecycle. Overall = mean of the four proofs; tier rises as
  // proofs are cleared.
  const overall = Math.round(
    (standing.truth + standing.concept + standing.execution + standing.work) / 4
  );
  const proofsComplete = LAYERS.filter((l) => standing[l.key] >= 100).length;
  const tier =
    overall >= 100
      ? 'Institutional'
      : overall >= 75
        ? 'Trusted'
        : overall >= 50
          ? 'Proven'
          : overall >= 25
            ? 'Building'
            : 'Forming';

  return (
    <button
      type="button"
      onClick={() => drawer.open({ recordId: standing.recordId ?? null })}
      data-testid="cot-strip"
      aria-label={`Open Chain of Trust drawer for ${standing.memberDisplayName ?? 'your profile'}`}
      className="flex w-full flex-col gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:border-azure-1/40 hover:bg-surface-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Chain of Trust
        </span>
        <Badge tone="azure" className="text-[9px]">
          {tier}
        </Badge>
      </div>
      {/* Overall lifecycle-trust meter — the gamified growth score. */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg-1">
            {overall}%
          </span>
          <span className="text-[11px] text-fg-4">lifecycle trust</span>
        </div>
        <span className="text-[11px] tabular-nums text-fg-3">
          {proofsComplete}/4 proofs cleared
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={overall}
        aria-label="Overall lifecycle trust"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${overall}%`,
            background:
              'linear-gradient(90deg, var(--proof-truth), var(--proof-concept), var(--proof-execution), var(--proof-work))'
          }}
        />
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
    </button>
  );
}
