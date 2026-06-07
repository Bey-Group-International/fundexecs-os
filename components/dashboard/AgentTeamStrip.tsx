'use client';

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getCOO, getMember } from '@/lib/team/roster';
import { gradientForSlug } from '@/lib/team/avatar';
import type { ActivityItem, AgentStatus } from '@/lib/queries/dashboard';

export interface AgentTeamStripProps {
  team: AgentStatus[];
  /** Recent desk activity — used to surface a live "last action" per lead. */
  activity?: ActivityItem[];
  className?: string;
}

interface Tile {
  slug: string;
  name: string;
  position: string;
  status: string;
  /** Live last-action line when we have one, else null (falls back to status). */
  lastAction: string | null;
  onPoint: boolean;
  leader: boolean;
}

/** Map an activity actor string to a roster slug where we can (Earn = COO). */
function actorToSlug(actor: string): string | null {
  if (actor.toLowerCase().includes('earn')) return getCOO().slug;
  return null;
}

/**
 * AgentTeamStrip — the 15-strong executive desk as a *living* panel. Earn (COO,
 * gold) always leads. Specialists on point for the current lifecycle stage pulse
 * with a live status; the rest read as standing by. When the activity feed
 * carries a recent action we can attribute, the lead shows that as a live "last
 * action" line; otherwise we fall back to the stage status. Avatars carry richer
 * animated gradients; each tile expands on hover/focus for detail.
 */
export function AgentTeamStrip({ team, activity, className }: AgentTeamStripProps) {
  const earn = getCOO();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Latest attributable action per slug, newest-first.
  const lastActionBySlug = new Map<string, string>();
  for (const item of activity ?? []) {
    const slug = actorToSlug(item.actor);
    if (slug && !lastActionBySlug.has(slug)) lastActionBySlug.set(slug, item.title);
  }

  const tiles: Tile[] = [
    {
      slug: earn.slug,
      name: earn.name.split(' ')[0],
      position: earn.position,
      status: 'Running the desk',
      lastAction: lastActionBySlug.get(earn.slug) ?? null,
      onPoint: true,
      leader: true
    },
    ...team.map((a) => {
      const m = getMember(a.slug);
      return {
        slug: a.slug,
        name: (m?.name ?? a.slug).split(' ')[0],
        position: m?.position ?? '',
        status: a.status,
        lastAction: lastActionBySlug.get(a.slug) ?? null,
        onPoint: a.onPoint,
        leader: false
      };
    })
  ];

  const onPointCount = tiles.filter((t) => t.onPoint).length;
  const liveCount = tiles.filter((t) => t.lastAction).length;

  return (
    <Card className={cn('fx-rise p-5', className)} data-testid="agent-team-strip">
      <SectionTitle
        eyebrow={`Your executive desk · ${onPointCount} on point${liveCount > 0 ? ` · ${liveCount} live` : ''}`}
        title="The team, working your stage"
        className="mb-3"
      />
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {tiles.map((t) => {
          const m = getMember(t.slug) ?? earn;
          const Icon = m.icon;
          const g = gradientForSlug(t.slug);
          const isExpanded = expanded === t.slug;
          const detail = t.lastAction ?? t.status;
          return (
            <button
              type="button"
              key={t.slug}
              data-testid={`agent-tile-${t.slug}`}
              data-on-point={t.onPoint}
              aria-expanded={isExpanded}
              onMouseEnter={() => setExpanded(t.slug)}
              onMouseLeave={() => setExpanded((cur) => (cur === t.slug ? null : cur))}
              onFocus={() => setExpanded(t.slug)}
              onBlur={() => setExpanded((cur) => (cur === t.slug ? null : cur))}
              aria-label={`${m.name} · ${t.position} — ${detail}`}
              className={cn(
                'flex min-h-[44px] flex-none flex-col gap-2 rounded-xl border bg-bg-1 p-3 text-left transition-[width,transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-azure-1',
                isExpanded ? 'w-[208px]' : 'w-[148px]',
                t.onPoint
                  ? t.leader
                    ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                    : 'border-[var(--azure-line)] bg-[var(--azure-soft)]'
                  : 'border-hairline opacity-80'
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-9 w-9 flex-none items-center justify-center rounded-lg text-white shadow-[var(--shadow-sm)]',
                    t.onPoint && !t.leader && 'fx-onpoint-pulse'
                  )}
                  style={{
                    background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`
                  }}
                >
                  <Icon size={15} strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-fg-1">{t.name}</p>
                  {t.onPoint ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.08em]',
                        t.leader ? 'text-gold-1' : 'text-azure-1'
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          t.leader ? 'bg-gold-1' : 'fx-glow-pulse bg-azure-1'
                        )}
                        aria-hidden
                      />
                      {t.lastAction ? 'Live' : 'On point'}
                    </span>
                  ) : (
                    <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-fg-5">
                      Standing by
                    </span>
                  )}
                </div>
              </div>

              {t.lastAction ? (
                <p className="flex items-start gap-1 text-[10.5px] leading-tight text-fg-2">
                  <Activity
                    size={11}
                    strokeWidth={2}
                    className="mt-0.5 flex-none text-azure-1"
                    aria-hidden
                  />
                  <span className={cn(isExpanded ? '' : 'line-clamp-2')}>{t.lastAction}</span>
                </p>
              ) : (
                <p
                  className={cn(
                    'text-[10.5px] leading-tight text-fg-3',
                    isExpanded ? '' : 'line-clamp-2'
                  )}
                >
                  {t.status}
                </p>
              )}

              {isExpanded ? (
                <p className="text-[9.5px] uppercase tracking-[0.08em] text-fg-5">{t.position}</p>
              ) : null}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default AgentTeamStrip;
