import {
  Briefcase,
  Coins,
  Radar,
  Sparkles,
  Users,
  Handshake,
  Zap,
  ArrowUpRight,
  type LucideIcon
} from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { Sparkline } from '@/components/dashboard/Sparkline';
import {
  EarnBriefingBand,
  type EarnBriefingPriority
} from '@/components/dashboard/EarnBriefingBand';
import { SynergyAlertsFeed, type SynergyAlert } from '@/components/dashboard/SynergyAlertsFeed';
import { FundReadinessPath } from '@/components/dashboard/FundReadinessPath';
import {
  DealFlowTable,
  type DealFlowRow,
  type DealFlowStage
} from '@/components/dashboard/DealFlowTable';
import type { NextBestAction } from '@/components/dashboard/EarnNextBestActions';
import type { ChainOfTrustStanding } from '@/components/dashboard/ChainOfTrustStrip';
import { MemberDashboardChrome } from './MemberDashboardChrome';
import { buildLifecyclePath } from '@/components/dashboard/fixtures/lifecycle';
import {
  DEFAULT_PERSONA_ACTIVITY,
  PERSONAS,
  type PersonaActivityRow
} from '@/components/dashboard/fixtures/personas';
import type { InvestmentFirmData } from '@/lib/queries/dashboard';

function money(n: number): string {
  if (!n) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

/** Deterministic placeholder sparkline curves (one per KPI tone). The shape
 *  matters more than the values — these are intentionally not random so SSR
 *  is stable. */
const SPARK_PIPELINE = [12, 14, 13, 16, 18, 17, 20, 22, 21, 24];
const SPARK_DEALS = [4, 5, 5, 6, 6, 7, 7, 8, 7, 9];
const SPARK_DEPLOYED = [2, 3, 3, 4, 5, 5, 6, 7, 8, 9];
const SPARK_SOURCING = [3, 4, 5, 4, 6, 7, 8, 8, 9, 11];

function buildActions(data: InvestmentFirmData): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const stuckDiligence = data.deals.find((d) => d.stage === 'diligence');
  if (stuckDiligence) {
    actions.push({
      id: 'advance-diligence',
      title: `Advance ${stuckDiligence.name}`,
      context: 'Diligence is the slowest stage — unblock the next milestone.',
      cta: 'Open in Pipeline',
      href: '/pipeline',
      icon: Radar as LucideIcon,
      tone: 'azure'
    });
  }
  if (data.kpis.capitalDeployed === 0) {
    actions.push({
      id: 'log-allocations',
      title: 'Log this month’s allocations',
      context: 'Track committed capital so the Chain of Trust reflects the work.',
      cta: 'Open Pipeline',
      href: '/pipeline',
      icon: Coins as LucideIcon,
      tone: 'success'
    });
  }
  if (data.capitalProviders.length < 3) {
    actions.push({
      id: 'expand-lps',
      title: 'Expand your LP roster',
      context: 'Connect more capital providers so Earn can match deals faster.',
      cta: 'Open Connections',
      href: '/connections',
      icon: Users as LucideIcon,
      tone: 'azure'
    });
  }
  actions.push({
    id: 'ask-earn',
    title: 'Ask Earn for an IC briefing',
    context: 'Get a one-page summary of where every active deal sits — audit-ready.',
    cta: 'Open Ask Earn',
    href: '/ask-earn',
    icon: Sparkles as LucideIcon,
    tone: 'gold'
  });
  return actions.slice(0, 5);
}

/** Map the live-data deal rows onto the prototype's flagship DealFlowTable. */
function buildDealRows(data: InvestmentFirmData): DealFlowRow[] {
  const SECTORS = [
    'Capital formation',
    'Healthcare',
    'Climate',
    'Fintech',
    'Logistics',
    'Industrials'
  ];
  return data.deals.slice(0, 8).map(
    (d, idx): DealFlowRow => ({
      id: d.id,
      name: d.name,
      stage: (d.stage as DealFlowStage) ?? 'sourcing',
      size: typeof d.amount === 'number' && d.amount > 0 ? money(d.amount) : '—',
      sector: SECTORS[idx % SECTORS.length],
      lastTouch: ['Today', '2d ago', '4d ago', 'This week', '1w ago'][idx % 5],
      href: '/pipeline'
    })
  );
}

/** Build Earn briefing priorities heuristically from the live data. The
 *  layout always renders 3 ranked rows — Earn never goes silent. */
function buildBriefingPriorities(data: InvestmentFirmData): EarnBriefingPriority[] {
  const ranked: EarnBriefingPriority[] = [];
  const diligence = data.deals.find((d) => d.stage === 'diligence');
  if (diligence) {
    ranked.push({
      id: 'priority-diligence',
      title: `Unblock ${diligence.name}`,
      context: 'A diligence position has gone two days without a touch — push the next milestone.',
      impact: diligence.amount
        ? `High impact · ~${money(diligence.amount)} at stake`
        : 'High impact',
      brain: 'Capital Markets · Priya',
      icon: Radar,
      tone: 'azure',
      href: '/pipeline',
      cta: 'Open in Pipeline'
    });
  }
  if (data.capitalProviders.length < 3) {
    ranked.push({
      id: 'priority-lp-roster',
      title: 'Expand the LP roster',
      context:
        'Map two more institutional allocators so Eleanor can warm them ahead of next close.',
      impact: 'Pipeline · long-term',
      brain: 'Investor Relations · Eleanor',
      icon: Users,
      tone: 'gold',
      href: '/connections',
      cta: 'Open Connections'
    });
  }
  if (data.partnerships.length === 0) {
    ranked.push({
      id: 'priority-partnerships',
      title: 'Activate a co-investor partnership',
      context: 'No active partnerships — warm one tier-1 co-investor this week.',
      impact: 'Network leverage',
      brain: 'Capital Formation · Sloane',
      icon: Handshake,
      tone: 'success',
      href: '/connections',
      cta: 'Open Connections'
    });
  }
  // Always end with the audit-ready synthesis priority.
  ranked.push({
    id: 'priority-ic-briefing',
    title: 'Pressure-test this week’s IC pack',
    context: 'Earn will rebuild the one-pager from your live data — citations included.',
    impact: 'Decision-ready',
    brain: 'Strategy · Theodore',
    icon: Sparkles,
    tone: 'gold',
    href: '/ask-earn',
    cta: 'Open Ask Earn'
  });
  return ranked.slice(0, 3);
}

/** Synthesize ambient synergy alerts from the activity-ticker fixture. The
 *  shape exactly mirrors the live www.fundexecs.com homepage ticker. */
function buildSynergyAlerts(rows: PersonaActivityRow[]): SynergyAlert[] {
  return rows.slice(0, 7).map(
    (row, idx): SynergyAlert => ({
      id: row.id,
      title: `${row.action} · ${row.initials}`,
      context: `${PERSONAS[row.persona].label} · ${row.city}${
        row.amount ? ` · ${row.amount}` : ''
      }`,
      when: row.when,
      source: PERSONAS[row.persona].hint,
      icon: Zap,
      tone: idx === 0 ? 'gold' : idx % 3 === 0 ? 'success' : 'azure',
      href: '/connections'
    })
  );
}

export interface InvestmentFirmLayoutProps {
  displayName: string;
  position: string;
  trust: ChainOfTrustStanding;
  load: { data: InvestmentFirmData | null; empty: boolean; error?: string };
  /** Override the Earn briefing band priorities — backend can wire this once
   *  the ranked-priority service ships. Defaults to a heuristic build from
   *  `load.data`. */
  briefingPriorities?: EarnBriefingPriority[];
  /** Override the ambient synergy alerts feed. Defaults to anonymized
   *  activity-ticker rows that mirror the live homepage. */
  synergyAlerts?: SynergyAlert[];
  /** Currently-active step in the four-step lifecycle (0=mandate, 1=source &
   *  raise, 2=analyze & package, 3=communicate & close). Defaults to 1. */
  lifecycleActiveIndex?: number;
  /** Percent complete for the active lifecycle stage (0–100). Defaults 60. */
  lifecycleActivePct?: number;
  /** Overall fund-readiness percent shown in the right-aligned header. */
  fundReadinessPct?: number;
}

/**
 * InvestmentFirmLayout — flagship dashboard. Composes:
 *   1. Member chrome (CoT hero + greeting + Earn next-best-actions rail)
 *   2. EarnBriefingBand with three ranked priorities and audit caption
 *   3. Four KPI tiles with tone-matched sparklines
 *   4. Fund Readiness path — live's four-step lifecycle (mandate → source →
 *      package → close), orthogonal to the CoT proof layers
 *   5. DealFlowTable (denser logo-disc rows)
 *   6. SynergyAlertsFeed (live-ticker style, "Live" pulse dot)
 *   7. Ecosystem panels — LP roster + active partnerships
 *
 * All flagship sections are prop-driven with sensible defaults so the layout
 * renders fully even before the backend wires real briefing / synergy data.
 */
export function InvestmentFirmLayout({
  displayName,
  position,
  trust,
  load,
  briefingPriorities,
  synergyAlerts,
  lifecycleActiveIndex = 1,
  lifecycleActivePct = 62,
  fundReadinessPct = 58
}: InvestmentFirmLayoutProps) {
  if (load.error) {
    return (
      <MemberDashboardChrome
        displayName={displayName}
        position={position}
        trust={trust}
        actions={[]}
      >
        <Card className="p-8 text-center">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-warning">
            Dashboard error
          </p>
          <p className="mt-2 text-[13px] text-fg-2">{load.error}</p>
          <p className="mt-1 text-[11.5px] text-fg-4">Refresh to retry, or open Ask Earn.</p>
        </Card>
      </MemberDashboardChrome>
    );
  }

  const data = load.data;
  const actions = data ? buildActions(data) : [];
  const priorities = briefingPriorities ?? (data ? buildBriefingPriorities(data) : []);
  const dealRows = data ? buildDealRows(data) : [];
  const alerts = synergyAlerts ?? buildSynergyAlerts(DEFAULT_PERSONA_ACTIVITY);
  const lifecycle = buildLifecyclePath(lifecycleActiveIndex, lifecycleActivePct);

  return (
    <MemberDashboardChrome
      displayName={displayName}
      position={position}
      trust={trust}
      actions={actions}
    >
      <div className="flex flex-col gap-[18px]" data-testid="investment-firm-layout">
        {/* 1) Earn briefing band — gold-glow coin + 3 ranked priorities */}
        <EarnBriefingBand displayName={displayName} priorities={priorities} />

        {/* 2) KPI tiles with sparklines */}
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTileWithSpark
            label="Pipeline value"
            value={money(data?.kpis.pipelineValue ?? 0)}
            sub="All active opportunities"
            icon={Briefcase}
            tone="azure"
            spark={SPARK_PIPELINE}
          />
          <KpiTileWithSpark
            label="Active deals"
            value={String(data?.kpis.activeDeals ?? 0)}
            sub="Across all stages"
            icon={Radar}
            tone="azure"
            spark={SPARK_DEALS}
          />
          <KpiTileWithSpark
            label="Capital deployed"
            value={money(data?.kpis.capitalDeployed ?? 0)}
            sub="Accepted + funded"
            icon={Coins}
            tone="success"
            spark={SPARK_DEPLOYED}
          />
          <KpiTileWithSpark
            label="Sourced last 30d"
            value={String(data?.kpis.sourcingThisMonth ?? 0)}
            sub="New deals opened"
            icon={Sparkles}
            tone="gold"
            spark={SPARK_SOURCING}
          />
        </div>

        {/* 3) Fund Readiness path (live's 4-step lifecycle) */}
        <FundReadinessPath stages={lifecycle} overallPct={fundReadinessPct} />

        {/* 4) Deal flow + 5) Synergy alerts feed — flagship two-column block */}
        <div className="grid gap-[18px] lg:grid-cols-[1.55fr_1fr]">
          <DealFlowTable rows={dealRows} />
          <SynergyAlertsFeed alerts={alerts} />
        </div>

        {/* 6) Ecosystem panels */}
        <div className="grid gap-[18px] lg:grid-cols-2">
          <Card>
            <SectionTitle eyebrow="Capital" title="LP roster" className="mb-3" />
            {data && data.capitalProviders.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.capitalProviders.map((cp) => (
                  <li
                    key={cp.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5 transition-colors hover:bg-surface-1"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{cp.name}</span>
                    <Badge tone="azure" className="text-[10px]">
                      LP
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No LPs mapped"
                body="Connect capital providers so Earn — and Eleanor — can warm them ahead of next close."
                href="/connections"
                cta="Open Connections"
              />
            )}
          </Card>

          <Card>
            <SectionTitle eyebrow="Co-investors" title="Active partnerships" className="mb-3" />
            {data && data.partnerships.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.partnerships.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5 transition-colors hover:bg-surface-1"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{p.counterparty}</span>
                    <Badge tone="neutral" className="text-[10px] uppercase">
                      {p.stage ?? '—'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No partnerships yet"
                body="Activate a co-investor so capital stays warm and audit-ready."
                href="/connections"
                cta="Add partnerships"
              />
            )}
          </Card>
        </div>
      </div>
    </MemberDashboardChrome>
  );
}

/** KpiTile + tone-matched sparkline composed inline so existing `KpiTile`
 *  primitive stays single-responsibility. */
function KpiTileWithSpark({
  label,
  value,
  sub,
  icon,
  tone,
  spark
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone: 'azure' | 'gold' | 'success' | 'warning' | 'neutral';
  spark: number[];
}) {
  return (
    <div className="relative h-full">
      <KpiTile label={label} value={value} sub={sub} icon={icon} tone={tone} />
      <div className="pointer-events-none absolute inset-x-3 bottom-2 opacity-90">
        <Sparkline
          points={spark}
          tone={tone === 'neutral' ? 'azure' : tone}
          height={22}
          ariaLabel={`${label} trend`}
        />
      </div>
    </div>
  );
}

function EmptyHint({
  title,
  body,
  href,
  cta
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-5 text-center">
      <p className="text-[12.5px] font-medium text-fg-2">{title}</p>
      <p className="mt-1 text-[11.5px] text-fg-4">{body}</p>
      <a
        href={href}
        className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-azure-1 hover:underline"
      >
        {cta}
        <ArrowUpRight size={11} strokeWidth={2} aria-hidden />
      </a>
    </div>
  );
}
