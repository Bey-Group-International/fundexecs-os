import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Scale, Calendar, User, Sparkles } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getStrategyData, type StrategyObjective } from '@/lib/queries/strategy';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { PRIORITY_TONE, STATE_TONE, TIER_COLOR, TIER_LABEL, TIER_ORDER, type Tier } from './ui';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Governance' },
  description: 'The 100·30·10 governance framework — objectives, owners, and execution health.'
};

const SUBTITLE = 'The 100 / 30 / 10 objective framework — strategy on the record';

function NoOrg({ identity }: { identity: Awaited<ReturnType<typeof getShellIdentity>> }) {
  return (
    <AppShell identity={identity} title="Governance" subtitle={SUBTITLE}>
      <Card className="p-10 text-center">
        <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
        <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
          Join or create an organization to put your strategy on the record with a 100 / 30 / 10
          governance plan.
        </p>
      </Card>
    </AppShell>
  );
}

function ObjectiveRow({ o }: { o: StrategyObjective }) {
  const color = TIER_COLOR[o.tier as Tier] ?? 'var(--fg-4)';
  const done = o.state === 'done';
  return (
    <div className="flex items-start gap-3 border-t border-hairline px-[18px] py-3.5 first:border-t-0">
      <span
        className="mt-0.5 flex-none rounded-md border bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
        style={{ color, borderColor: color }}
      >
        {o.tier}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={
            done
              ? 'text-[13.5px] font-semibold text-fg-2 line-through'
              : 'text-[13.5px] font-semibold text-fg-1'
          }
        >
          {o.title}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-fg-4">
          <span className="flex items-center gap-1.5">
            <Calendar size={12} strokeWidth={1.9} aria-hidden />
            {o.timeline ?? '—'}
          </span>
          {o.owner ? (
            <span className="flex items-center gap-1.5">
              <User size={12} strokeWidth={1.9} aria-hidden />
              {o.owner}
            </span>
          ) : null}
          <span className="tabular-nums">{o.pct}%</span>
        </div>
        {o.ai ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-[10px] border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2.5 py-1.5">
            <Sparkles
              size={12}
              strokeWidth={1.9}
              className="mt-px flex-none text-azure-1"
              aria-hidden
            />
            <span className="text-[11px] leading-relaxed text-fg-2">
              <span className="font-semibold text-azure-1">Earn:</span> {o.ai}
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-none flex-col items-end gap-1.5">
        <Badge tone={PRIORITY_TONE[o.priority]} className="text-[10px]">
          {o.priority}
        </Badge>
        {done ? (
          <Badge tone={STATE_TONE.done} className="text-[10px]">
            Done
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

export default async function GovernancePage() {
  const org = await getActiveOrg();
  const identity = await getShellIdentity();
  if (!org) return <NoOrg identity={identity} />;

  const { planName, objectives } = await getStrategyData(org.orgId);

  // Active objectives only (archived drop out of the governance register).
  const active = objectives.filter((o) => o.state !== 'archived');

  return (
    <AppShell identity={identity} title="Governance" subtitle={SUBTITLE}>
      <div className="flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle
            eyebrow="Deal execution"
            title={planName ? `Governance — ${planName}` : 'Governance plan'}
            className="mb-0"
          />
          <Link
            href="/strategy"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-hairline bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg-1 transition hover:bg-surface-3"
          >
            Edit in Strategy
            <ArrowUpRight size={16} strokeWidth={1.9} aria-hidden />
          </Link>
        </div>

        {active.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-surface-2">
              <Scale size={20} strokeWidth={1.8} className="text-fg-3" aria-hidden />
            </span>
            <h3 className="text-[15px] font-semibold text-fg-1">No governance objectives yet</h3>
            <p className="max-w-md text-[12.5px] leading-relaxed text-fg-4">
              The 100 / 30 / 10 framework puts your strategy on the record: 100-day bets, 30-day
              milestones, and 10-day moves — each with an owner and execution health.
            </p>
            <Link
              href="/strategy"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl border border-transparent bg-[var(--cta-gradient)] px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-cta)] transition hover:brightness-110"
            >
              Build the plan
              <ArrowUpRight size={16} strokeWidth={1.9} aria-hidden />
            </Link>
          </Card>
        ) : (
          <>
            {/* Horizon health board. */}
            <Card className="grid gap-6 p-[18px] sm:grid-cols-3">
              {TIER_ORDER.map((t) => {
                const list = active.filter((o) => o.tier === t);
                const avg = list.length
                  ? Math.round(list.reduce((s, o) => s + o.pct, 0) / list.length)
                  : 0;
                const doneCount = list.filter((o) => o.state === 'done').length;
                return (
                  <div key={t}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                        {TIER_LABEL[t]}
                      </span>
                    </div>
                    <div
                      className="my-2 text-[28px] font-semibold tabular-nums tracking-[-0.02em]"
                      style={{ color: TIER_COLOR[t] }}
                    >
                      {avg}%
                    </div>
                    <ProgressBar
                      value={avg}
                      color={TIER_COLOR[t]}
                      height={5}
                      ariaLabel={`Average completion for ${TIER_LABEL[t]}`}
                    />
                    <div className="mt-2 text-[11px] tabular-nums text-fg-4">
                      {doneCount}/{list.length} complete
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* Objective register, grouped by horizon. */}
            {TIER_ORDER.map((t) => {
              const list = active.filter((o) => o.tier === t);
              if (list.length === 0) return null;
              return (
                <div key={t} className="flex flex-col gap-2.5">
                  <SectionTitle
                    eyebrow={`${list.length} ${list.length === 1 ? 'objective' : 'objectives'}`}
                    title={TIER_LABEL[t]}
                    className="mb-0"
                  />
                  <Card className="p-0">
                    {list.map((o) => (
                      <ObjectiveRow key={o.id} o={o} />
                    ))}
                  </Card>
                </div>
              );
            })}
          </>
        )}
      </div>
    </AppShell>
  );
}
