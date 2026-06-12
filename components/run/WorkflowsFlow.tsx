'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Banknote,
  Briefcase,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Landmark,
  ListChecks,
  Mail,
  PenLine,
  Radar,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { advanceWorkflowTask, seedWorkflows, setWorkflowAutomation } from '@/lib/run-ops/actions';
import {
  TASK_MOVE,
  TASK_TONE,
  WF_AUTOMATIONS,
  WF_COLUMNS,
  WORKFLOW_BASELINE,
  automationStatusLabel,
  isTaskStatus,
  nextTaskStatus,
  streamIconKey,
  taskRunDraft,
  taskRunSteps,
  workflowPosture,
  type StreamIconKey,
  type TaskStatus
} from '@/lib/run-ops/vocabulary';
import type { AutomationState, TaskView, WorkflowGroup } from '@/lib/queries/run-ops';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done'
};

const TONE_DOT: Record<TaskStatus, string> = {
  todo: 'var(--warning)',
  doing: 'var(--azure-1)',
  done: 'var(--success)'
};

const STREAM_ICONS: Record<StreamIconKey, LucideIcon> = {
  rocket: Rocket,
  landmark: Landmark,
  briefcase: Briefcase,
  'user-plus': UserPlus,
  'calendar-clock': CalendarClock,
  'list-checks': ListChecks
};

const AUTOMATION_ICONS: Record<(typeof WF_AUTOMATIONS)[number]['icon'], LucideIcon> = {
  mail: Mail,
  'shield-check': ShieldCheck,
  radar: Radar,
  banknote: Banknote
};

function taskStatus(t: TaskView): TaskStatus {
  return isTaskStatus(t.status) ? t.status : 'todo';
}

function taskAct(t: TaskView): string {
  return t.action ?? TASK_MOVE[taskStatus(t) === 'doing' ? 'doing' : 'todo'];
}

/* ── modal focus management (task + plan drawers) ────────────────────────── */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap focus inside a modal panel: focus the first focusable on mount, cycle
 * Tab/Shift+Tab, close on Escape, lock body scroll, and restore focus to the
 * opener on unmount.
 */
function useModalFocus(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  return panelRef;
}

function DrawerShell({
  label,
  onClose,
  children
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useModalFocus(onClose);
  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-[rgba(3,6,12,0.64)] backdrop-blur-[3px]"
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[440px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        {children}
      </div>
    </>
  );
}

/* ── the task detail drawer ──────────────────────────────────────────────── */

function TaskDrawer({
  task,
  onClose,
  onRun
}: {
  task: TaskView;
  onClose: () => void;
  onRun: (task: TaskView) => void;
}) {
  const status = taskStatus(task);
  const subDone = task.sub.filter((s) => s.done).length;
  const act = taskAct(task);

  return (
    <DrawerShell label={task.name} onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
          <ListChecks size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {task.critical && (
              <span className="flex-none rounded border border-[var(--gold-line)] bg-[var(--gold-soft)] px-1.5 py-px text-[8.5px] font-bold tracking-[0.04em] text-gold-1">
                CRITICAL
              </span>
            )}
            <span className="truncate text-[15px] font-semibold text-fg-1">{task.name}</span>
          </div>
          <div className="text-[11.5px] text-fg-4">
            {[task.who, task.dueLabel ?? STATUS_LABEL[status]].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1"
        >
          <X size={17} aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {task.drives && (
          <div className="flex items-center gap-2.5 rounded-[11px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-3">
            <Zap size={15} className="flex-none text-gold-1" aria-hidden />
            <span className="text-[12px] text-fg-2">
              <b className="text-gold-1">Why it matters:</b> {task.drives}.
            </span>
          </div>
        )}

        {task.sub.length > 0 && (
          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Subtasks · {subDone}/{task.sub.length}
            </div>
            <div className="flex flex-col gap-1.5">
              {task.sub.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-[9px] border border-hairline bg-surface-1 px-3 py-2"
                >
                  <span
                    className={
                      s.done
                        ? 'flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] border-success bg-success text-white'
                        : 'flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] border-[var(--border-strong)]'
                    }
                    aria-hidden
                  >
                    {s.done && <CheckCircle2 size={12} />}
                  </span>
                  <span
                    className={
                      s.done ? 'text-[12.5px] text-fg-4 line-through' : 'text-[12.5px] text-fg-2'
                    }
                  >
                    {s.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {status !== 'done' ? (
          <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
            <div className="mb-2 flex items-center gap-2">
              <EarnCoin size={24} />
              <span className="text-[12.5px] font-semibold text-gold-1">Earn&apos;s next move</span>
            </div>
            <div className="mb-3 text-[12px] leading-relaxed text-fg-2">
              {act} —{' '}
              {task.who
                ? `I'll handle it with ${task.who} and bring it back for your sign-off, moving the stream one step closer to done.`
                : "I'll prepare it and bring it back for your sign-off, moving the stream one step closer to done."}
            </div>
            <Button
              variant="gold"
              size="sm"
              icon={Sparkles}
              className="w-full"
              onClick={() => onRun(task)}
            >
              {act} with Earn
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
            <CheckCircle2 size={17} aria-hidden />
            Done · on the record
          </div>
        )}
      </div>
    </DrawerShell>
  );
}

/* ── the close-plan drawer — the stream's real sequence, in order ────────── */

function PlanDrawer({
  group,
  onClose,
  onOpenTask
}: {
  group: WorkflowGroup;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const posture = workflowPosture(group.tasks);
  return (
    <DrawerShell label={`${group.name} — plan`} onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
          <Calendar size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-fg-1">{group.name}</div>
          <div className="text-[11.5px] text-fg-4">
            {group.stream} · {posture.done}/{posture.total} complete
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1"
        >
          <X size={17} aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-1.5 p-5">
        {group.tasks.map((t, i) => {
          const status = taskStatus(t);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onOpenTask(t.id)}
              className="flex items-center gap-3 rounded-[11px] border border-hairline bg-surface-1 px-3.5 py-2.5 text-left hover:bg-surface-2"
            >
              <span className="w-5 flex-none text-[10.5px] text-fg-5 [font-feature-settings:'tnum']">
                {i + 1}
              </span>
              <span
                className="h-[7px] w-[7px] flex-none rounded-full"
                style={{ background: TONE_DOT[status] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg-1">
                {t.name}
              </span>
              {t.who && <span className="flex-none text-[10.5px] text-fg-4">{t.who}</span>}
              <Badge tone={TASK_TONE[status] as BadgeTone} className="px-2 py-0.5 text-[9px]">
                {t.dueLabel ?? STATUS_LABEL[status]}
              </Badge>
            </button>
          );
        })}
      </div>
    </DrawerShell>
  );
}

/* ── the workflows board ─────────────────────────────────────────────────── */

type RunnerState =
  | { type: 'seed' }
  | { type: 'task'; group: WorkflowGroup; task: TaskView; to: TaskStatus };

export function WorkflowsFlow({
  workflows,
  automations
}: {
  workflows: WorkflowGroup[];
  automations: Record<string, AutomationState>;
}) {
  const router = useRouter();
  const [streamId, setStreamId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Optimistic toggle state, re-synced whenever the server payload changes.
  const [prevAutomations, setPrevAutomations] = useState(automations);
  const [autoState, setAutoState] = useState(automations);
  if (prevAutomations !== automations) {
    setPrevAutomations(automations);
    setAutoState(automations);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const active = workflows.find((w) => w.id === streamId) ?? workflows[0] ?? null;
  const posture = active ? workflowPosture(active.tasks) : null;
  const allTasks = workflows.flatMap((w) => w.tasks);
  const doneCount = allTasks.filter((t) => taskStatus(t) === 'done').length;
  const openTask = active?.tasks.find((t) => t.id === openTaskId) ?? null;

  function runTask(group: WorkflowGroup, task: TaskView) {
    const to = nextTaskStatus(taskStatus(task));
    if (!to) return;
    setOpenTaskId(null);
    setPlanOpen(false);
    setRunner({ type: 'task', group, task, to });
  }

  async function toggleAutomation(key: string) {
    const prev = autoState[key];
    const enabled = !(prev?.enabled ?? false);
    setAutoState((s) => ({ ...s, [key]: { enabled, lastRunAt: prev?.lastRunAt ?? null } }));
    try {
      const res = await setWorkflowAutomation({ key, enabled });
      if (!res.ok) {
        setAutoState((s) => ({ ...s, [key]: prev ?? { enabled: false, lastRunAt: null } }));
        setToast(res.error);
        return;
      }
      router.refresh();
    } catch {
      setAutoState((s) => ({ ...s, [key]: prev ?? { enabled: false, lastRunAt: null } }));
      setToast('Could not update the automation. Try again.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* panel framing */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <ListChecks size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Workflows &amp; tasks
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              {active && posture
                ? `${active.name} · ${posture.done}/${posture.total} complete`
                : "Sterling's sequenced operating plan — every step starts and completes on your approval."}
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {doneCount}/{allTasks.length}
            </div>
            <div className="text-[10.5px] text-fg-5">steps done</div>
          </div>
        </div>
      </Card>

      {workflows.length === 0 ? (
        <Card className="p-8 text-center">
          <ListChecks size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No operating plan yet</h2>
          <p className="mx-auto mb-4 mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Sterling sequences your launch into work streams — formation, raise, and pipeline — each
            a real task list you drive through approvals.
          </p>
          <Button variant="gold" icon={Sparkles} onClick={() => setRunner({ type: 'seed' })}>
            Sequence my plan with Sterling
          </Button>
        </Card>
      ) : (
        active &&
        posture && (
          <Card className="p-[18px]">
            {/* stream selector */}
            <div className="mb-3.5 flex flex-wrap gap-2">
              {workflows.map((w) => {
                const on = w.id === active.id;
                const p = workflowPosture(w.tasks);
                const Icon = STREAM_ICONS[streamIconKey(w.stream)];
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      setStreamId(w.id);
                      setOpenTaskId(null);
                    }}
                    aria-pressed={on}
                    className={
                      on
                        ? 'flex items-center gap-2 rounded-[11px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2 text-left'
                        : 'flex items-center gap-2 rounded-[11px] border border-hairline bg-surface-1 px-3 py-2 text-left hover:bg-surface-2'
                    }
                  >
                    <span
                      className={
                        on
                          ? 'flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-accent text-white'
                          : 'flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3'
                      }
                    >
                      <Icon size={15} aria-hidden />
                    </span>
                    <span>
                      <span
                        className={
                          on
                            ? 'block text-[12.5px] font-semibold text-fg-1'
                            : 'block text-[12.5px] font-semibold text-fg-2'
                        }
                      >
                        {w.name}
                      </span>
                      <span className="block text-[10px] text-fg-5">
                        {w.stream} · {p.done}/{p.total}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* stream posture header */}
            <div className="mb-3.5 flex flex-wrap gap-3">
              <div
                className="min-w-[260px] flex-[2_1_280px] rounded-[12px] border border-hairline bg-surface-1 px-4 py-3.5"
                style={{
                  borderLeft: `3px solid ${posture.critOpen ? 'var(--warning)' : 'var(--success)'}`
                }}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2.5">
                  <span
                    className={
                      posture.critOpen
                        ? 'inline-flex items-center gap-1.5 rounded-full border border-[var(--warning-line)] bg-[var(--warning-soft)] px-3 py-1 text-[12.5px] font-bold text-warning'
                        : 'inline-flex items-center gap-1.5 rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] px-3 py-1 text-[12.5px] font-bold text-success'
                    }
                  >
                    <Zap size={14} aria-hidden />
                    {posture.critOpen
                      ? `${posture.critOpen} on the critical path`
                      : 'All critical items clear'}
                  </span>
                  <span className="text-[11.5px] text-fg-4">
                    {posture.open} open ·{' '}
                    {active.tasks.filter((t) => taskStatus(t) === 'doing').length} in motion
                  </span>
                </div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[11.5px] text-fg-3">
                    <b className="text-fg-1">
                      {posture.done}/{posture.total}
                    </b>{' '}
                    workstreams complete
                  </span>
                  <span className="text-[11px] text-fg-4">{posture.pct}% complete</span>
                </div>
                <div
                  className="h-[7px] w-full overflow-hidden rounded-full bg-surface-2"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-success transition-[width] duration-300"
                    style={{ width: `${posture.pct}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-col justify-center gap-2">
                {posture.critOpen > 0 ? (
                  <Button variant="secondary" size="sm" icon={ListChecks} disabled>
                    {posture.critOpen} blocking
                  </Button>
                ) : posture.open > 0 ? (
                  <Button
                    variant="gold"
                    size="sm"
                    icon={PenLine}
                    onClick={() => {
                      const next = active.tasks.find((t) => taskStatus(t) !== 'done');
                      if (next) setOpenTaskId(next.id);
                    }}
                  >
                    Proceed — next step
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" icon={CheckCircle2} disabled>
                    Stream complete
                  </Button>
                )}
                <Button variant="ghost" size="sm" icon={Calendar} onClick={() => setPlanOpen(true)}>
                  Close plan
                </Button>
              </div>
            </div>

            {/* kanban columns */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {WF_COLUMNS.map(({ status, label }) => {
                const items = active.tasks.filter((t) => taskStatus(t) === status);
                return (
                  <div key={status} className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 px-0.5">
                      <span
                        className="h-[7px] w-[7px] rounded-full"
                        style={{ background: TONE_DOT[status] }}
                        aria-hidden
                      />
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                        {label}
                      </span>
                      <span className="text-[10.5px] text-fg-5">{items.length}</span>
                    </div>
                    {items.length === 0 && (
                      <div className="rounded-[10px] border border-dashed border-hairline px-2.5 py-2.5 text-center text-[11px] text-fg-5">
                        —
                      </div>
                    )}
                    {items.map((t) => {
                      const isDone = status === 'done';
                      const subDone = t.sub.filter((s) => s.done).length;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setOpenTaskId(t.id)}
                          className={
                            isDone
                              ? 'rounded-[12px] border border-hairline bg-surface-1 px-3 py-3 text-left opacity-[0.74] hover:bg-surface-2'
                              : 'rounded-[12px] border border-hairline bg-surface-1 px-3 py-3 text-left hover:bg-surface-2'
                          }
                          style={{
                            borderTop: t.critical
                              ? '2px solid var(--gold-1)'
                              : '2px solid transparent'
                          }}
                        >
                          <div className="mb-1.5 flex items-center gap-1.5">
                            {t.critical && (
                              <span className="rounded border border-[var(--gold-line)] bg-[var(--gold-soft)] px-1.5 py-px text-[8.5px] font-bold tracking-[0.04em] text-gold-1">
                                CRITICAL
                              </span>
                            )}
                            {t.dueLabel && (
                              <span className="ml-auto text-[10px] text-fg-5">{t.dueLabel}</span>
                            )}
                          </div>
                          <div className="text-[12.5px] font-semibold leading-[1.3] text-fg-1">
                            {t.name}
                          </div>
                          {t.drives && (
                            <div className="mt-1 text-[10.5px] text-fg-5">{t.drives}</div>
                          )}
                          <div className="mt-2 flex items-center gap-2">
                            {t.who && (
                              <>
                                <Avatar name={t.who} size={20} tone="azure" />
                                <span className="text-[10.5px] text-fg-4">{t.who}</span>
                              </>
                            )}
                            <span className="flex-1" />
                            {t.sub.length > 0 && (
                              <span className="text-[10px] text-fg-5 [font-feature-settings:'tnum']">
                                {subDone}/{t.sub.length}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </Card>
        )
      )}

      {/* the automations strip — real org-scoped toggles, honest outcomes */}
      <Card className="p-[18px]">
        <div className="mb-2.5 flex items-center gap-1.5">
          <Zap size={12} className="text-gold-1" aria-hidden />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Automations · Earn runs these for you
          </span>
          <Badge tone="neutral" className="ml-1 px-1.5 py-0 text-[8.5px]">
            Illustrative
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WF_AUTOMATIONS.map((a) => {
            const state = autoState[a.key];
            const on = state?.enabled ?? false;
            const Icon = AUTOMATION_ICONS[a.icon];
            return (
              <div
                key={a.key}
                className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-3 py-2.5"
              >
                <span
                  className={
                    on
                      ? 'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                      : 'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-4'
                  }
                >
                  <Icon size={15} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-fg-1">{a.name}</div>
                  <div className="truncate text-[10px] text-fg-5" title={a.desc}>
                    {automationStatusLabel(on, state?.lastRunAt ?? null)} · {a.desc}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${a.name} — ${on ? 'on' : 'off'}`}
                  title={a.desc}
                  onClick={() => toggleAutomation(a.key)}
                  className={
                    on
                      ? 'relative h-5 w-[34px] flex-none rounded-full bg-success transition-colors'
                      : 'relative h-5 w-[34px] flex-none rounded-full bg-surface-3 transition-colors'
                  }
                >
                  <span
                    className="absolute top-[2px] h-4 w-4 rounded-full bg-white transition-[left]"
                    style={{ left: on ? 16 : 2 }}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Sterling holds the sequence so nothing stalls in a
          gap — start a step, I prepare the work, and it completes on your approval.
        </p>
      </Card>

      {openTask && active && (
        <TaskDrawer
          task={openTask}
          onClose={() => setOpenTaskId(null)}
          onRun={(t) => runTask(active, t)}
        />
      )}

      {planOpen && active && (
        <PlanDrawer
          group={active}
          onClose={() => setPlanOpen(false)}
          onOpenTask={(id) => {
            setPlanOpen(false);
            setOpenTaskId(id);
          }}
        />
      )}

      {runner?.type === 'seed' && (
        <ActionRunner
          title="Sequence the operating plan"
          steps={[
            'Read your mandate and lifecycle stage',
            'Sequence the launch into work streams',
            'Stage the task lists',
            'Prepare for your approval'
          ]}
          draftTitle="Sterling's operating plan"
          draft={`${WORKFLOW_BASELINE.length} work streams — ${WORKFLOW_BASELINE.map((w) => w.stream.toLowerCase()).join(', ')} — with ${WORKFLOW_BASELINE.reduce((s, w) => s + w.tasks.length, 0)} sequenced steps, each with an owner, a why-it-matters line and a subtask checklist. Approving stands the plan up as real tasks you drive through approvals.`}
          approveLabel="Approve & sequence"
          onApprove={async () => {
            const res = await seedWorkflows();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast('Operating plan sequenced');
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'task' && (
        <ActionRunner
          title={`${taskAct(runner.task)} — ${runner.task.name}`}
          steps={taskRunSteps(runner.task.who, taskAct(runner.task))}
          draftTitle={runner.task.name}
          draft={taskRunDraft({
            name: runner.task.name,
            who: runner.task.who,
            drives: runner.task.drives,
            act: taskAct(runner.task),
            toLabel: STATUS_LABEL[runner.to]
          })}
          onApprove={async () => {
            const res = await advanceWorkflowTask({ taskId: runner.task.id, to: runner.to });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.task.name} — ${STATUS_LABEL[runner.to].toLowerCase()}`);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-[14px] border border-[var(--success-line)] bg-bg-2 px-4 py-3 shadow-[var(--shadow-lg)]">
          <ShieldCheck size={17} className="text-success" aria-hidden />
          <div>
            <div className="text-[13px] font-semibold text-fg-1">Earn completed an action</div>
            <div className="text-[11.5px] text-fg-4">{toast}</div>
          </div>
        </div>
      )}
    </div>
  );
}
