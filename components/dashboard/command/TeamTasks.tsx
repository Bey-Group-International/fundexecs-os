import { Card, Badge, SectionTitle } from '@/components/ui';
import { TeamAvatar, getMemberOrCOO } from '@/lib/team';
import type { AgentStatus } from '@/lib/queries/dashboard';

/* ============================================================================
 * TeamTasks — the executive desk as a task list: each specialist with the
 * work they're on for the current stage. On-point specialists lead.
 * ========================================================================= */

export function TeamTasks({ team }: { team: AgentStatus[] }) {
  const ordered = [...team].sort((a, b) => Number(b.onPoint) - Number(a.onPoint));

  return (
    <Card className="p-5" data-testid="team-tasks">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="The executive desk · who's on it" title="Team tasks" />
        <Badge tone="azure" className="text-[10px]">
          {team.filter((t) => t.onPoint).length} on point
        </Badge>
      </div>

      {ordered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-5 text-center text-[12px] text-fg-4">
          The desk is idle — assign a mandate to put the team to work.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {ordered.map((a) => {
            const member = getMemberOrCOO(a.slug);
            return (
              <li
                key={a.slug}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5"
              >
                <TeamAvatar member={member} size={32} variant="disc" className="flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] font-semibold text-fg-1">
                      {member.name}
                    </span>
                    {a.onPoint ? (
                      <Badge tone="azure" dot className="flex-none text-[9px]">
                        On point
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-[11px] text-fg-4">{a.status}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default TeamTasks;
