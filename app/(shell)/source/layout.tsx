import { redirect } from 'next/navigation';
import { Radar } from 'lucide-react';
import { SourceHubTabs } from '@/components/hubs/SourceHubTabs';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { compactMoney } from '@/lib/format';
import { getLifecycleRail } from '@/lib/hubs';
import { getLpPipeline } from '@/lib/queries/lp-pipeline';
import { getActiveOrg } from '@/lib/queries/org';
import { getPipelineData } from '@/lib/queries/pipeline';
import { SRC_NOUN, SRC_NOUN_PLURAL, SRC_TITLE, sourceGroupFor } from '@/lib/source/vocab';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

/**
 * The Source hub shell — the prototype's SourceHub chrome around every module
 * route: hero with live readiness, the four stat tiles (committed /
 * soft-circled / LPs advanced / deals sourced, all real), the module tabs,
 * and Earn's standing note. The first tab's vocabulary adapts to the org's
 * type (the prototype's SRC_TITLE/SRC_NOUN), so an allocator reads
 * "Allocation targets" where a fund reads "LP Capital Map".
 */

const TONE_TEXT: Record<'success' | 'azure' | 'gold' | 'info', string> = {
  success: 'text-success',
  azure: 'text-azure-1',
  gold: 'text-gold-1',
  info: 'text-info'
};

function StatTile({
  label,
  value,
  sub,
  tone
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'success' | 'azure' | 'gold' | 'info';
}) {
  return (
    <div className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.08em] text-fg-5">{label}</div>
      <div className={cn('mt-0.5 text-[17px] font-semibold tabular-nums', TONE_TEXT[tone])}>
        {value}
      </div>
      <div className="text-[10.5px] text-fg-5">{sub}</div>
    </div>
  );
}

export default async function SourceHubLayout({ children }: { children: React.ReactNode }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const [lpPipeline, pipeline, rail, { data: orgRow }] = await Promise.all([
    getLpPipeline(org.orgId),
    getPipelineData(org.orgId),
    getLifecycleRail(org.orgId),
    supabase.from('organizations').select('type').eq('id', org.orgId).maybeSingle()
  ]);

  const group = sourceGroupFor(orgRow?.type);
  const noun = SRC_NOUN[group];
  const nounPlural = SRC_NOUN_PLURAL[group];
  const pct = rail.pct.source;

  const prospectCount = lpPipeline.columns.find((c) => c.key === 'prospect')?.lps.length ?? 0;
  const advanced = lpPipeline.totalLps - prospectCount;

  return (
    <div className="fx-rise mx-auto flex max-w-[980px] flex-col gap-4">
      {/* hero — the prototype's Source header with live readiness + stats */}
      <section className="rounded-2xl border border-hairline bg-bg-1 px-5 py-[18px]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Radar size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Source</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              The team finds your capital and deals. Approve a move and it advances here.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{pct}%</div>
            <div className="text-[10.5px] text-fg-5">Source ready</div>
          </div>
        </div>
        <div className="mb-4 mt-3.5">
          <ProgressBar value={pct} height={6} tone="gold" label="Source readiness" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile
            label="Committed"
            value={compactMoney(lpPipeline.committedValue)}
            sub="closed allocations"
            tone="success"
          />
          <StatTile
            label="Soft-circled"
            value={compactMoney(lpPipeline.softCircledValue)}
            sub="near-term"
            tone="gold"
          />
          <StatTile
            label={`${nounPlural} advanced`}
            value={`${advanced}/${lpPipeline.totalLps}`}
            sub="past first touch"
            tone="azure"
          />
          <StatTile
            label="Deals sourced"
            value={`${pipeline.totalDeals}`}
            sub="on-thesis, scored"
            tone="info"
          />
        </div>
      </section>

      <SourceHubTabs lpLabel={SRC_TITLE[group]} />

      {children}

      {/* Earn's standing note — the prototype's closing strip */}
      <section className="flex items-center gap-3 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> I rank every {noun} and deal by fit and momentum. Tap
          any move — I draft it, you approve, it advances.
        </p>
      </section>
    </div>
  );
}
