import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getCOO, getMember } from '@/lib/team/roster';
import { gradientForSlug } from '@/lib/team/avatar';
import type { AgentStatus } from '@/lib/queries/dashboard';

export interface AgentTeamStripProps {
  team: AgentStatus[];
  className?: string;
}

interface Tile {
  slug: string;
  name: string;
  position: string;
  status: string;
  onPoint: boolean;
  leader: boolean;
}

/**
 * AgentTeamStrip — the 15-strong executive desk, surfaced on the canvas. Earn
 * (COO, gold) always leads; specialists who are "on point" for the current
 * lifecycle stage are highlighted with a live status, the rest read as standing
 * by. Slug → name/position/icon is resolved from the single-source roster.
 */
export function AgentTeamStrip({ team, className }: AgentTeamStripProps) {
  const earn = getCOO();
  const tiles: Tile[] = [
    {
      slug: earn.slug,
      name: earn.name.split(' ')[0],
      position: earn.position,
      status: 'Running the desk',
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
        onPoint: a.onPoint,
        leader: false
      };
    })
  ];

  const onPointCount = tiles.filter((t) => t.onPoint).length;

  return (
    <Card className={cn('fx-rise p-5', className)} data-testid="agent-team-strip">
      <SectionTitle
        eyebrow={`Your executive desk · ${onPointCount} on point`}
        title="The team, working your stage"
        className="mb-3"
      />
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {tiles.map((t) => {
          const m = getMember(t.slug) ?? earn;
          const Icon = m.icon;
          const g = gradientForSlug(t.slug);
          return (
            <div
              key={t.slug}
              data-testid={`agent-tile-${t.slug}`}
              data-on-point={t.onPoint}
              title={`${m.name} · ${t.position} — ${t.status}`}
              className={cn(
                'flex w-[148px] flex-none flex-col gap-2 rounded-xl border bg-bg-1 p-3 transition-colors',
                t.onPoint
                  ? t.leader
                    ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                    : 'border-[var(--azure-line)] bg-[var(--azure-soft)]'
                  : 'border-hairline opacity-70'
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-white shadow-[var(--shadow-sm)]"
                  style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
                >
                  <Icon size={14} strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0">
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
                          t.leader ? 'bg-gold-1' : 'animate-pulse bg-azure-1'
                        )}
                        aria-hidden
                      />
                      On point
                    </span>
                  ) : (
                    <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-fg-5">
                      Standing by
                    </span>
                  )}
                </div>
              </div>
              <p className="line-clamp-2 text-[10.5px] leading-tight text-fg-3">{t.status}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default AgentTeamStrip;
