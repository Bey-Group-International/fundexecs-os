'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { Check, Play, Plus, RotateCw, Sparkles, X, Loader2 } from 'lucide-react';
import { Card, Badge, SectionTitle } from '@/components/ui';
import { TeamAvatar, getMemberOrCOO } from '@/lib/team';
import { cn } from '@/lib/utils';
import { assignTask, updateTaskStatus, runTask, decideTaskRun } from '@/lib/actions/tasks';
import type { AgentStatus } from '@/lib/queries/dashboard';
import type {
  AgentTaskSummary,
  TaskProposalSummary,
  TaskRuntime,
  TeamTaskMap
} from '@/lib/queries/dashboard/team-tasks';

/* ============================================================================
 * TeamTasks — the executive desk as a live, animated task tool. Motion is
 * driven by real task status when present (running → working, awaiting → needs
 * you, failed → retry), falling back to the stage-derived on-point state. Each
 * specialist can be assigned a task inline, and the surfaced active task can be
 * advanced (Start / Approve / Complete / Retry). Refined at rest, expressive on
 * the working state; fully static under reduced-motion.
 * ========================================================================= */

type AgentState = 'working' | 'idle' | 'awaiting' | 'done' | 'failed';

const STATE_META: Record<AgentState, { label: string; color: string }> = {
  working: { label: 'Working', color: 'var(--azure-1)' },
  idle: { label: 'Standing by', color: 'var(--fg-5)' },
  awaiting: { label: 'Needs you', color: 'var(--gold-1)' },
  done: { label: 'Done', color: 'var(--success)' },
  failed: { label: 'Retry', color: 'var(--danger)' }
};

/** Resolve the card state from real task workload first, stage state second. */
function resolveState(agent: AgentStatus, summary: AgentTaskSummary | undefined): AgentState {
  if (summary) {
    if (summary.running > 0 || summary.open > 0) {
      if (summary.awaiting > 0 && summary.running === 0) return 'awaiting';
      return 'working';
    }
    if (summary.failed > 0) return 'failed';
    if (summary.doneToday > 0) return 'done';
  }
  return agent.onPoint ? 'working' : 'idle';
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
  // Announce only the completed line (not every typed character).
  const liveText = reduce ? lines.join(' · ') : lines[idx % lines.length];

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--azure-line)] bg-[var(--azure-soft)] px-3 py-2">
      <span className="relative flex h-2 w-2 flex-none" aria-hidden>
        {!reduce ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-azure-1 opacity-60" />
        ) : null}
        <span className="relative inline-block h-2 w-2 rounded-full bg-azure-1" />
      </span>
      <p className="min-w-0 flex-1 truncate text-[12px] text-fg-2" aria-hidden="true">
        <span className="font-semibold text-azure-1">Live</span> · {text}
        {!reduce ? (
          <span className="ml-0.5 inline-block w-1.5 animate-pulse text-azure-1">▍</span>
        ) : null}
      </p>
      <p className="sr-only" aria-live="polite">
        Live · {liveText}
      </p>
    </div>
  );
}

/* ---- Active-task control ------------------------------------------------- */

const NEXT_STATUS: Record<
  TaskRuntime,
  { to: TaskRuntime; label: string; icon: typeof Play } | null
> = {
  queued: { to: 'running', label: 'Start', icon: Play },
  blocked: { to: 'running', label: 'Start', icon: Play },
  awaiting: { to: 'running', label: 'Approve', icon: Check },
  running: { to: 'done', label: 'Complete', icon: Check },
  failed: { to: 'queued', label: 'Retry', icon: RotateCw },
  done: null
};

function TaskControl({ taskId, status }: { taskId: string; status: TaskRuntime }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = NEXT_STATUS[status];
  if (!next) return null;
  const Icon = pending ? Loader2 : next.icon;
  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          const res = await updateTaskStatus({ id: taskId, status: next.to });
          if (res.ok) router.refresh();
        })
      }
      disabled={pending}
      className="inline-flex flex-none items-center gap-1 rounded-lg border border-hairline bg-bg-1 px-2 py-1 text-[10.5px] font-medium text-fg-2 transition hover:bg-surface-2 disabled:opacity-60"
    >
      <Icon size={11} strokeWidth={2} className={cn(pending && 'animate-spin')} aria-hidden />
      {next.label}
    </button>
  );
}

/* ---- Run button: propose a gated run for a queued task ------------------- */

function RunButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await runTask(taskId);
            if (res.ok) router.refresh();
            else setError(res.error);
          })
        }
        disabled={pending}
        className="inline-flex flex-none items-center gap-1 rounded-lg border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2 py-1 text-[10.5px] font-semibold text-azure-1 transition hover:brightness-105 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 size={11} className="animate-spin" aria-hidden />
        ) : (
          <Sparkles size={11} strokeWidth={2} aria-hidden />
        )}
        Run
      </button>
      {error ? <span className="text-[9.5px] text-danger">{error}</span> : null}
    </span>
  );
}

/* ---- Confirm card: approve / reject a proposed run ----------------------- */

function ProposalCard({
  proposal,
  agentName
}: {
  proposal: TaskProposalSummary;
  agentName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pendingDecision, setPendingDecision] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function decide(decision: 'approved' | 'rejected') {
    start(async () => {
      setError(null);
      setPendingDecision(decision);
      const res = await decideTaskRun({ runId: proposal.runId, decision });
      if (res.ok) router.refresh();
      else setError(res.error);
      setPendingDecision(null);
    });
  }

  return (
    <div className="ml-[46px] mt-1 rounded-xl border border-[var(--gold-line,var(--azure-line))] bg-[var(--gold-soft,var(--azure-soft))] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4">
        {agentName} proposes · {proposal.action}
      </p>
      {proposal.steps.length > 0 ? (
        <ol className="mt-1.5 flex flex-col gap-1">
          {proposal.steps.map((step, i) => (
            <li key={i} className="flex gap-2 text-[11.5px] text-fg-2">
              <span className="flex-none font-semibold text-azure-1">{i + 1}.</span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => decide('approved')}
          disabled={pending}
          className="inline-flex flex-none items-center gap-1 rounded-lg bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-2.5 py-1 text-[10.5px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {pending && pendingDecision === 'approved' ? (
            <Loader2 size={11} className="animate-spin" aria-hidden />
          ) : (
            <Check size={11} strokeWidth={2.4} aria-hidden />
          )}
          Approve
        </button>
        <button
          type="button"
          onClick={() => decide('rejected')}
          disabled={pending}
          className="inline-flex flex-none items-center gap-1 rounded-lg border border-hairline bg-bg-1 px-2.5 py-1 text-[10.5px] font-medium text-fg-2 transition hover:bg-surface-2 disabled:opacity-60"
        >
          {pending && pendingDecision === 'rejected' ? (
            <Loader2 size={11} className="animate-spin" aria-hidden />
          ) : (
            <X size={11} strokeWidth={2} aria-hidden />
          )}
          Reject
        </button>
      </div>
      {error ? <p className="mt-1 text-[10px] text-danger">{error}</p> : null}
    </div>
  );
}

/* ---- Inline assign composer --------------------------------------------- */

function AssignComposer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const t = title.trim();
    if (!t) return;
    setError(null);
    start(async () => {
      const res = await assignTask({ agentSlug: slug, title: t });
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`assign-task-${slug}`} className="sr-only">
          Assign a task to this specialist
        </label>
        <input
          id={`assign-task-${slug}`}
          aria-label="Assign a task"
          aria-describedby={error ? `assign-task-${slug}-error` : undefined}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Assign a task…"
          className="h-8 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-2 px-2.5 text-[12px] text-fg-1 outline-none placeholder:text-fg-5 focus:border-[var(--azure-1)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || title.trim().length === 0}
          className="inline-flex h-8 flex-none items-center gap-1 rounded-lg bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-2.5 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : 'Assign'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="flex h-8 w-7 flex-none items-center justify-center rounded-lg text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
        >
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      </div>
      {error ? (
        <p id={`assign-task-${slug}-error`} className="text-[10.5px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---- Agent card --------------------------------------------------------- */

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }
};

function AgentCard({
  agent,
  summary,
  reduce
}: {
  agent: AgentStatus;
  summary: AgentTaskSummary | undefined;
  reduce: boolean | null;
}) {
  const member = getMemberOrCOO(agent.slug);
  const state = resolveState(agent, summary);
  const meta = STATE_META[state];
  const animated = state === 'working' || state === 'awaiting';
  const [composing, setComposing] = useState(false);

  const current = summary?.current;
  const statusText = current?.title ?? agent.status;

  return (
    <motion.li
      variants={reduce ? undefined : cardVariants}
      className={cn(
        'relative flex flex-col gap-1.5 overflow-hidden rounded-xl border bg-bg-1 px-3 py-2.5 transition-colors',
        animated ? 'border-[var(--azure-line)]' : 'border-hairline'
      )}
    >
      <div className="flex items-center gap-3">
        {/* avatar with working presence */}
        <span className="relative flex-none">
          {state === 'working' && !reduce ? (
            <>
              <motion.span
                aria-hidden
                className="pointer-events-none absolute -inset-1.5 rounded-full"
                style={{
                  background: 'radial-gradient(circle, var(--azure-soft), transparent 70%)'
                }}
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
            {summary && summary.open > 0 ? (
              <Badge tone="azure" className="flex-none text-[9px]">
                {summary.open} open
              </Badge>
            ) : agent.onPoint ? (
              <Badge tone="azure" dot className="flex-none text-[9px]">
                On point
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-[11px] text-fg-4">{statusText}</p>
        </div>

        {/* state dot */}
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{
            background: meta.color,
            boxShadow: animated ? `0 0 8px ${meta.color}` : undefined
          }}
          aria-label={meta.label}
        />
      </div>

      {/* working shimmer */}
      {state === 'working' && !reduce ? (
        <div className="ml-[46px] h-0.5 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="h-full w-1/3 rounded-full bg-azure-1"
            animate={{ x: ['-130%', '330%'] }}
            transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      ) : null}

      {/* controls row */}
      <div className="ml-[46px] flex flex-wrap items-center gap-1.5">
        {current ? (
          current.status === 'queued' || current.status === 'blocked' ? (
            <RunButton taskId={current.id} />
          ) : current.status === 'awaiting' ? null : (
            <TaskControl taskId={current.id} status={current.status} />
          )
        ) : summary?.retryable ? (
          <TaskControl taskId={summary.retryable.id} status="failed" />
        ) : null}
        {!composing ? (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10.5px] font-medium text-azure-1 transition hover:bg-surface-2"
          >
            <Plus size={11} strokeWidth={2.4} aria-hidden /> Assign
          </button>
        ) : null}
      </div>

      {current?.status === 'awaiting' ? (
        current.proposal ? (
          <ProposalCard proposal={current.proposal} agentName={member.name} />
        ) : (
          // Brief window between the task moving to 'awaiting' and the proposal
          // attaching — show a placeholder, never a bare Approve without steps.
          <p className="ml-[46px] mt-1 text-[11px] text-fg-4" aria-live="polite">
            Preparing the plan…
          </p>
        )
      ) : null}

      {composing ? <AssignComposer slug={agent.slug} onClose={() => setComposing(false)} /> : null}
    </motion.li>
  );
}

/* ---- Section ------------------------------------------------------------ */

export function TeamTasks({
  team,
  taskSummaries
}: {
  team: AgentStatus[];
  taskSummaries?: TeamTaskMap;
}) {
  const reduce = useReducedMotion();
  const summaries = taskSummaries ?? {};

  // Order: real open workload first, then on-point, then the rest.
  const ordered = [...team].sort((a, b) => {
    const ao = summaries[a.slug]?.open ?? 0;
    const bo = summaries[b.slug]?.open ?? 0;
    if (ao !== bo) return bo - ao;
    return Number(b.onPoint) - Number(a.onPoint);
  });

  const openTotal = team.reduce((n, t) => n + (summaries[t.slug]?.open ?? 0), 0);
  const onPointCount = team.filter((t) => t.onPoint).length;

  const active = ordered
    .map((a) => {
      const s = summaries[a.slug];
      if (s?.current) return { name: getMemberOrCOO(a.slug).name, status: s.current.status };
      if (a.onPoint) return { name: getMemberOrCOO(a.slug).name, status: a.status };
      return null;
    })
    .filter((x): x is { name: string; status: string } => x !== null)
    .slice(0, 6);

  return (
    <Card className="p-5" data-testid="team-tasks">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="The executive desk · who's on it" title="Team tasks" />
        <Badge tone="azure" className="text-[10px]">
          {openTotal > 0 ? `${openTotal} open` : `${onPointCount} on point`}
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
              <AgentCard key={a.slug} agent={a} summary={summaries[a.slug]} reduce={reduce} />
            ))}
          </motion.ul>
        </>
      )}
    </Card>
  );
}

export default TeamTasks;
