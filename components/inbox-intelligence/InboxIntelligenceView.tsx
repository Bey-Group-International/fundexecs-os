'use client';

import { useMemo, useState } from 'react';
import {
  Radar,
  Activity,
  ShieldAlert,
  TriangleAlert,
  Info,
  Building2,
  CircleDollarSign,
  Clock,
  ChevronRight,
  Sparkles,
  Newspaper,
  type LucideIcon
} from 'lucide-react';
import { Badge, Card, SectionTitle, SegTabs, type BadgeTone, type TabItem } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import {
  ConfidenceMeter,
  FactorBreakdown,
  LearningIndicator,
  SpecialistRoute
} from '@/components/intelligence';
import { TeamAvatar, getMemberByFirstName } from '@/lib/team';
import {
  matchConfidence,
  type IntelligenceCalibration
} from '@/lib/queries/intelligence-calibration';
import { cn } from '@/lib/utils';
import type {
  InboxIntelligenceData,
  IntelligenceBriefing,
  MarketSignal,
  SignalMatch,
  SignalSeverity
} from '@/lib/queries/inbox-intelligence';

/* ---- Helpers ------------------------------------------------------------ */

function humanize(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function money(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SEVERITY_META: Record<string, { tone: BadgeTone; icon: LucideIcon; label: string }> = {
  critical: { tone: 'danger', icon: ShieldAlert, label: 'Critical' },
  warning: { tone: 'warning', icon: TriangleAlert, label: 'Warning' },
  info: { tone: 'info', icon: Info, label: 'Info' }
};

function severityMeta(severity: SignalSeverity) {
  return (
    SEVERITY_META[severity] ?? {
      tone: 'neutral' as BadgeTone,
      icon: Info,
      label: humanize(severity)
    }
  );
}

function scoreTone(score: number): BadgeTone {
  if (score >= 75) return 'success';
  if (score >= 50) return 'gold';
  if (score >= 25) return 'warning';
  return 'neutral';
}

/** Best-effort title from a signal's normalized payload. */
function signalTitle(signal: MarketSignal): string {
  const n = signal.normalized;
  const candidates = [
    n.issuer_name,
    n.entity_name,
    n.company_name,
    n.fund_name,
    n.title,
    n.summary
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return humanize(signal.kind);
}

function signalSubtitle(signal: MarketSignal): string | null {
  const n = signal.normalized;
  const parts: string[] = [];
  for (const key of ['industry', 'sector', 'strategy', 'geography', 'region']) {
    const v = n[key];
    if (typeof v === 'string' && v.trim()) parts.push(humanize(v.trim()));
  }
  return parts.length ? parts.slice(0, 3).join(' · ') : null;
}

function signalAmount(signal: MarketSignal): string | null {
  const n = signal.normalized;
  return (
    money(n.offering_amount) ??
    money(n.total_offering_amount) ??
    money(n.amount) ??
    money(n.fund_size)
  );
}

/* ---- Specialist routing chip -------------------------------------------- */

function RoutedSpecialist({ name }: { name: string | null }) {
  const member = getMemberByFirstName(name);
  if (!member) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-bg-1 py-0.5 pl-0.5 pr-2.5">
      <TeamAvatar member={member} size={18} />
      <span className="text-[11px] font-medium text-fg-3">
        Routed to <span className="text-fg-2">{member.name}</span>
      </span>
    </span>
  );
}

/* ---- Daily briefing card ------------------------------------------------ */

function BriefingCard({ briefing }: { briefing: IntelligenceBriefing }) {
  const eleanor = getMemberByFirstName('Eleanor');
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
        <Newspaper size={16} strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-1">
            <Sparkles size={11} strokeWidth={2} aria-hidden />
            Daily briefing
          </p>
          {briefing.matchCount > 0 ? (
            <Badge tone="gold" className="text-[10px]">
              {briefing.matchCount} {briefing.matchCount === 1 ? 'match' : 'matches'}
            </Badge>
          ) : null}
          {briefing.generatedAt ? (
            <span className="text-[10.5px] text-fg-5">{relativeTime(briefing.generatedAt)}</span>
          ) : null}
          {eleanor ? (
            <span className="ml-auto inline-flex items-center gap-1.5">
              <TeamAvatar member={eleanor} size={16} />
              <span className="text-[10.5px] text-fg-4">{eleanor.name}</span>
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{briefing.body}</p>
      </div>
    </Card>
  );
}

/* ---- Severity / source rail -------------------------------------------- */

function SignalGlyph({ signal }: { signal: MarketSignal }) {
  const meta = severityMeta(signal.severity);
  const Icon = meta.icon;
  const ring =
    meta.tone === 'danger'
      ? 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger'
      : meta.tone === 'warning'
        ? 'border-[var(--warning-line)] bg-[var(--warning-soft)] text-warning'
        : 'border-[var(--info-line)] bg-[var(--info-soft)] text-info';
  return (
    <span
      className={cn('flex h-9 w-9 flex-none items-center justify-center rounded-xl border', ring)}
      aria-hidden
    >
      <Icon size={16} strokeWidth={2} />
    </span>
  );
}

/* ---- Scored match card --------------------------------------------------- */

function MatchCard({
  match,
  calibration
}: {
  match: SignalMatch;
  calibration: IntelligenceCalibration;
}) {
  const [open, setOpen] = useState(false);
  const signal = match.signal;
  const title = signal ? signalTitle(signal) : 'Routed signal';
  const subtitle = signal ? signalSubtitle(signal) : null;
  const amount = signal ? signalAmount(signal) : null;
  const sev = signal ? severityMeta(signal.severity) : null;
  const judge = match.factors.find((f) => f.factor === 'ai_judge');
  const breakdown = match.factors
    .filter((f) => f.factor !== 'match_reason' && f.factor !== 'ai_judge')
    .map((f) => ({
      factor: f.factor,
      weight: f.weight,
      multiplier: f.multiplier ?? undefined,
      detail: f.detail
    }));
  const confidence = matchConfidence(judge?.confidence ?? match.score, calibration);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        {signal ? <SignalGlyph signal={signal} /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-fg-1">{title}</h3>
            {sev ? (
              <Badge tone={sev.tone} className="text-[10px]">
                {sev.label}
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-4">
            {signal ? <span>{humanize(signal.kind)}</span> : null}
            {subtitle ? (
              <>
                <span className="text-fg-5" aria-hidden>
                  ·
                </span>
                <span>{subtitle}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <Badge tone={scoreTone(match.score)} className="tabular-nums text-[11px]">
            {match.score}
            <span className="font-normal text-fg-5">/100</span>
          </Badge>
          {signal ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-5">
              <Clock size={10} strokeWidth={2} aria-hidden />
              {relativeTime(signal.capturedAt)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {amount ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-0.5 text-[11px] font-medium text-gold-1">
            <CircleDollarSign size={12} strokeWidth={2} aria-hidden />
            {amount}
          </span>
        ) : null}
        {signal ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] text-fg-3">
            <Building2 size={12} strokeWidth={1.9} aria-hidden />
            {humanize(signal.source)}
          </span>
        ) : null}
        <SpecialistRoute
          name={match.routedSpecialist}
          nextAction={{ label: 'Brief me', href: '/ask-earn' }}
        />
      </div>

      <div className="grid gap-3 border-t border-hairline pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <FactorBreakdown factors={breakdown} />
        <ConfidenceMeter
          value={confidence.value}
          band={confidence.band}
          className="w-full sm:w-40"
        />
      </div>

      {judge?.detail ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-2">
          <Sparkles size={13} strokeWidth={2} className="mt-px flex-none text-gold-1" aria-hidden />
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-fg-3">
            <span className="font-semibold text-fg-2">{specialistVerdictLabel(match)}:</span>{' '}
            {judge.detail}
          </span>
        </div>
      ) : breakdown.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
        >
          <ChevronRight
            size={13}
            strokeWidth={2.2}
            aria-hidden
            className={cn('transition-transform', open && 'rotate-90')}
          />
          {open ? 'Hide factor detail' : 'Factor detail'}
        </button>
      ) : null}

      {open && !judge?.detail ? (
        <ul className="grid gap-1.5">
          {breakdown.map((f) => (
            <li
              key={f.factor}
              className="flex items-start gap-2.5 rounded-lg border border-hairline bg-bg-1 px-2.5 py-2"
            >
              <span className="mt-px inline-flex min-w-9 justify-center rounded-md border border-hairline bg-surface-1 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-fg-3">
                +{f.weight}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-[11px] font-semibold text-fg-2">{humanize(f.factor)}</span>
                {f.detail ? (
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-fg-4">
                    {f.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** Roster name of the specialist who delivered the AI verdict, for the label. */
function specialistVerdictLabel(match: SignalMatch): string {
  const member = getMemberByFirstName(match.routedSpecialist);
  return member ? `${member.name}'s read` : 'Specialist read';
}

/* ---- Raw signal card (unrouted) ----------------------------------------- */

function SignalCard({ signal }: { signal: MarketSignal }) {
  const title = signalTitle(signal);
  const subtitle = signalSubtitle(signal);
  const amount = signalAmount(signal);
  const sev = severityMeta(signal.severity);

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-start gap-3">
        <SignalGlyph signal={signal} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[13.5px] font-semibold text-fg-1">{title}</h3>
            <Badge tone={sev.tone} className="text-[10px]">
              {sev.label}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-4">
            <span>{humanize(signal.kind)}</span>
            {subtitle ? (
              <>
                <span className="text-fg-5" aria-hidden>
                  ·
                </span>
                <span>{subtitle}</span>
              </>
            ) : null}
          </div>
        </div>
        <span className="inline-flex flex-none items-center gap-1 text-[10.5px] text-fg-5">
          <Clock size={10} strokeWidth={2} aria-hidden />
          {relativeTime(signal.capturedAt)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {amount ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-0.5 text-[11px] font-medium text-gold-1">
            <CircleDollarSign size={12} strokeWidth={2} aria-hidden />
            {amount}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] text-fg-3">
          <Building2 size={12} strokeWidth={1.9} aria-hidden />
          {humanize(signal.source)}
        </span>
        <RoutedSpecialist name={signal.routedSpecialist} />
      </div>
    </Card>
  );
}

/* ---- Main view ---------------------------------------------------------- */

const TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'routed', label: 'Routed to you' },
  { id: 'feed', label: 'Market feed' }
];

export interface InboxIntelligenceViewProps {
  data: InboxIntelligenceData;
}

export function InboxIntelligenceView({ data }: InboxIntelligenceViewProps) {
  const [tab, setTab] = useState('all');

  const topScore = useMemo(
    () => (data.matches.length ? Math.max(...data.matches.map((m) => m.score)) : 0),
    [data.matches]
  );

  if (data.empty) {
    return (
      <div className="space-y-5">
        <IntelHeader matchCount={0} signalCount={0} topScore={0} />
        <Card className="relative overflow-hidden p-2">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(60% 120% at 0% 0%, rgba(91,141,239,0.07), transparent 60%), radial-gradient(50% 100% at 100% 0%, rgba(247,201,72,0.05), transparent 65%)'
            }}
          />
          <EmptyState
            icon={Radar}
            title="Listening for market signals"
            body="Inbox Intelligence watches EDGAR Form D / Form ADV and other capital-market sources, then routes each scored signal to the right specialist. Signals will land here the moment ingestion runs — nothing for you to set up."
          />
        </Card>
      </div>
    );
  }

  const showRouted = tab === 'all' || tab === 'routed';
  const showFeed = tab === 'all' || tab === 'feed';

  return (
    <div className="space-y-6">
      <IntelHeader
        matchCount={data.matches.length}
        signalCount={data.signalCount}
        topScore={topScore}
      />

      <LearningIndicator calibration={data.calibration} />

      {data.briefing ? <BriefingCard briefing={data.briefing} /> : null}

      <SegTabs tabs={TABS} active={tab} onChange={setTab} />

      {showRouted ? (
        data.matches.length > 0 ? (
          <section aria-label="Routed signal matches">
            <SectionTitle
              eyebrow="Scored for your mandate"
              title="Routed to you"
              action={
                <Badge tone="gold" className="text-[10.5px]">
                  {data.matches.length}
                </Badge>
              }
            />
            <div className="grid gap-3 lg:grid-cols-2">
              {data.matches.map((m) => (
                <MatchCard key={m.id} match={m} calibration={data.calibration} />
              ))}
            </div>
          </section>
        ) : tab === 'routed' ? (
          <EmptyState
            icon={Activity}
            title="No routed matches yet"
            body="Market signals are flowing in, but none have been scored against your mandate yet. They appear here once the scorer runs."
          />
        ) : null
      ) : null}

      {showFeed ? (
        data.unroutedSignals.length > 0 ? (
          <section aria-label="Market signal feed">
            <SectionTitle
              eyebrow="Global capital-market intelligence"
              title="Market feed"
              action={
                <Badge tone="neutral" className="text-[10.5px]">
                  {data.unroutedSignals.length}
                </Badge>
              }
            />
            <div className="grid gap-3 lg:grid-cols-2">
              {data.unroutedSignals.map((s) => (
                <SignalCard key={s.id} signal={s} />
              ))}
            </div>
          </section>
        ) : tab === 'feed' ? (
          <EmptyState
            icon={Radar}
            title="Feed is clear"
            body="Every captured market signal has already been routed into your matches above."
          />
        ) : null
      ) : null}
    </div>
  );
}

/* ---- Header / stat band ------------------------------------------------- */

function IntelHeader({
  matchCount,
  signalCount,
  topScore
}: {
  matchCount: number;
  signalCount: number;
  topScore: number;
}) {
  const stats: { label: string; value: string; tone: BadgeTone }[] = [
    { label: 'Routed to you', value: String(matchCount), tone: 'gold' },
    { label: 'Signals tracked', value: String(signalCount), tone: 'azure' },
    { label: 'Top match', value: matchCount ? `${topScore}/100` : '—', tone: scoreTone(topScore) }
  ];

  return (
    <Card className="relative overflow-hidden p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(70% 130% at 0% 0%, rgba(91,141,239,0.08), transparent 60%), radial-gradient(60% 100% at 100% 0%, rgba(247,201,72,0.06), transparent 65%)'
        }}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <span className="relative flex h-11 w-11 flex-none items-center justify-center rounded-2xl border border-hairline bg-bg-1 text-azure-1 shadow-[var(--shadow-sm)]">
            <Radar size={19} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <p className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-azure-1">
              <Sparkles size={11} strokeWidth={2} aria-hidden />
              Intelligence · live read
            </p>
            <h1 className="mt-1 text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
              Inbox Intelligence
            </h1>
            <p className="mt-0.5 max-w-[56ch] text-[12.5px] text-fg-4">
              Scored market signals from EDGAR and capital-market sources, each routed to the right
              specialist on your desk.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
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
        </div>
      </div>
    </Card>
  );
}
