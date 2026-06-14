import { ListChecks } from 'lucide-react';
import { RunProposalCard } from './RunProposalCard';
import type { PendingRun } from '@/lib/queries/action-queue';

/* The Action Queue surface: every pending run proposal across the desk in one
 * approve / reject worklist. Honest empty state when the desk is clear. */
export function ActionQueueView({ runs }: { runs: PendingRun[] }) {
  return (
    <div className="fx-rise mx-auto max-w-[760px]">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-[20px] font-semibold text-fg-1">
          <ListChecks size={20} className="text-accent" aria-hidden />
          Action Queue
        </h1>
        <p className="mt-1 text-[13.5px] text-fg-3">
          Work your specialists have prepared and staged for your approval. Nothing runs until you
          approve it — every decision is recorded on the Chain of Trust.
        </p>
      </header>

      {runs.length === 0 ? (
        <div className="rounded-[14px] border border-hairline bg-surface-1 px-5 py-10 text-center">
          <p className="text-[14px] font-medium text-fg-2">Your queue is clear.</p>
          <p className="mt-1 text-[12.5px] text-fg-4">
            When a specialist prepares work that needs your sign-off, it lands here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <RunProposalCard key={run.runId} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
