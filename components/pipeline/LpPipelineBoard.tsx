'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, CircleDollarSign, UserCog, Users, Layers } from 'lucide-react';
import { Badge, Button, Card, ProgressBar, Select, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { LpFinder } from '@/components/pipeline/LpFinder';
import { updateLpStage } from '@/lib/actions/lp-pipeline';
import {
  LP_STAGES,
  type LpEntry,
  type LpPipelineData,
  type LpStageKey
} from '@/lib/pipeline/lp-stages';

/* ============================================================================
 * LpPipelineBoard — the LP stage board (Prospect → Contacted → Soft-circle →
 * Committed) over capital_providers. Quick stage controls move an LP between
 * stages (optimistic). "Find LPs with AI" opens the LP finder. Roll-up totals
 * sit in the header.
 * ========================================================================= */

const MOVE_OPTIONS = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'soft_circled', label: 'Soft-circle' },
  { value: 'committed', label: 'Committed' },
  { value: 'passed', label: 'Passed' }
];

const STAGE_TONE: Record<LpStageKey, BadgeTone> = {
  prospect: 'neutral',
  contacted: 'azure',
  soft_circled: 'warning',
  committed: 'success'
};

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function checkLabel(lp: LpEntry): string | null {
  if (lp.checkSizeMin == null && lp.checkSizeMax == null) return null;
  return `${lp.checkSizeMin != null ? money(lp.checkSizeMin) : '—'}–${lp.checkSizeMax != null ? money(lp.checkSizeMax) : '—'}`;
}

function LpCard({
  lp,
  onMove,
  pending
}: {
  lp: LpEntry;
  onMove: (stage: LpStageKey | 'passed') => void;
  pending: boolean;
}) {
  const check = checkLabel(lp);
  return (
    <div className="rounded-xl border border-hairline bg-bg-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 truncate text-[13px] font-semibold text-fg-1">{lp.name}</h4>
        {check ? (
          <span className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold tabular-nums text-gold-1">
            <CircleDollarSign size={11} strokeWidth={2} aria-hidden />
            {check}
          </span>
        ) : null}
      </div>

      {lp.capitalTypes.length > 0 ? (
        <p className="mt-0.5 truncate text-[11px] text-fg-4">
          {lp.capitalTypes.map(humanize).join(' · ')}
        </p>
      ) : null}

      {lp.fitRationale ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-fg-3">{lp.fitRationale}</p>
      ) : null}

      <div className="mt-2">
        <ProgressBar
          value={lp.fit}
          color="var(--azure-1)"
          height={5}
          ariaLabel={`${lp.name} progress`}
        />
      </div>

      {lp.assignedSpecialist ? (
        <p className="mt-2 inline-flex items-center gap-1 text-[10.5px] text-fg-5">
          <UserCog size={11} strokeWidth={1.9} className="text-azure-1" aria-hidden />
          {lp.assignedSpecialist}
        </p>
      ) : null}

      <div className="mt-2 border-t border-hairline pt-2">
        <Select
          aria-label={`Move ${lp.name} to a stage`}
          options={MOVE_OPTIONS}
          value={lp.stage}
          disabled={pending}
          onChange={(e) => onMove(e.target.value as LpStageKey | 'passed')}
          className="!py-1.5 text-[11.5px]"
        />
      </div>
    </div>
  );
}

export function LpPipelineBoard({ data }: { data: LpPipelineData }) {
  const router = useRouter();
  const [finderOpen, setFinderOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, LpStageKey | 'passed'>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const allLps = data.columns.flatMap((c) => c.lps);
  const stageOf = (lp: LpEntry): LpStageKey | 'passed' => overrides[lp.id] ?? lp.stage;

  function move(lp: LpEntry, stage: LpStageKey | 'passed') {
    if (stage === stageOf(lp)) return;
    setOverrides((o) => ({ ...o, [lp.id]: stage }));
    setPendingId(lp.id);
    startTransition(async () => {
      try {
        const res = await updateLpStage({ id: lp.id, stage });
        if (!res.ok) {
          setOverrides((o) => {
            const next = { ...o };
            delete next[lp.id];
            return next;
          });
        } else {
          router.refresh();
        }
      } finally {
        setPendingId(null);
      }
    });
  }

  if (data.empty && Object.keys(overrides).length === 0) {
    return (
      <>
        <Card className="relative overflow-hidden p-2">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(60% 120% at 0% 0%, rgba(247,201,72,0.07), transparent 60%), radial-gradient(50% 100% at 100% 0%, rgba(91,141,239,0.05), transparent 65%)'
            }}
          />
          <EmptyState
            icon={Users}
            title="Build your LP pipeline"
            body="Describe your raise and let AI surface matched LPs — family offices, fund-of-funds, endowments and more — then bring them in with an assigned outreach task."
            action={
              <Button variant="primary" icon={Sparkles} onClick={() => setFinderOpen(true)}>
                Find LPs with AI
              </Button>
            }
          />
        </Card>
        <LpFinder open={finderOpen} onClose={() => setFinderOpen(false)} />
      </>
    );
  }

  const stats: { label: string; value: string; tone: BadgeTone }[] = [
    { label: 'LPs', value: String(data.totalLps), tone: 'azure' },
    { label: 'Soft-circle', value: money(data.softCircledValue), tone: 'warning' },
    { label: 'Committed', value: money(data.committedValue), tone: 'success' }
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl border border-hairline bg-bg-1 text-gold-1">
            <Layers size={18} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-fg-1">LP Pipeline</h2>
            <p className="mt-0.5 text-[12px] text-fg-4">
              Move LPs from prospect to committed — find new ones with AI.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-bg-1 px-3 py-1.5"
            >
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-fg-5">{s.label}</span>
              <Badge tone={s.tone} className="tabular-nums text-[11px]">
                {s.value}
              </Badge>
            </div>
          ))}
          <Button variant="primary" icon={Sparkles} onClick={() => setFinderOpen(true)}>
            <span className="hidden sm:inline">Find LPs with AI</span>
            <span className="sm:hidden">Find LPs</span>
          </Button>
        </div>
      </Card>

      {/* Stage columns */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LP_STAGES.map((stage) => {
          const lps = allLps.filter((lp) => stageOf(lp) === stage.key);
          return (
            <div
              key={stage.key}
              className="flex flex-col rounded-2xl border border-hairline bg-surface-1 p-3"
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: `var(--${STAGE_TONE[stage.key]}, var(--fg-4))` }}
                    aria-hidden
                  />
                  {stage.label}
                </span>
                <Badge tone={STAGE_TONE[stage.key]} className="tabular-nums text-[10.5px]">
                  {lps.length}
                </Badge>
              </div>
              <div className="flex flex-col gap-2.5">
                {lps.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-hairline px-3 py-6 text-center text-[11px] text-fg-5">
                    No LPs here yet
                  </p>
                ) : (
                  lps.map((lp) => (
                    <LpCard
                      key={lp.id}
                      lp={lp}
                      pending={pendingId === lp.id}
                      onMove={(s) => move(lp, s)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <LpFinder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}

export default LpPipelineBoard;
