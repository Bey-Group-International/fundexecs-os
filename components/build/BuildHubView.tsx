import Link from 'next/link';
import { ArrowRight, Hammer } from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { compactMoney } from '@/lib/format';
import { LINK_STATE_LABEL } from '@/lib/loop-chain';
import type { BuildWorkspace } from '@/lib/build';

/**
 * BuildHubView — the `/build` verb hub.
 *
 * One surface that owns the Build verb: the headline record strength, the
 * verb's place in the loop chain (and what finishing it charges next), Earn's
 * next best action, and the four subsection panels (Profile / Strategy /
 * Readiness / Trust) with live scores deep-linking into their full surfaces.
 * Server component — every number arrives derived from `loadBuildWorkspace`.
 */
export function BuildHubView({ workspace }: { workspace: BuildWorkspace }) {
  const { panels, recordStrength, focus, chain, nextBestAction, lockedByReadiness } = workspace;
  const buildLink = chain.links.find((l) => l.verb === 'build');

  return (
    <div className="flex flex-col gap-[18px]" data-testid="build-hub">
      {/* ── Hero: record strength + the chain handoff ─────────────────────── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Hammer size={16} className="text-gold-1" aria-hidden />
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                Build — establish the record
              </p>
            </div>
            <p className="mt-2 max-w-xl text-[13px] text-fg-2">
              The record counterparties read from. Every close in Drive compounds back into this
              surface{lockedByReadiness > 0 && (
                <> — {compactMoney(lockedByReadiness)} is still locked behind the readiness gap</>
              )}
              .
            </p>
            <div className="mt-3 flex items-center gap-2">
              {buildLink && (
                <Badge tone={buildLink.state === 'active' ? 'gold' : 'neutral'} dot>
                  {LINK_STATE_LABEL[buildLink.state]}
                </Badge>
              )}
              <span className="text-[12px] text-fg-3">{chain.handoff}</span>
            </div>
          </div>
          <div className="min-w-[160px]">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              Record strength
            </p>
            <p className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-fg-1">
              {recordStrength}
              <span className="text-[14px] font-normal text-fg-4">/100</span>
            </p>
            <ProgressBar value={recordStrength} ariaLabel="Record strength" className="mt-2" />
          </div>
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

      {/* ── The four subsections, summarized in place ─────────────────────── */}
      <div>
        <SectionTitle
          eyebrow="The record, in four panels"
          title="Profile · Strategy · Readiness · Trust"
        />
        <div className="grid gap-[14px] sm:grid-cols-2">
          {panels.map((panel) => (
            <Link key={panel.key} href={panel.href} className="group">
              <Card clickable className="h-full p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13.5px] font-semibold text-fg-1">{panel.label}</p>
                    <p className="mt-1 text-[12px] text-fg-3">{panel.hint}</p>
                  </div>
                  {focus?.key === panel.key && (
                    <Badge tone="gold" dot>
                      Focus
                    </Badge>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                    {panel.metricLabel}
                  </span>
                  <Badge tone={panel.tone}>{panel.score}/100</Badge>
                </div>
                <ProgressBar
                  value={panel.score}
                  ariaLabel={`${panel.label} — ${panel.metricLabel}`}
                  className="mt-2"
                />
                {panel.gaps.length > 0 && (
                  <p className="mt-3 text-[12px] text-fg-3">
                    Open gaps: <span className="text-fg-2">{panel.gaps.join(' · ')}</span>
                  </p>
                )}
                <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-azure-1 opacity-0 transition group-hover:opacity-100">
                  Open {panel.label}
                  <ArrowRight size={12} aria-hidden />
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
