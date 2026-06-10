'use client';

/* ============================================================================
 * LaunchCommandPanel — the Admin portal's "Overview" tab.
 *
 * A launch-readiness command surface for the Bey Group team. It composes a
 * single at-a-glance picture from signals already loaded on the Settings page
 * (members, invites, applications, distribution links, referrals, platform
 * metrics) — turning the seven detail tabs into one place that says, plainly:
 *   • how ready the launch is (a scored readiness gauge),
 *   • where operators are in the acquisition funnel (reach → activate),
 *   • what needs a human right now (the attention queue),
 *   • which launch gates are green / amber / still tracking.
 *
 * Every number here is REAL — derived from the same props the tabs render. No
 * fabricated metrics. Where a signal isn't live yet (trust coverage, knowledge
 * embeddings), it renders an honest "tracking" state rather than a fake score.
 * The panel is presentational; actions jump the parent to the relevant tab.
 * ========================================================================= */

import {
  Activity,
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  Check,
  Clock,
  Coins,
  Inbox,
  Mail,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon
} from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle, type BadgeTone } from '@/components/ui';
import type { LaunchTrend } from '@/lib/queries/admin-snapshots';

/** A tab the panel can jump to via an attention item or quick action.
 *  'access' is the unified pipeline tab (invites + share links + applications). */
export type LaunchTab = 'users' | 'access' | 'referrals' | 'activity' | 'trust' | 'knowledge';

/** The fully-derived launch picture — computed by the parent from live props. */
export interface LaunchSnapshot {
  members: number;
  owners: number;
  admins: number;
  /** Invites that have been sent (any status). */
  invitesSent: number;
  /** Invites still awaiting acceptance. */
  openInvites: number;
  acceptedInvites: number;
  /** Link claimants who applied (any review state). */
  applications: number;
  pendingApplications: number;
  approvedApplications: number;
  /** Distribution (beta) links currently live. */
  activeLinks: number;
  referredCount: number;
  creditsEarned: number;
  recentActions: number;
  /** Platform metrics are placeholder until the backend RPC goes live. */
  metricsPlaceholder: boolean;
  /** Mean Chain-of-Trust coverage across layers (0–100), when live. */
  trustCoverage: number;
  brainsTotal: number;
  brainsEmbedded: number;
}

const TONE_VAR: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  info: 'var(--info)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  gold: 'var(--gold-1)',
  warning: 'var(--warning)',
  danger: 'var(--danger)'
};

/* ---- Launch gate (a single scored readiness item) ----------------------- */

type GateState = 'done' | 'attention' | 'todo' | 'soon';

interface Gate {
  label: string;
  detail: string;
  state: GateState;
  icon: LucideIcon;
  /** Optional tab to jump to when this gate needs work. */
  tab?: LaunchTab;
}

const GATE_META: Record<GateState, { tone: BadgeTone; label: string; icon: LucideIcon }> = {
  done: { tone: 'success', label: 'Ready', icon: Check },
  attention: { tone: 'warning', label: 'Needs you', icon: AlertCircle },
  todo: { tone: 'neutral', label: 'Not started', icon: Clock },
  soon: { tone: 'neutral', label: 'Tracking', icon: Clock }
};

function buildGates(s: LaunchSnapshot): Gate[] {
  const gates: Gate[] = [];

  gates.push({
    label: 'Founding team seated',
    detail: s.owners
      ? `${s.owners} owner${s.owners === 1 ? '' : 's'} · ${s.admins} admin${s.admins === 1 ? '' : 's'}`
      : 'No owner on the workspace yet',
    state: s.owners >= 1 ? 'done' : 'attention',
    icon: Users,
    tab: 'users'
  });

  const reach = s.invitesSent + s.applications;
  gates.push({
    label: 'Operators invited',
    detail: reach
      ? `${reach} reached · ${s.invitesSent} invites, ${s.applications} link claims`
      : 'No invites sent or links claimed yet',
    state: reach > 0 ? 'done' : 'todo',
    icon: Mail,
    tab: 'access'
  });

  gates.push({
    label: 'Applications triaged',
    detail: s.pendingApplications
      ? `${s.pendingApplications} awaiting review`
      : s.applications
        ? 'Inbox clear'
        : 'No applications yet',
    state: s.pendingApplications > 0 ? 'attention' : s.applications > 0 ? 'done' : 'todo',
    icon: Inbox,
    tab: 'access'
  });

  gates.push({
    label: 'Members activated',
    detail:
      s.members > 1
        ? `${s.members} members in the workspace`
        : 'Only the founding account is active',
    state: s.members > 1 ? 'done' : 'todo',
    icon: Sparkles,
    tab: 'users'
  });

  gates.push({
    label: 'Distribution links live',
    detail: s.activeLinks
      ? `${s.activeLinks} shareable link${s.activeLinks === 1 ? '' : 's'} active`
      : 'No active beta links',
    state: s.activeLinks > 0 ? 'done' : 'todo',
    icon: Coins,
    tab: 'access'
  });

  gates.push({
    label: 'Trust chains live',
    detail: s.metricsPlaceholder
      ? 'Coverage metrics not wired yet'
      : s.trustCoverage > 0
        ? `${s.trustCoverage}% mean layer coverage`
        : 'No deal chains started',
    state: s.metricsPlaceholder ? 'soon' : s.trustCoverage > 0 ? 'done' : 'attention',
    icon: ShieldCheck,
    tab: 'trust'
  });

  gates.push({
    label: 'Knowledge base embedded',
    detail: s.metricsPlaceholder
      ? 'Embedding coverage not wired yet'
      : `${s.brainsEmbedded} / ${s.brainsTotal} brains embedded`,
    state: s.metricsPlaceholder ? 'soon' : s.brainsEmbedded > 0 ? 'done' : 'attention',
    icon: BrainCircuit,
    tab: 'knowledge'
  });

  return gates;
}

/** Readiness score: share of actionable gates that are green ('soon' excluded
 *  from the denominator — placeholder signals shouldn't drag a real score). */
function readinessScore(gates: Gate[]): { pct: number; scored: number; done: number } {
  const scored = gates.filter((g) => g.state !== 'soon');
  const done = scored.filter((g) => g.state === 'done').length;
  const pct = scored.length ? Math.round((done / scored.length) * 100) : 0;
  return { pct, scored: scored.length, done };
}

function readinessTone(pct: number): { tone: BadgeTone; verdict: string } {
  if (pct >= 85) return { tone: 'success', verdict: 'Launch-ready' };
  if (pct >= 55) return { tone: 'gold', verdict: 'Nearly there' };
  if (pct > 0) return { tone: 'warning', verdict: 'Building up' };
  return { tone: 'neutral', verdict: 'Not started' };
}

/* ---- Funnel ------------------------------------------------------------- */

interface Stage {
  label: string;
  value: number;
  tone: BadgeTone;
  /** Conversion from the previous stage, when it's a true subset. */
  conv?: number | null;
}

function buildFunnel(s: LaunchSnapshot): Stage[] {
  const reached = s.invitesSent + s.applications;
  const approved = s.approvedApplications + s.acceptedInvites;
  const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
  return [
    { label: 'Reached', value: reached, tone: 'azure' },
    {
      label: 'Applied',
      value: s.applications,
      tone: 'azure',
      conv: pctOf(s.applications, reached)
    },
    { label: 'Approved', value: approved, tone: 'gold', conv: pctOf(approved, reached) },
    { label: 'Active', value: s.members, tone: 'success', conv: pctOf(s.members, approved) }
  ];
}

/* ---- Attention queue ---------------------------------------------------- */

interface AttentionItem {
  title: string;
  detail: string;
  tone: BadgeTone;
  cta: string;
  tab: LaunchTab;
  icon: LucideIcon;
}

function buildAttention(s: LaunchSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (s.pendingApplications > 0) {
    items.push({
      title: `${s.pendingApplications} application${s.pendingApplications === 1 ? '' : 's'} awaiting review`,
      detail: 'Triage the inbox so claimants can be activated.',
      tone: 'warning',
      cta: 'Review applications',
      tab: 'access',
      icon: Inbox
    });
  }
  if (s.openInvites > 0) {
    items.push({
      title: `${s.openInvites} invite${s.openInvites === 1 ? '' : 's'} awaiting acceptance`,
      detail: 'Resend or follow up so seats convert.',
      tone: 'gold',
      cta: 'Open invites',
      tab: 'access',
      icon: Mail
    });
  }
  return items;
}

/* ---- Momentum (day-over-day deltas from launch snapshots) ---------------- */

/** Compact "+3" / "±0" / "−2" delta with a tone that matches its direction. */
function DeltaValue({ value }: { value: number }) {
  const tone: BadgeTone = value > 0 ? 'success' : value < 0 ? 'warning' : 'neutral';
  const text = value > 0 ? `+${value.toLocaleString()}` : value < 0 ? value.toLocaleString() : '±0';
  return (
    <span className="text-[18px] font-semibold tabular-nums" style={{ color: TONE_VAR[tone] }}>
      {text}
    </span>
  );
}

/** Tiny inline sparkline of the members series — enough to show direction. */
function MemberSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} aria-hidden className="flex-none">
      <polyline
        points={points}
        fill="none"
        stroke="var(--azure-1)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The compounding view: how the launch moved since the last snapshot day.
 * Renders deltas once at least one prior-day snapshot exists; before that it
 * states honestly that the trend starts today. Renders nothing when the
 * snapshot history isn't available at all (e.g. migration not applied).
 */
function MomentumStrip({ trend }: { trend: LaunchTrend }) {
  const sinceLabel = trend.sinceDate
    ? new Date(`${trend.sinceDate}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC'
      })
    : null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle
          eyebrow="Compounding"
          title="Momentum"
          className="mb-3"
          action={
            sinceLabel ? <span className="text-[11px] text-fg-5">vs {sinceLabel}</span> : undefined
          }
        />
        <MemberSparkline values={trend.series.map((p) => p.members)} />
      </div>
      {trend.deltas ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Members', value: trend.deltas.members },
            { label: 'Invites accepted', value: trend.deltas.invitesAccepted },
            { label: 'Approved', value: trend.deltas.applicationsApproved },
            { label: 'Credits earned', value: trend.deltas.creditsEarned }
          ].map((d) => (
            <div
              key={d.label}
              className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5"
            >
              <DeltaValue value={d.value} />
              <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-4">
                {d.label}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-3.5 text-[12px] text-fg-4">
          First snapshot recorded today — day-over-day momentum starts building from tomorrow.
        </div>
      )}
    </Card>
  );
}

/* ---- Sub-components ------------------------------------------------------ */

function ReadinessHero({
  score,
  verdict,
  tone,
  done,
  scored,
  momentum
}: {
  score: number;
  verdict: string;
  tone: BadgeTone;
  done: number;
  scored: number;
  momentum: { referrals: number; credits: number; actions: number };
}) {
  const accent = TONE_VAR[tone];
  const micro = [
    { label: 'Referrals', value: momentum.referrals.toLocaleString() },
    { label: 'Credits earned', value: momentum.credits.toLocaleString() },
    { label: 'Recent actions', value: momentum.actions.toLocaleString() }
  ];
  return (
    <Card className="relative overflow-hidden p-0">
      <div className="flex flex-col gap-5 bg-[linear-gradient(105deg,rgba(247,201,72,0.10),rgba(59,116,240,0.06)_50%,transparent_78%)] px-5 py-[18px]">
        <div className="flex items-center gap-4">
          <span
            className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl border bg-bg-1"
            style={{ color: accent, borderColor: accent }}
          >
            <Rocket size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              Launch readiness
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                {score}%
              </span>
              <Badge tone={tone} dot>
                {verdict}
              </Badge>
            </div>
          </div>
          <div className="hidden flex-none flex-col items-end sm:flex">
            <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
              {done}/{scored}
            </span>
            <span className="text-[10.5px] uppercase tracking-[0.11em] text-fg-4">Gates green</span>
          </div>
        </div>
        <ProgressBar
          value={score}
          height={8}
          gradient={`linear-gradient(90deg,${accent},${accent})`}
        />
        <div className="grid grid-cols-3 gap-2">
          {micro.map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-center"
            >
              <div className="text-[16px] font-semibold tabular-nums tracking-[-0.01em] text-fg-1">
                {m.value}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4">
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function FunnelStrip({ stages }: { stages: Stage[] }) {
  return (
    <Card>
      <SectionTitle eyebrow="Acquisition" title="Onboarding funnel" className="mb-3" />
      <div className="flex items-stretch gap-1.5">
        {stages.map((st, i) => (
          <div key={st.label} className="flex flex-1 items-stretch gap-1.5">
            <div className="relative flex-1 overflow-hidden rounded-xl border border-hairline bg-surface-1 p-3">
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-0.5"
                style={{ backgroundColor: TONE_VAR[st.tone] }}
              />
              <div className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                {st.value}
              </div>
              <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-4">
                {st.label}
              </div>
              {st.conv != null ? (
                <div className="mt-1 text-[10.5px] tabular-nums text-fg-5">{st.conv}% of reach</div>
              ) : null}
            </div>
            {i < stages.length - 1 ? (
              <ArrowRight
                size={14}
                strokeWidth={2}
                className="mt-3 flex-none self-start text-fg-5"
                aria-hidden
              />
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AttentionQueue({
  items,
  canJump,
  onJump
}: {
  items: AttentionItem[];
  canJump: (tab: LaunchTab) => boolean;
  onJump: (tab: LaunchTab) => void;
}) {
  return (
    <Card>
      <SectionTitle
        eyebrow="Needs you"
        title="Attention queue"
        className="mb-3"
        action={<Activity size={15} strokeWidth={1.9} className="text-fg-4" aria-hidden />}
      />
      {items.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] p-3.5">
          <Check size={15} strokeWidth={2} className="flex-none text-success" aria-hidden />
          <span className="text-[12.5px] text-fg-2">
            All clear — every launch surface is green right now.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => {
            const Icon = item.icon;
            const jumpable = canJump(item.tab);
            const inner = (
              <>
                <span
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border bg-bg-1"
                  style={{ color: TONE_VAR[item.tone], borderColor: TONE_VAR[item.tone] }}
                >
                  <Icon size={14} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-fg-1">{item.title}</div>
                  <div className="truncate text-[11px] text-fg-4">{item.detail}</div>
                </div>
                {jumpable ? (
                  <span className="flex flex-none items-center gap-1 text-[11.5px] font-medium text-fg-3 transition group-hover:text-azure-1">
                    {item.cta}
                    <ArrowRight size={13} strokeWidth={2} aria-hidden />
                  </span>
                ) : null}
              </>
            );
            return jumpable ? (
              <button
                key={item.title}
                type="button"
                onClick={() => onJump(item.tab)}
                className="group flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3 text-left transition hover:border-[var(--azure-line)] hover:bg-surface-2"
              >
                {inner}
              </button>
            ) : (
              <div
                key={item.title}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3"
              >
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function GateGrid({
  gates,
  canJump,
  onJump
}: {
  gates: Gate[];
  canJump: (tab: LaunchTab) => boolean;
  onJump: (tab: LaunchTab) => void;
}) {
  return (
    <Card>
      <SectionTitle eyebrow="Launch gates" title="Readiness checklist" className="mb-3" />
      <div className="grid gap-2.5 sm:grid-cols-2">
        {gates.map((g) => {
          const meta = GATE_META[g.state];
          const Icon = g.icon;
          const MetaIcon = meta.icon;
          const actionable =
            g.tab && canJump(g.tab) && (g.state === 'attention' || g.state === 'todo');
          const accent = TONE_VAR[meta.tone];
          const body = (
            <>
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border bg-bg-1"
                style={{ color: accent, borderColor: accent }}
              >
                <Icon size={14} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-semibold text-fg-1">{g.label}</span>
                </div>
                <div className="truncate text-[11px] text-fg-4">{g.detail}</div>
              </div>
              <span
                className="inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: accent, backgroundColor: 'var(--surface-1)' }}
              >
                <MetaIcon size={11} strokeWidth={2} aria-hidden />
                {meta.label}
              </span>
            </>
          );
          return actionable ? (
            <button
              key={g.label}
              type="button"
              onClick={() => onJump(g.tab!)}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3 text-left transition hover:border-[var(--azure-line)] hover:bg-surface-2"
            >
              {body}
            </button>
          ) : (
            <div
              key={g.label}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3"
            >
              {body}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---- Main panel --------------------------------------------------------- */

export function LaunchCommandPanel({
  snapshot,
  trend = null,
  visibleTabs,
  onJump
}: {
  snapshot: LaunchSnapshot;
  /** Day-over-day momentum (deltas + series) from the launch snapshots. */
  trend?: LaunchTrend | null;
  /** Tabs the host actually shows — gates/attention items only deep-link to
   *  these. When omitted, every tab is assumed jumpable. */
  visibleTabs?: LaunchTab[];
  onJump: (tab: LaunchTab) => void;
}) {
  const gates = buildGates(snapshot);
  const { pct, scored, done } = readinessScore(gates);
  const { tone, verdict } = readinessTone(pct);
  const stages = buildFunnel(snapshot);
  const attention = buildAttention(snapshot);
  const allowed = visibleTabs ? new Set(visibleTabs) : null;
  const canJump = (t: LaunchTab) => !allowed || allowed.has(t);

  return (
    <div className="flex flex-col gap-[18px]">
      <ReadinessHero
        score={pct}
        verdict={verdict}
        tone={tone}
        done={done}
        scored={scored}
        momentum={{
          referrals: snapshot.referredCount,
          credits: snapshot.creditsEarned,
          actions: snapshot.recentActions
        }}
      />
      {trend ? <MomentumStrip trend={trend} /> : null}
      <FunnelStrip stages={stages} />
      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        <AttentionQueue items={attention} canJump={canJump} onJump={onJump} />
        <GateGrid gates={gates} canJump={canJump} onJump={onJump} />
      </div>
    </div>
  );
}
