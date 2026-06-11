'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, ListChecks, ShieldCheck, Sparkles } from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { advanceWorkflowTask, seedWorkflows } from '@/lib/run-ops/actions';
import {
  TASK_MOVE,
  WORKFLOW_BASELINE,
  isTaskStatus,
  nextTaskStatus,
  type TaskStatus
} from '@/lib/run-ops/vocabulary';
import type { TaskView, WorkflowGroup } from '@/lib/queries/run-ops';

const STATUS_TONE: Record<string, BadgeTone> = { todo: 'neutral', doing: 'azure', done: 'success' };
const STATUS_LABEL: Record<string, string> = { todo: 'To do', doing: 'In motion', done: 'Done' };

type RunnerState =
  | { type: 'seed' }
  | { type: 'task'; group: WorkflowGroup; task: TaskView; to: TaskStatus; label: string };

export function WorkflowsFlow({ workflows }: { workflows: WorkflowGroup[] }) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const allTasks = workflows.flatMap((w) => w.tasks);
  const doneCount = allTasks.filter((t) => t.status === 'done').length;

  return (
    <div className="flex flex-col gap-4">
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
              Sterling&apos;s sequenced operating plan — every step starts and completes on your
              approval.
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
        workflows.map((w) => (
          <Card key={w.id} className="p-[18px]">
            <div className="mb-3 flex items-center gap-2.5">
              <Badge tone="azure" className="px-2 py-0.5 text-[9.5px]">
                {w.stream}
              </Badge>
              <div className="text-[14px] font-semibold tracking-[-0.01em] text-fg-1">{w.name}</div>
              <span className="ml-auto text-[11px] text-fg-5 [font-feature-settings:'tnum']">
                {w.tasks.filter((t) => t.status === 'done').length}/{w.tasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {w.tasks.map((t) => {
                const status = isTaskStatus(t.status) ? t.status : 'todo';
                const to = nextTaskStatus(status);
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg-1">
                      {t.name}
                    </span>
                    <Badge tone={STATUS_TONE[status]} className="px-2 py-0.5 text-[9.5px]">
                      {STATUS_LABEL[status]}
                    </Badge>
                    {to ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Sparkles}
                        onClick={() =>
                          setRunner({
                            type: 'task',
                            group: w,
                            task: t,
                            to,
                            label: TASK_MOVE[status as Exclude<TaskStatus, 'done'>]
                          })
                        }
                      >
                        {TASK_MOVE[status as Exclude<TaskStatus, 'done'>]}
                      </Button>
                    ) : (
                      <CheckCircle2 size={15} className="flex-none text-success" aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Sterling holds the sequence so nothing stalls in a
          gap — start a step, I prepare the work, and it completes on your approval.
        </p>
      </Card>

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
          draft={`${WORKFLOW_BASELINE.length} work streams — ${WORKFLOW_BASELINE.map((w) => w.stream.toLowerCase()).join(', ')} — with ${WORKFLOW_BASELINE.reduce((s, w) => s + w.tasks.length, 0)} sequenced steps. Approving stands the plan up as real tasks you drive through approvals.`}
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
          title={`${runner.label} — ${runner.task.name}`}
          steps={[
            'Pull the step’s context',
            runner.to === 'doing' ? 'Stage the work' : 'Verify the outcome',
            'Update the stream',
            'Prepare for your approval'
          ]}
          draftTitle={`${runner.label} · ${runner.task.name}`}
          draft={`${runner.label} "${runner.task.name}" on the ${runner.group.stream} stream. Approving moves it to ${STATUS_LABEL[runner.to]}.`}
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
