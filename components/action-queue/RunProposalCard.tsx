'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Clock, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { decideTaskRun } from '@/lib/actions/tasks';
import type { PendingRun } from '@/lib/queries/action-queue';

/* A single pending proposal: the specialist, the task, the planned steps, and
 * the approve / reject controls. Approve authorizes the run (and triggers its
 * executor server-side); reject blocks it. Both refresh the queue. */
export function RunProposalCard({ run }: { run: PendingRun }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<'approved' | 'rejected' | null>(null);

  function decide(decision: 'approved' | 'rejected') {
    setError(null);
    setActing(decision);
    startTransition(async () => {
      const res = await decideTaskRun({ runId: run.runId, decision });
      if (!res.ok) {
        setError(res.error);
        setActing(null);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-4">
            <span>{run.agentName}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{run.agentPosition}</span>
          </div>
          <h3 className="mt-1 truncate text-[14.5px] font-semibold text-fg-1">{run.taskTitle}</h3>
          <p className="mt-0.5 text-[13px] text-fg-2">{run.action}</p>
        </div>
        <span className="flex flex-none items-center gap-1 text-[11px] text-fg-4">
          <Clock size={12} aria-hidden />
          {new Date(run.proposedAt).toLocaleDateString()}
        </span>
      </div>

      {run.steps.length > 0 && (
        <ol className="mt-3 space-y-1.5">
          {run.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] text-fg-3">
              <ChevronRight size={13} className="mt-0.5 flex-none text-fg-4" aria-hidden />
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={Check}
          disabled={pending}
          onClick={() => decide('approved')}
        >
          {acting === 'approved' && pending ? 'Approving…' : 'Approve'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={X}
          disabled={pending}
          onClick={() => decide('rejected')}
        >
          {acting === 'rejected' && pending ? 'Rejecting…' : 'Reject'}
        </Button>
      </div>
    </Card>
  );
}
