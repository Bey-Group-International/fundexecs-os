'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Building2, Sparkles } from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { runDiligenceForDeal } from '@/lib/actions/diligence';
import { cn } from '@/lib/utils';

export interface DiligenceDealOption {
  id: string;
  name: string;
  stage: string;
}

/**
 * "Review this deal like an institutional LP" — pick a pipeline deal and run
 * the real 7-agent diligence orchestration through the approve loop. The
 * approve performs the full run (ingest-backed agents + synthesis), so the
 * executing state can take a minute; success navigates straight to the verdict.
 */
export function StartDiligence({ deals }: { deals: DiligenceDealOption[] }) {
  const router = useRouter();
  const [running, setRunning] = useState<DiligenceDealOption | null>(null);
  const [completedRunId, setCompletedRunId] = useState<string | null>(null);

  if (deals.length === 0) return null;

  return (
    <Card className="p-[18px]">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <Sparkles size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            New review
          </div>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
            Run the committee on a deal
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {deals.map((d) => (
          <div
            key={d.id}
            className={cn(
              'flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3'
            )}
          >
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Building2 size={16} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-fg-1">{d.name}</div>
              <div className="truncate text-[10.5px] capitalize text-fg-5">
                {d.stage.replace(/-/g, ' ')}
              </div>
            </div>
            <Badge tone="azure" className="px-2 py-0.5 text-[9.5px]">
              7 agents
            </Badge>
            <Button variant="secondary" size="sm" icon={Sparkles} onClick={() => setRunning(d)}>
              Run diligence
            </Button>
          </div>
        ))}
      </div>

      {running && (
        <ActionRunner
          title={`Run diligence — ${running.name}`}
          steps={[
            'Retrieve the deal’s ingested documents',
            'Run the six analyst agents over the evidence',
            'Have Earn synthesize the IC memo',
            'Prepare the verdict for your review'
          ]}
          draftTitle={`Committee review · ${running.name}`}
          draft={`The full 7-agent review of ${running.name} — six analysts score market, competition, demand, unit economics, stress and red flags over the deal's documents, then Earn synthesizes the IC memo, recommendation and conviction. Approving runs the committee now (it can take a minute) and the verdict is logged to your record.`}
          approveLabel="Approve & run the committee"
          onApprove={async () => {
            const res = await runDiligenceForDeal(running.id);
            if (!res.ok) return { ok: false, error: res.error };
            setCompletedRunId(res.runId);
            return { ok: true };
          }}
          onClose={() => setRunning(null)}
          onApplied={() => {
            if (completedRunId) router.push(`/run/diligence/${completedRunId}`);
            else router.refresh();
          }}
        />
      )}
    </Card>
  );
}
