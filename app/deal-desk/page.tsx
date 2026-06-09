import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Briefcase, Target, TrendingUp, Layers, Radar } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getPipelineData, type PipelineDeal, type PipelineStage } from '@/lib/queries/pipeline';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { formatCompactUsd, fitTone, stageColor } from './ui';

/* ----------------------------------------------------------------------------
 * The Deal Desk is a single route with two honest views, selected by `?view`:
 *
 *   • sourcing  (Source › Deals)     — screen the incoming flow, top of funnel
 *   • execution (Drive › Deal Desk)  — drive the live deals to close [default]
 *
 * Both are a UI lens over the same `getPipelineData` book — no extra queries.
 * The desk decides; the pipeline board operates, so every deal deep-links into
 * the board's detail drawer (`/pipeline?deal=<id>`) rather than dead-ending.
 * --------------------------------------------------------------------------*/

type DeskView = 'sourcing' | 'execution';

/** Top-of-funnel stages owned by the Sourcing view. */
const SOURCING_STAGE_KEYS = new Set(['visitor', 'prospect', 'qualified', 'meeting']);
/** Live, in-flight stages owned by the Execution view. */
const EXECUTION_STAGE_KEYS = new Set(['diligence', 'soft-circle', 'committed', 'closed']);

function resolveView(view: string | string[] | undefined): DeskView {
  const raw = Array.isArray(view) ? view[0] : view;
  return raw === 'sourcing' ? 'sourcing' : 'execution';
}

interface ViewCopy {
  navTitle: string;
  subtitle: string;
  eyebrow: string;
  heading: string;
  listEyebrow: string;
  listTitle: string;
  funnelTitle: string;
  emptyTitle: string;
  emptyBody: string;
}

const VIEW_COPY: Record<DeskView, ViewCopy> = {
  sourcing: {
    navTitle: 'Deals',
    subtitle: 'Source, screen, qualify — triage incoming deal flow',
    eyebrow: 'Sourcing',
    heading: 'Deals to screen',
    listEyebrow: 'Ranked by thesis-fit',
    listTitle: 'Screen next',
    funnelTitle: 'Sourcing funnel',
    emptyTitle: 'No deals to screen yet',
    emptyBody:
      'New inbound opportunities land here first — ranked by thesis-fit so you screen the strongest fits before anything goes stale. Add your first deal from the pipeline board.'
  },
  execution: {
    navTitle: 'Deal Desk',
    subtitle: 'Decide and drive — work the live deals to close',
    eyebrow: 'Deal execution',
    heading: 'The desk',
    listEyebrow: 'Ranked by thesis-fit',
    listTitle: 'Live deals',
    funnelTitle: 'Formation funnel',
    emptyTitle: 'No live deals on the desk yet',
    emptyBody:
      'Deals in diligence and beyond surface here — ranked by thesis-fit, with stage and live capital — so you can drive each one to close. Advance a deal from the pipeline board to begin.'
  }
};

export async function generateMetadata({
  searchParams
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}): Promise<Metadata> {
  const view = resolveView((await searchParams).view);
  return {
    title: { absolute: `FundExecs OS — ${VIEW_COPY[view].navTitle}` },
    description:
      view === 'sourcing'
        ? 'Source and screen incoming deal flow — triage the strongest fits first.'
        : 'The investment-opportunity desk — decide and drive live deals to close.'
  };
}

/** A Next Link styled as a secondary Button (Button is a native <button>, so
 *  we render a matching anchor for navigation CTAs). */
function LinkButton({
  href,
  children,
  variant = 'secondary'
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition';
  const tone =
    variant === 'primary'
      ? 'bg-[var(--cta-gradient)] text-white border border-transparent shadow-[var(--shadow-cta)] hover:brightness-110'
      : 'bg-surface-2 text-fg-1 border border-hairline hover:bg-surface-3';
  return (
    <Link href={href} className={`${base} ${tone}`}>
      {children}
      <ArrowUpRight size={16} strokeWidth={1.9} aria-hidden />
    </Link>
  );
}

/** Source → Drive flow switch. Server-rendered links so the desk has no client
 *  cost; the active mode reads from `?view`. */
function ViewTabs({ view }: { view: DeskView }) {
  const tabs: Array<{ id: DeskView; label: string; href: string; icon: typeof Radar }> = [
    { id: 'sourcing', label: 'Sourcing', href: '/deal-desk?view=sourcing', icon: Radar },
    { id: 'execution', label: 'Execution', href: '/deal-desk?view=execution', icon: Briefcase }
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-hairline bg-surface-2 p-1">
      {tabs.map(({ id, label, href, icon: Icon }) => {
        const active = id === view;
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
              active
                ? 'bg-surface-1 text-fg-1 shadow-[var(--shadow-sm)]'
                : 'text-fg-4 hover:text-fg-2'
            }`}
          >
            <Icon size={13} strokeWidth={2} aria-hidden />
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function NoOrg({
  identity,
  view
}: {
  identity: Awaited<ReturnType<typeof getShellIdentity>>;
  view: DeskView;
}) {
  const copy = VIEW_COPY[view];
  return (
    <AppShell identity={identity} title={copy.navTitle} subtitle={copy.subtitle}>
      <Card className="p-10 text-center">
        <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
        <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
          Join or create an organization to start sourcing, screening, and deciding on deals from a
          single desk.
        </p>
      </Card>
    </AppShell>
  );
}

interface Kpi {
  label: string;
  value: string;
  icon: typeof Briefcase;
  hint: string;
}

/** Build the four KPIs for a view from its own slice of the book. */
function buildKpis(
  view: DeskView,
  data: Awaited<ReturnType<typeof getPipelineData>>,
  viewStages: PipelineStage[],
  viewDeals: PipelineDeal[]
): Kpi[] {
  const value = viewDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const avgFit = viewDeals.length
    ? Math.round(viewDeals.reduce((sum, d) => sum + d.fit, 0) / viewDeals.length)
    : 0;
  const countOf = (key: string) => viewStages.find((s) => s.key === key)?.deals.length ?? 0;

  if (view === 'sourcing') {
    return [
      {
        label: 'To screen',
        value: `${viewDeals.length}`,
        icon: Briefcase,
        hint: 'Awaiting qualification'
      },
      {
        label: 'New inbound',
        value: `${countOf('visitor') + countOf('prospect')}`,
        icon: Radar,
        hint: 'Fresh in the funnel'
      },
      {
        label: 'Sourcing value',
        value: formatCompactUsd(value),
        icon: Layers,
        hint: 'Across deals in screening'
      },
      { label: 'Avg thesis-fit', value: `${avgFit}`, icon: Target, hint: 'Across sourced deals' }
    ];
  }

  return [
    {
      label: 'Live value',
      value: formatCompactUsd(value),
      icon: Briefcase,
      hint: `${viewDeals.length} ${viewDeals.length === 1 ? 'deal' : 'deals'} in flight`
    },
    {
      label: 'Soft-circled',
      value: formatCompactUsd(data.softCircled),
      icon: Layers,
      hint: 'Indicated interest'
    },
    {
      label: 'Committed',
      value: formatCompactUsd(data.committed),
      icon: TrendingUp,
      hint: `${data.conversionPct}% conversion`
    },
    { label: 'Avg thesis-fit', value: `${avgFit}`, icon: Target, hint: 'Across live deals' }
  ];
}

export default async function DealDeskPage({
  searchParams
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const view = resolveView((await searchParams).view);
  const copy = VIEW_COPY[view];

  const org = await getActiveOrg();
  const identity = await getShellIdentity();
  if (!org) return <NoOrg identity={identity} view={view} />;

  const data = await getPipelineData(org.orgId);

  // Slice the shared book down to the stages this view owns.
  const keys = view === 'sourcing' ? SOURCING_STAGE_KEYS : EXECUTION_STAGE_KEYS;
  const viewStages = data.stages.filter((s) => keys.has(s.key));
  const viewDeals = viewStages.flatMap((s) => s.deals);

  // Ranked register — strongest thesis-fit first, then size.
  const rankedDeals: PipelineDeal[] = viewStages
    .flatMap((s) => s.deals)
    .sort((a, b) => b.fit - a.fit || (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, 8);

  const stageLabelByDealId = new Map<string, string>();
  for (const s of viewStages) for (const d of s.deals) stageLabelByDealId.set(d.id, s.label);

  const peakStageCount = viewStages.reduce((m, s) => Math.max(m, s.deals.length), 0);
  const kpis = buildKpis(view, data, viewStages, viewDeals);

  return (
    <AppShell identity={identity} title={copy.navTitle} subtitle={copy.subtitle}>
      <div className="flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle eyebrow={copy.eyebrow} title={copy.heading} className="mb-0" />
          <div className="flex items-center gap-2.5">
            <ViewTabs view={view} />
            <LinkButton href="/pipeline">Open pipeline board</LinkButton>
          </div>
        </div>

        {/* Hero KPI strip — bold, gradient-washed, tabular figures. */}
        <Card className="grid gap-px overflow-hidden bg-hairline p-0 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map(({ label, value, icon: Icon, hint }) => (
            <div
              key={label}
              className="bg-[linear-gradient(150deg,rgba(91,141,239,0.06),transparent_62%)] bg-surface-1 p-[18px]"
            >
              <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                <Icon size={13} strokeWidth={2} aria-hidden />
                {label}
              </div>
              <div className="mt-2.5 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                {value}
              </div>
              <div className="mt-1 text-[11.5px] text-fg-4">{hint}</div>
            </div>
          ))}
        </Card>

        {viewDeals.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-surface-2">
              <Briefcase size={20} strokeWidth={1.8} className="text-fg-3" aria-hidden />
            </span>
            <h3 className="text-[15px] font-semibold text-fg-1">{copy.emptyTitle}</h3>
            <p className="max-w-md text-[12.5px] leading-relaxed text-fg-4">{copy.emptyBody}</p>
            <LinkButton href="/pipeline" variant="primary">
              Open pipeline board
            </LinkButton>
          </Card>
        ) : (
          <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Ranked deal register — strongest thesis-fit first. */}
            <div className="flex flex-col gap-2.5">
              <SectionTitle eyebrow={copy.listEyebrow} title={copy.listTitle} className="mb-0" />
              {rankedDeals.map((d) => {
                const tone = fitTone(d.fit);
                return (
                  <Link key={d.id} href={`/pipeline?deal=${d.id}`} className="block">
                    <Card clickable className="flex items-center gap-4 p-4">
                      <div
                        className="flex h-11 w-11 flex-none flex-col items-center justify-center rounded-xl border tabular-nums"
                        style={{
                          color: 'var(--gold-1)',
                          borderColor: 'var(--gold-line)',
                          background: 'var(--gold-soft)'
                        }}
                      >
                        <span className="text-[15px] font-semibold leading-none">{d.fit}</span>
                        <span className="mt-0.5 text-[8px] uppercase tracking-wide text-fg-4">
                          fit
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold text-fg-1">
                          {d.name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-4">
                          <Badge tone={tone} className="text-[10px]">
                            {stageLabelByDealId.get(d.id) ?? d.stage}
                          </Badge>
                          <span>{d.note}</span>
                          {d.diligenceRuns.length > 0 ? (
                            <span className="tabular-nums">
                              {d.diligenceRuns.length}{' '}
                              {d.diligenceRuns.length === 1 ? 'IC run' : 'IC runs'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex-none text-right">
                        <div className="text-[13.5px] font-semibold tabular-nums text-fg-1">
                          {d.amount != null ? formatCompactUsd(d.amount) : '—'}
                        </div>
                        {d.allocations.length > 0 ? (
                          <div className="mt-0.5 text-[10.5px] text-fg-4">
                            {d.allocations.length}{' '}
                            {d.allocations.length === 1 ? 'allocation' : 'allocations'}
                          </div>
                        ) : null}
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>

            {/* Funnel rail — stage distribution with proportional bars. */}
            <Card className="h-fit p-[18px]">
              <div className="mb-3.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                {copy.funnelTitle}
              </div>
              <div className="flex flex-col gap-3">
                {viewStages.map((s, i) => {
                  const color = stageColor(i, viewStages.length);
                  const pct = peakStageCount ? (s.deals.length / peakStageCount) * 100 : 0;
                  return (
                    <div key={s.key}>
                      <div className="flex items-baseline justify-between text-[11.5px]">
                        <span className="font-medium text-fg-2">{s.label}</span>
                        <span className="tabular-nums text-fg-4">{s.deals.length}</span>
                      </div>
                      <ProgressBar
                        value={pct}
                        color={color}
                        height={6}
                        className="mt-1.5"
                        ariaLabel={`${s.deals.length} deals in ${s.label}`}
                      />
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
