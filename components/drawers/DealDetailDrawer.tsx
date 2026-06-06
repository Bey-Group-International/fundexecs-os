'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Plus, Trash2, Scale, ArrowUpRight } from 'lucide-react';
import { Badge, Button, Input, Select } from '@/components/ui';
import { Drawer } from './Drawer';
import { updateDeal, updateDealStage, archiveDeal } from '@/lib/actions/deals';
import { createAllocation, deleteAllocation } from '@/lib/actions/allocations';
import { runDiligenceForDeal } from '@/lib/actions/diligence';

export interface DealDetailData {
  id: string;
  name: string;
  stage: string;
  status: string;
  amount: number | null;
  allocations: Array<{
    id: string;
    amount: number | null;
    status: string;
  }>;
  diligenceRuns: Array<{
    id: string;
    status: string;
    conviction: number | null;
    summary: string | null;
    createdAt: string;
  }>;
}

type DiligenceRunStatus = DealDetailData['diligenceRuns'][number]['status'];

function diligenceTone(status: DiligenceRunStatus): 'success' | 'azure' | 'danger' | 'neutral' {
  switch (status) {
    case 'complete':
      return 'success';
    case 'running':
    case 'queued':
      return 'azure';
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

const STAGE_OPTIONS = [
  { value: 'sourcing', label: 'Sourcing' },
  { value: 'screening', label: 'Screening' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'diligence', label: 'Diligence' },
  { value: 'ic', label: 'IC' },
  { value: 'closing', label: 'Closing' },
  { value: 'closed', label: 'Closed' }
];

function formatMoney(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

export function DealDetailDrawer({
  open,
  onClose,
  deal
}: {
  open: boolean;
  onClose: () => void;
  deal: DealDetailData | null;
}) {
  const router = useRouter();
  // Each interactive surface gets its own pending flag so that adding an
  // allocation does not put the parent "Save changes" button into Saving…
  // state, and a hung allocation request does not lock the whole drawer.
  const [savePending, startSave] = useTransition();
  const [stagePending, startStage] = useTransition();
  const [archivePending, startArchive] = useTransition();
  const [allocPending, startAlloc] = useTransition();
  const [diligencePending, startDiligence] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(deal?.name ?? '');
  const [amount, setAmount] = useState(deal?.amount?.toString() ?? '');
  const [stage, setStage] = useState(deal?.stage ?? 'sourcing');

  // Local form for adding an allocation.
  const [allocAmount, setAllocAmount] = useState('');
  const [allocStatus, setAllocStatus] = useState('proposed');

  // Reset local state when a different deal is opened.
  const dealKey = deal?.id ?? null;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (dealKey !== seededKey) {
    setSeededKey(dealKey);
    setName(deal?.name ?? '');
    setAmount(deal?.amount?.toString() ?? '');
    setStage(deal?.stage ?? 'sourcing');
    setAllocAmount('');
    setAllocStatus('proposed');
    setError(null);
  }

  // Defense in depth: if any pending state is stuck for more than 30s
  // (e.g. a future regression makes an action hang) we surface a clear
  // "timed out" message and clear the pending flags so the user can
  // retry instead of staring at "Saving…" forever.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anyPending =
    savePending || stagePending || archivePending || allocPending || diligencePending;
  useEffect(() => {
    if (!anyPending) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }
    timeoutRef.current = setTimeout(() => {
      setError(
        'This action took longer than 30 seconds. The change may still have saved — refresh to confirm.'
      );
    }, 30_000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [anyPending]);

  if (!deal) return null;

  function handleStage(next: string) {
    if (!deal || stagePending || next === stage) return;
    setStage(next);
    setError(null);
    startStage(async () => {
      const r = await updateDealStage(deal.id, next);
      if (!r.ok) {
        setStage(deal.stage);
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function handleSave() {
    if (!deal || savePending) return;
    setError(null);
    const parsed = amount ? Number(amount.replace(/[^0-9.]/g, '')) : null;
    startSave(async () => {
      const r = await updateDeal(deal.id, {
        name,
        amount: Number.isFinite(parsed) ? (parsed as number) : null
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function handleArchive() {
    if (!deal || archivePending) return;
    setError(null);
    startArchive(async () => {
      const r = await archiveDeal(deal.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  function handleAddAllocation() {
    if (!deal || allocPending) return;
    setError(null);
    const parsed = Number(allocAmount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Amount must be a positive number.');
      return;
    }
    startAlloc(async () => {
      const r = await createAllocation({
        dealId: deal.id,
        amount: parsed,
        status: allocStatus
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAllocAmount('');
      router.refresh();
    });
  }

  function handleRemoveAllocation(allocId: string) {
    if (allocPending) return;
    setError(null);
    startAlloc(async () => {
      const r = await deleteAllocation(allocId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRunDiligence() {
    if (!deal || diligencePending) return;
    setError(null);
    startDiligence(async () => {
      const r = await runDiligenceForDeal(deal.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={deal.name}
      subtitle={`Stage: ${stage} · ${formatMoney(deal.amount)}`}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleArchive}
            disabled={archivePending}
            icon={Trash2}
            data-testid="deal-detail-archive"
          >
            {archivePending ? 'Archiving…' : 'Archive deal'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={savePending}
            data-testid="deal-detail-save"
          >
            {savePending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Input
          label="Deal name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="deal-detail-name"
        />
        <Input
          label="Amount (USD)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          data-testid="deal-detail-amount"
        />
        <Select
          label="Stage"
          value={stage}
          onChange={(e) => handleStage(e.target.value)}
          options={STAGE_OPTIONS}
          disabled={stagePending}
          data-testid="deal-detail-stage"
        />
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Allocations
            </span>
            <span className="text-[11px] tabular-nums text-fg-5">
              {deal.allocations.length} logged
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {deal.allocations.length === 0 ? (
              <p className="text-[12px] text-fg-5">No allocations yet.</p>
            ) : (
              deal.allocations.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border border-hairline bg-surface-1 px-3 py-2"
                >
                  <span className="font-mono text-[12px] tabular-nums text-fg-1">
                    {formatMoney(a.amount)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone="azure" className="text-[10px]">
                      {a.status}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => handleRemoveAllocation(a.id)}
                      aria-label="Remove allocation"
                      disabled={allocPending}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-fg-4 transition hover:text-danger disabled:opacity-50"
                      data-testid={`allocation-delete-${a.id}`}
                    >
                      <Trash2 size={12} strokeWidth={1.9} aria-hidden />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 rounded-xl border border-dashed border-hairline-faint p-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Log new allocation
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Input
                aria-label="Allocation amount"
                placeholder="500000"
                inputMode="numeric"
                value={allocAmount}
                onChange={(e) => setAllocAmount(e.target.value)}
                data-testid="allocation-amount"
              />
              <Select
                aria-label="Allocation status"
                value={allocStatus}
                onChange={(e) => setAllocStatus(e.target.value)}
                options={[
                  { value: 'proposed', label: 'Proposed' },
                  { value: 'accepted', label: 'Accepted' },
                  { value: 'committed', label: 'Committed' },
                  { value: 'declined', label: 'Declined' }
                ]}
                data-testid="allocation-status"
              />
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={handleAddAllocation}
                disabled={allocPending || !allocAmount.trim()}
                data-testid="allocation-add"
              >
                {allocPending ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              <Scale size={12} strokeWidth={1.9} aria-hidden />
              Diligence
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={Scale}
              onClick={handleRunDiligence}
              disabled={diligencePending}
              data-testid="deal-detail-run-diligence"
            >
              {diligencePending ? 'Running…' : 'Run diligence'}
            </Button>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {deal.diligenceRuns.length === 0 ? (
              <p className="text-[12px] text-fg-5">
                No diligence runs yet. Run Earn&rsquo;s committee on this deal.
              </p>
            ) : (
              deal.diligenceRuns.map((run) => (
                <Link
                  key={run.id}
                  href={`/diligence/${run.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface-1 px-3 py-2 transition hover:border-[var(--accent-line)]"
                  data-testid={`diligence-run-${run.id}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg-1">
                    {run.summary || 'Diligence review'}
                  </span>
                  <div className="flex flex-none items-center gap-1.5">
                    {run.conviction != null ? (
                      <span className="font-mono text-[11px] tabular-nums text-fg-3">
                        {run.conviction}
                      </span>
                    ) : null}
                    <Badge tone={diligenceTone(run.status)} className="text-[10px]">
                      {run.status}
                    </Badge>
                    <ArrowUpRight size={13} strokeWidth={1.9} className="text-fg-4" aria-hidden />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </div>
        ) : null}
        <div className="text-[11px] text-fg-5">
          Advance the stage to log a Chain-of-Trust event.
          <ArrowRight size={12} className="ml-1 inline-block" aria-hidden />
        </div>
      </div>
    </Drawer>
  );
}

export default DealDetailDrawer;
