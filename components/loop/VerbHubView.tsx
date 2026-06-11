import Link from 'next/link';
import { ArrowRight, Hammer, Play, Radar, Rocket, Sparkles, type LucideIcon } from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { compactMoney } from '@/lib/format';
import { LINK_STATE_LABEL, type LoopChain, type LoopVerb } from '@/lib/loop-chain';
import type { HubHeadline, HubMetric, HubPanel } from '@/lib/loop-hub';
import type { VerbPulse } from '@/lib/loop-pulse';
import { EarnPanelTrigger } from './EarnPanelTrigger';

/**
 * VerbHubView — the shared verb-hub surface (/build /source /run /drive).
 *
 * One presentational component for all four loop verbs: the hero (verb,
 * headline metric, the verb's loop-chain state and handoff), Earn's next best
 * action, and the subsection panels. Panels deep-link into their full
 * surfaces, fire Earn actions (via `EarnPanelTrigger`), or read as calm
 * "soon" affordances — exactly mirroring the rail's cluster semantics.
 * Server component — every number arrives derived from the verb's loader.
 */

const VERB_ICONS: Record<LoopVerb, LucideIcon> = {
  build: Hammer,
  source: Radar,
  run: Play,
  drive: Rocket
};

const VERB_LABEL: Record<LoopVerb, string> = {
  build: 'Build',
  source: 'Source',
  run: 'Run',
  drive: 'Drive'
};

/** The verb-scoped prompt the gold "Ask Earn" nudge seeds into the dock. */
const VERB_EARN_PROMPT: Record<LoopVerb, string> = {
  build:
    'Advance my Build — tighten the record, sharpen the approach (structure, story, narrative), and close the readiness gaps. What moves the needle most?',
  source:
    'Source new deals and capital that fit my thesis and match them against my record. Show the strongest fits and why.',
  run: 'Run diligence and my action plan — what needs my decision next, and what can you prepare for my approval?',
  drive:
    'Drive my live deals to close — what is the next step on each, and what can you draft for my approval?'
};

/** The shape of Earn's next best action the hub needs (UI subset). */
export interface HubAction {
  title: string;
  context: string;
  cta: string;
  href: string;
}

export interface VerbHubViewProps {
  verb: LoopVerb;
  /** Tracked-out hero eyebrow, e.g. "Build — establish the record". */
  eyebrow: string;
  /** One-sentence "what this verb is for" hero line. */
  description: string;
  headline: HubHeadline;
  /** 0–100 verb readiness (cockpit model) — the hero's "% ready" + bar. */
  readyPct: number;
  /** The verb's recent outcomes (loop_events pulse); null renders nothing. */
  pulse: VerbPulse | null;
  chain: LoopChain;
  nextBestAction: HubAction | null;
  panels: HubPanel[];
  /** The panel needing the operator first (renders the Focus badge). */
  focusKey: string | null;
  /** Section header above the panel grid. */
  panelsTitle: string;
}

/** The verb's headline as a compact inline stat (score N/100 or compact $). */
function HeadlineStat({ headline }: { headline: HubHeadline }) {
  const m = headline.metric;
  if (m.kind === 'score') {
    return (
      <span>
        <span className="font-semibold text-fg-2">{m.value}/100</span>{' '}
        {headline.label.toLowerCase()}
      </span>
    );
  }
  return (
    <span>
      <span className="font-semibold text-fg-2">{compactMoney(m.amount)}</span> {m.label}
      {m.count > 0 ? ` · ${m.count}` : ''}
    </span>
  );
}

/** A panel's metric row: score bar, money badge, or a calm "soon". */
function PanelMetric({ metric, label }: { metric: HubMetric | null; label: string }) {
  if (!metric) {
    return (
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          Not built yet
        </span>
        <Badge tone="neutral">Soon</Badge>
      </div>
    );
  }
  if (metric.kind === 'money') {
    return (
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          {metric.label}
          {metric.count > 0 && <> · {metric.count}</>}
        </span>
        <Badge tone="azure">{compactMoney(metric.amount)}</Badge>
      </div>
    );
  }
  return (
    <>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          {metric.label}
        </span>
        <Badge tone={metric.value >= 70 ? 'success' : metric.value >= 40 ? 'azure' : 'warning'}>
          {metric.value}/100
        </Badge>
      </div>
      <ProgressBar value={metric.value} ariaLabel={`${label} — ${metric.label}`} className="mt-2" />
    </>
  );
}

function PanelCard({ panel, focused }: { panel: HubPanel; focused: boolean }) {
  const interactive = Boolean(panel.href || panel.earnPrompt);
  return (
    <Card clickable={interactive} className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-semibold text-fg-1">{panel.label}</p>
          <p className="mt-1 text-[12px] text-fg-3">{panel.hint}</p>
        </div>
        {focused && (
          <Badge tone="gold" dot>
            Focus
          </Badge>
        )}
      </div>
      <PanelMetric metric={panel.metric} label={panel.label} />
      {panel.gaps && panel.gaps.length > 0 && (
        <p className="mt-3 text-[12px] text-fg-3">
          Open gaps: <span className="text-fg-2">{panel.gaps.join(' · ')}</span>
        </p>
      )}
      {interactive && (
        <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-azure-1 opacity-0 transition group-hover:opacity-100">
          {panel.earnPrompt ? (
            <>
              <Sparkles size={12} aria-hidden />
              Run with Earn
            </>
          ) : (
            <>
              Open {panel.label}
              <ArrowRight size={12} aria-hidden />
            </>
          )}
        </span>
      )}
    </Card>
  );
}

export function VerbHubView({
  verb,
  eyebrow,
  description,
  headline,
  readyPct,
  pulse,
  chain,
  nextBestAction,
  panels,
  focusKey,
  panelsTitle
}: VerbHubViewProps) {
  const Icon = VERB_ICONS[verb];
  const verbLabel = VERB_LABEL[verb];
  const verbLink = chain.links.find((l) => l.verb === verb);
  const ready = Number.isFinite(readyPct) ? Math.max(0, Math.min(100, Math.round(readyPct))) : 0;

  return (
    <div className="flex flex-col gap-[18px]" data-testid={`${verb}-hub`}>
      {/* ── Hero: the verb, its readiness, and its place in the chain ──────── */}
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <span
            className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[13px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
            aria-hidden
          >
            <Icon size={23} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              {eyebrow}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
                {verbLabel}
              </h1>
              {verbLink && (
                <Badge tone={verbLink.state === 'active' ? 'gold' : 'neutral'} dot>
                  {LINK_STATE_LABEL[verbLink.state]}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-gold-1">
              {ready}%
            </div>
            <div className="text-[10.5px] text-fg-5">ready</div>
          </div>
        </div>

        <ProgressBar
          value={ready}
          gradient="linear-gradient(90deg,#F7C948,#E5A823)"
          height={6}
          ariaLabel={`${verbLabel} readiness`}
          className="mt-4"
        />

        <p className="mt-3 max-w-2xl text-[13px] text-fg-2">{description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
          <HeadlineStat headline={headline} />
          <span className="text-fg-5" aria-hidden>
            ·
          </span>
          <span>{chain.handoff}</span>
        </div>
        {pulse && (
          <p className="mt-2 text-[12px] text-fg-3" data-testid={`${verb}-hub-pulse`}>
            <span className="font-semibold text-fg-2">{pulse.headline}</span> · {pulse.detail}
          </p>
        )}
      </Card>

      {/* ── Next best action — the verb, activated ────────────────────────── */}
      {nextBestAction && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              Next best action
            </p>
            <p className="mt-1 text-[14px] font-semibold text-fg-1">{nextBestAction.title}</p>
            <p className="mt-0.5 text-[12.5px] text-fg-3">{nextBestAction.context}</p>
          </div>
          <Link
            href={nextBestAction.href}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-2 text-[12.5px] font-semibold text-gold-1 transition hover:brightness-110"
          >
            {nextBestAction.cta}
            <ArrowRight size={14} aria-hidden />
          </Link>
        </Card>
      )}

      {/* ── The verb's subsections — what the team manages here ───────────── */}
      <div>
        <SectionTitle eyebrow="What the team manages here" title={panelsTitle} />
        <div className="grid gap-[14px] sm:grid-cols-2">
          {panels.map((panel) => {
            const card = <PanelCard panel={panel} focused={focusKey === panel.key} />;
            if (panel.href) {
              return (
                <Link key={panel.key} href={panel.href} className="group">
                  {card}
                </Link>
              );
            }
            if (panel.earnPrompt) {
              return (
                <EarnPanelTrigger key={panel.key} prompt={panel.earnPrompt}>
                  {card}
                </EarnPanelTrigger>
              );
            }
            return <div key={panel.key}>{card}</div>;
          })}
        </div>
      </div>

      {/* ── Earn nudge — the verb keeps moving in the background ───────────── */}
      <EarnPanelTrigger prompt={VERB_EARN_PROMPT[verb]}>
        <Card
          clickable
          className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4"
        >
          <EarnCoin size={26} className="flex-none" />
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-2">
            <span className="font-semibold text-gold-1">Earn:</span> I keep {verbLabel} moving in
            the background. Tap any module and I&rsquo;ll do the work — you approve.
          </p>
          <span className="inline-flex flex-none items-center gap-1.5 rounded-full border border-[var(--gold-line)] px-3.5 py-2 text-[12.5px] font-semibold text-gold-1">
            <Sparkles size={14} aria-hidden />
            Ask Earn
          </span>
        </Card>
      </EarnPanelTrigger>
    </div>
  );
}
