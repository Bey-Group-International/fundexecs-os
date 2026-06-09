'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { Card, Badge, SectionTitle } from '@/components/ui';
import { TeamAvatar, getMemberOrCOO } from '@/lib/team';
import { cn } from '@/lib/utils';
import type { AgentStatus } from '@/lib/queries/dashboard';

/* ============================================================================
 * TeamTasks — the executive desk as a live, animated task list. The motion is
 * state-driven, not decorative: on-point specialists read as "working" (glow +
 * pulse ring + a sweeping progress shimmer) while the rest rest calmly, and a
 * streaming orchestration line types through who's on point. Refined at rest,
 * expressive on the working state; fully static under reduced-motion.
 *
 * `agentState()` maps the current (derived) status to a lifecycle state today;
 * when real task status lands it can return 'awaiting' / 'done' / 'failed'
 * directly and the same STATE_META + motion drive the richer transitions.
 * ========================================================================= */

type AgentState = 'working' | 'idle' | 'awaiting' | 'done' | 'failed';

const STATE_META: Record<AgentState, { label: string; color: string }> = {
  working: { label: 'Working', color: 'var(--azure-1)' },
  idle: { label: 'Standing by', color: 'var(--fg-5)' },
  awaiting: { label: 'Needs you', color: 'var(--gold-1)' },
  done: { label: 'Done', color: 'var(--success)' },
  failed: { label: 'Retry', color: 'var(--danger)' }
};

function agentState(a: AgentStatus): AgentState {
  return a.onPoint ? 'working' : 'idle';
}

const EASE = [0.22, 0.61, 0.36, 1] as const;

/* ---- Streaming orchestration line --------------------------------------- */

function OrchestrationLine({ active }: { active: { name: string; status: string }[] }) {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState('');

  const lines = useMemo(
    () =>
      active.length > 0
        ? active.map((a) => `${a.name} — ${a.status.toLowerCase()}`)
        : ['Earn is coordinating the desk'],
    [active]
  );

  // Type the current line out, hold, then advance. All state-setting happens in
  // timer callbacks (never synchronously in the effect body).
  useEffect(() => {
    if (reduce) return;
    const full = lines[idx % lines.length];
    let i = 0;
    const type = setInterval(() => {
      i += 1;
      setShown(full.slice(0, i));
      if (i >= full.length) clearInterval(type);
    }, 34);
    const advance = setTimeout(
      () => setIdx((x) => (x + 1) % lines.length),
      full.length * 34 + 1800
    );
    return () => {
      clearInterval(type);
      clearTimeout(advance);
    };
  }, [idx, lines, reduce]);

  const text = reduce ? lines.join(' · ') : shown;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--azure-line)] bg-[var(--azure-soft)] px-3 py-2">
      <span className="relative flex h-2 w-2 flex-none" aria-hidden>
        {!reduce ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-azure-1 opacity-60" />
        ) : null}
        <span className="relative inline-block h-2 w-2 rounded-full bg-azure-1" />
      </span>
      <p className="min-w-0 flex-1 truncate text-[12px] text-fg-2" aria-live="polite">
        <span className="font-semibold text-azure-1">Live</span> · {text}
        {!reduce ? (
          <span className="ml-0.5 inline-block w-1.5 animate-pulse text-azure-1">▍</span>
        ) : null}
      </p>
    </div>
  );
}

/* ---- Agent card --------------------------------------------------------- */

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }
};

function AgentCard({ agent, reduce }: { agent: AgentStatus; reduce: boolean | null }) {
  const member = getMemberOrCOO(agent.slug);
  const state = agentState(agent);
  const meta = STATE_META[state];
  const working = state === 'working';

  return (
    <motion.li
      variants={reduce ? undefined : cardVariants}
      className={cn(
        'relative flex items-center gap-3 overflow-hidden rounded-xl border bg-bg-1 px-3 py-2.5 transition-colors',
        working ? 'border-[var(--azure-line)]' : 'border-hairline'
      )}
    >
      {/* avatar with working presence (glow + pulse ring) */}
      <span className="relative flex-none">
        {working && !reduce ? (
          <>
            <motion.span
              aria-hidden
              className="pointer-events-none absolute -inset-1.5 rounded-full"
              style={{ background: 'radial-gradient(circle, var(--azure-soft), transparent 70%)' }}
              animate={{ opacity: [0.35, 0.85, 0.35] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="pointer-events-none absolute inset-0 animate-ping rounded-full border border-[var(--azure-line)]" />
          </>
        ) : null}
        <TeamAvatar member={member} size={34} variant="disc" className="relative" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-semibold text-fg-1">{member.name}</span>
          {agent.onPoint ? (
            <Badge tone="azure" dot className="flex-none text-[9px]">
              On point
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-[11px] text-fg-4">{agent.status}</p>

        {/* working progress shimmer (state-reactive) */}
        {working && !reduce ? (
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className="h-full w-1/3 rounded-full bg-azure-1"
              animate={{ x: ['-130%', '330%'] }}
              transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        ) : null}
      </div>

      {/* state dot */}
      <span
        className="h-2 w-2 flex-none rounded-full"
        style={{ background: meta.color, boxShadow: working ? `0 0 8px ${meta.color}` : undefined }}
        aria-label={meta.label}
      />
    </motion.li>
  );
}

/* ---- Section ------------------------------------------------------------ */

export function TeamTasks({ team }: { team: AgentStatus[] }) {
  const reduce = useReducedMotion();
  const ordered = [...team].sort((a, b) => Number(b.onPoint) - Number(a.onPoint));
  const onPointCount = team.filter((t) => t.onPoint).length;

  const active = ordered
    .filter((a) => a.onPoint)
    .map((a) => ({ name: getMemberOrCOO(a.slug).name, status: a.status }));

  return (
    <Card className="p-5" data-testid="team-tasks">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="The executive desk · who's on it" title="Team tasks" />
        <Badge tone="azure" className="text-[10px]">
          {onPointCount} on point
        </Badge>
      </div>

      {ordered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-5 text-center text-[12px] text-fg-4">
          The desk is idle — assign a mandate to put the team to work.
        </p>
      ) : (
        <>
          <div className="mb-3">
            <OrchestrationLine active={active} />
          </div>
          <motion.ul
            className="grid gap-2 sm:grid-cols-2"
            initial={reduce ? undefined : 'hidden'}
            animate={reduce ? undefined : 'show'}
            variants={
              reduce ? undefined : { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
            }
          >
            {ordered.map((a) => (
              <AgentCard key={a.slug} agent={a} reduce={reduce} />
            ))}
          </motion.ul>
        </>
      )}
    </Card>
  );
}

export default TeamTasks;
