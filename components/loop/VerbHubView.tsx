import Link from 'next/link';
import { ArrowRight, Hammer, Play, Radar, Rocket, Sparkles, type LucideIcon } from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { compactMoney } from '@/lib/format';
import { LINK_STATE_LABEL, type LoopChain, type LoopVerb } from '@/lib/loop-chain';
import type { HubHeadline, HubMetric, HubPanel } from '@/lib/loop-hub';
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
  chain: LoopChain;
  nextBestAction: HubAction | null;
  panels: HubPanel[];
  /** The panel needing the operator first (renders the Focus badge). */
  focusKey: string | null;
  /** Section header above the panel grid. */
  panelsTitle: string;
}

/** The hero's big number: score as N/100 + bar, money as compact dollars. */
function HeadlineMetric({ headline }: { headline: HubHeadline }) {
  const m = headline.metric;
  return (
    <div className="min-w-[160px]">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
        {headline.label}
      </p>
      {m.kind === 'score' ? (
        <>
          <p className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-fg-1">
            {m.value}
            <span className="text-[14px] font-normal text-fg-4">/100</span>
          </p>
          <ProgressBar value={m.value} ariaLabel={headline.label} className="mt-2" />
        </>
      ) : (
        <>
          <p className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-fg-1">
            {compactMoney(m.amount)}
          </p>
          <p className="mt-1 text-[12px] text-fg-3">
            {m.label}
            {m.count > 0 && (
              <>
                {' '}
                · {m.count} item{m.count === 1 ? '' : 's'}
              </>
            )}
          </p>
        </>
      )}
    </div>
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
  chain,
  nextBestAction,
  panels,
  focusKey,
  panelsTitle
}: VerbHubViewProps) {
  const Icon = VERB_ICONS[verb];
  const verbLink = chain.links.find((l) => l.verb === verb);

  return (
    <div className="flex flex-col gap-[18px]" data-testid={`${verb}-hub`}>
      {/* ── Hero: the verb's headline + its place in the chain ────────────── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Icon size={16} className="text-gold-1" aria-hidden />
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                {eyebrow}
              </p>
            </div>
            <p className="mt-2 max-w-xl text-[13px] text-fg-2">{description}</p>
            <div className="mt-3 flex items-center gap-2">
              {verbLink && (
                <Badge tone={verbLink.state === 'active' ? 'gold' : 'neutral'} dot>
                  {LINK_STATE_LABEL[verbLink.state]}
                </Badge>
              )}
              <span className="text-[12px] text-fg-3">{chain.handoff}</span>
            </div>
          </div>
          <HeadlineMetric headline={headline} />
        </div>
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

      {/* ── The verb's subsections, summarized in place ───────────────────── */}
      <div>
        <SectionTitle eyebrow="The verb, in panels" title={panelsTitle} />
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
    </div>
  );
}
