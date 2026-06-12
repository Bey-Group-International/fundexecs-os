import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  Flame,
  Handshake,
  ListOrdered,
  MoonStar,
  Radar,
  Sparkles,
  ThermometerSun,
  UserRound,
  Users
} from 'lucide-react';
import { Cockpit } from '@/components/hubs/Cockpit';
import { RunWithEarnButton } from '@/components/command-center/RunWithEarnButton';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { MandateIcon } from '@/components/ui/MandateIcon';
import {
  deriveMoves,
  deriveSignals,
  type DeskMove,
  type DeskSignal,
  type MoveTone
} from '@/lib/command-center/moves';
import { compactMoney } from '@/lib/format';
import { getLifecycleRail } from '@/lib/hubs';
import { getCommandCenterData } from '@/lib/queries/command-center';
import { loadStreak } from '@/lib/queries/dashboard/lifecycle';
import { getShellIdentity } from '@/lib/queries/identity';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';
import { TEAM_ROSTER } from '@/lib/team';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Command Center' };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Toned icon-square classes, mirroring the prototype's TONE map. */
const TONE_BOX: Record<MoveTone, string> = {
  gold: 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1',
  azure: 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1',
  success: 'border-[var(--success-line)] bg-[var(--success-soft)] text-success',
  warning: 'border-[var(--warning-line)] bg-[var(--warning-soft)] text-warning',
  info: 'border-[var(--info-line)] bg-[var(--info-soft)] text-info',
  neutral: 'border-hairline bg-surface-2 text-fg-3'
};

/** The prototype's Panel — eyebrow + title header over a card. */
function Panel({
  icon: Icon,
  eyebrow,
  title,
  action,
  children
}: {
  icon: typeof Users;
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-bg-1 p-[18px]">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
            <Icon size={16} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              {eyebrow}
            </div>
            <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</h2>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The one move — the prototype's gold-ringed RightNowCard, server-rendered. */
function RightNowCard({ move }: { move: DeskMove }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--gold-line)] bg-bg-1 shadow-[0_0_0_1px_var(--gold-line)]">
      <div className="flex items-center gap-3 border-b border-[var(--border-faint)] bg-[linear-gradient(100deg,rgba(247,201,72,0.13),transparent_60%)] px-5 py-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-gold-1">
          Right now · your highest-impact move
        </span>
        <span className="flex-1" />
        <Badge tone={move.tone as BadgeTone} dot>
          {move.tag}
        </Badge>
      </div>
      <div className="px-5 pb-5 pt-5 sm:px-6">
        <h1 className="text-[21px] font-semibold tracking-[-0.015em] text-fg-1">{move.title}</h1>
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-fg-3">{move.why}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* The one move runs from the dashboard — handed to Earn (real
              approve-before-write loop). The link stays as "open the surface". */}
          <RunWithEarnButton ask={`Run my top move: ${move.title}. ${move.why}`} />
          <Link
            href={move.primary.href}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-4 py-2.5 text-[13.5px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
          >
            {move.primary.label}
            <ArrowRight size={14} aria-hidden />
          </Link>
          <span className="flex items-center gap-1.5 text-[11px] text-fg-5">
            <UserRound size={12} aria-hidden />
            {move.specialist}
          </span>
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3">
          <EarnCoin size={26} className="flex-none" />
          <p className="text-[12.5px] leading-relaxed text-fg-2">
            <b className="text-gold-1">Earn:</b> {move.earnNote}
          </p>
        </div>
      </div>
    </section>
  );
}

function SignalGrid({ signals }: { signals: DeskSignal[] }) {
  return (
    <Panel
      icon={MoonStar}
      eyebrow="Proactive — since you last looked"
      title="Your team's read of the desk"
    >
      {signals.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-fg-4">
          Nothing new yet — as deals land and relationships warm, the team surfaces what changed
          here, with the move attached.
        </p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {signals.map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className="flex items-start gap-2.5 rounded-[12px] border border-[var(--border-faint)] bg-surface-1 px-3 py-3 transition hover:-translate-y-0.5 hover:border-hairline hover:bg-surface-2"
            >
              <span
                className={cn(
                  'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border',
                  TONE_BOX[s.tone]
                )}
              >
                <MandateIcon name={s.icon} size={15} strokeWidth={1.9} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold leading-snug text-fg-1">
                  {s.label}
                </span>
                <span className="mt-1 flex items-center gap-1 text-[11px] text-fg-4">
                  <ArrowRight size={11} aria-hidden />
                  {s.cta}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function QueueList({ moves }: { moves: DeskMove[] }) {
  return (
    <Panel icon={ListOrdered} eyebrow="Ranked by impact — one tap to open" title="Then, in order">
      {moves.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-success">
          <CheckCircle2 size={16} aria-hidden />
          You&rsquo;re clear. Earn surfaces the next move as work lands.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {moves.map((q, i) => (
            <div
              key={q.id}
              className="flex items-center gap-3 rounded-[12px] border border-[var(--border-faint)] bg-surface-1 px-3 py-2.5"
            >
              <span className="w-3 flex-none font-mono text-[11px] text-fg-5">{i + 2}</span>
              <span
                className={cn(
                  'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                  TONE_BOX[q.tone]
                )}
              >
                <MandateIcon name={q.icon} size={15} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-fg-1">{q.title}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-fg-4">{q.why}</div>
              </div>
              <Link
                href={q.primary.href}
                className="inline-flex flex-none items-center gap-1.5 rounded-xl border border-hairline bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-fg-1 transition hover:bg-surface-3"
              >
                <Sparkles size={13} aria-hidden />
                {q.primary.label}
              </Link>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * Command Center — the prototype's daily cockpit, on real desk state. One
 * ranked highest-impact move first, then the lifecycle grid, the team's
 * signals, the ordered queue, and the roster — every CTA opens the live
 * surface where the real approve loop runs.
 */
export default async function CommandCenterPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, data, rail, identity, streak] = await Promise.all([
    getMandate(org.orgId),
    getCommandCenterData(org.orgId),
    getLifecycleRail(org.orgId),
    getShellIdentity(),
    loadStreak(org.orgId)
  ]);

  const firstName = (mandate?.principal ?? '').trim().split(/\s+/)[0] || 'there';

  const moves = deriveMoves({
    activeDealsCount: data.activeDealsCount,
    capitalInMotion: data.capitalInMotion,
    hotRelationshipsCount: data.hotRelationshipsCount,
    recentDeals: data.recentDeals.map((d) => ({ id: d.id, name: d.name, amount: d.amount })),
    topWarmConnections: data.topWarmConnections,
    pct: rail.pct,
    objective: mandate?.objective ?? null
  });
  const signals = deriveSignals({
    activeDealsCount: data.activeDealsCount,
    capitalInMotion: data.capitalInMotion,
    hotRelationshipsCount: data.hotRelationshipsCount,
    recentDeals: data.recentDeals.map((d) => ({ id: d.id, name: d.name, amount: d.amount })),
    topWarmConnections: data.topWarmConnections,
    pct: rail.pct,
    objective: mandate?.objective ?? null
  });
  const hero = moves[0];
  const queue = moves.slice(1);

  const kpis = [
    { icon: Radar, label: 'Active deals', value: String(data.activeDealsCount) },
    { icon: Handshake, label: 'In motion', value: compactMoney(data.capitalInMotion) },
    { icon: Flame, label: 'Hot relationships', value: String(data.hotRelationshipsCount) },
    {
      icon: ThermometerSun,
      label: 'Warmed this week',
      value: String(data.warmRelationshipsThisWeek)
    }
  ];

  return (
    <div className="fx-rise flex flex-col gap-4">
      {/* greeting strip — the prototype's one-liner with the move count */}
      <div className="flex flex-wrap items-center gap-2.5">
        <EarnCoin size={22} className="flex-none" />
        <p className="text-[12.5px] text-fg-3">
          <b className="text-fg-1">
            {greeting()}, {firstName}.
          </b>{' '}
          {moves.length > 0 ? (
            <>
              Earn lined up {moves.length} move{moves.length === 1 ? '' : 's'} — the top one first.
            </>
          ) : (
            <>You&rsquo;re clear — Earn is sourcing your next move.</>
          )}
        </p>

        {/* progression — real XP/level (from profiles.xp) + active-day streak */}
        <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-1 px-3 py-1 text-[11.5px]">
          <EarnCoin size={16} className="flex-none" />
          <span className="font-semibold text-fg-1">Level {identity?.level ?? 1}</span>
          <span className="text-fg-5" aria-hidden>
            ·
          </span>
          <span className="text-fg-3 [font-feature-settings:'tnum']">
            {(identity?.xp ?? 0).toLocaleString()} XP
          </span>
          {streak.current > 0 && (
            <>
              <span className="text-fg-5" aria-hidden>
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-gold-1">
                <Flame size={12} aria-hidden />
                {streak.current}-day
              </span>
            </>
          )}
        </span>
      </div>

      {/* lifecycle cockpit — the rail's reactive mirror */}
      <Cockpit pct={rail.pct} center={rail.center} />

      {/* the one move */}
      {hero && <RightNowCard move={hero} />}

      {/* desk stats */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {kpis.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
          >
            <Icon size={16} strokeWidth={1.9} className="flex-none text-azure-1" aria-hidden />
            <div className="min-w-0">
              <div className="text-[17px] font-semibold tracking-[-0.01em] [font-feature-settings:'tnum']">
                {value}
              </div>
              <div className="truncate text-[10.5px] uppercase tracking-[0.08em] text-fg-5">
                {label}
              </div>
            </div>
          </div>
        ))}
      </div>

      <SignalGrid signals={signals} />
      <QueueList moves={queue} />

      {/* the team — prototype pill chips */}
      <Panel
        icon={Users}
        eyebrow={`${TEAM_ROSTER.length} specialists · on your desk`}
        title="Your executive team"
      >
        <div className="flex flex-wrap gap-2">
          {TEAM_ROSTER.map((m) => {
            const Icon = m.icon;
            return (
              <span
                key={m.slug}
                title={`${m.name} · ${m.position}`}
                className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-1 py-1 pl-1 pr-3 text-[11.5px] text-fg-2"
              >
                {m.chief ? (
                  <EarnCoin size={22} />
                ) : (
                  <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
                    <Icon size={11} strokeWidth={2} aria-hidden />
                  </span>
                )}
                {m.name.split(' ')[0]}
              </span>
            );
          })}
        </div>
      </Panel>

      <p className="text-center text-[11.5px] text-fg-5">
        You set the mandate · the team works · you approve — everything routes through your
        approval.
      </p>
    </div>
  );
}
