'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Input, Select } from '@/components/ui';
import { Drawer } from './Drawer';
import { updateDeal, updateDealStage, archiveDeal } from '@/lib/actions/deals';
import { createAllocation, deleteAllocation } from '@/lib/actions/allocations';

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
  const [pending, startTransition] = useTransition();
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

  if (!deal) return null;

  function refreshAndClear(msg: string | null = null) {
    setError(msg);
    router.refresh();
  }

  function handleStage(next: string) {
    if (!deal || pending || next === stage) return;
    setStage(next);
    startTransition(async () => {
      const r = await updateDealStage(deal.id, next);
      if (!r.ok) {
        setStage(deal.stage);
        refreshAndClear(r.error);
        return;
      }
      refreshAndClear(null);
    });
  }

  function handleSave() {
    if (!deal || pending) return;
    const parsed = amount ? Number(amount.replace(/[^0-9.]/g, '')) : null;
    startTransition(async () => {
      const r = await updateDeal(deal.id, {
        name,
        amount: Number.isFinite(parsed) ? (parsed as number) : null
      });
      if (!r.ok) {
        refreshAndClear(r.error);
        return;
      }
      refreshAndClear(null);
    });
  }

  function handleArchive() {
    if (!deal || pending) return;
    startTransition(async () => {
      const r = await archiveDeal(deal.id);
      if (!r.ok) {
        refreshAndClear(r.error);
        return;
      }
      onClose();
      refreshAndClear(null);
    });
  }

  function handleAddAllocation() {
    if (!deal || pending) return;
    const parsed = Number(allocAmount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Amount must be a positive number.');
      return;
    }
    startTransition(async () => {
      const r = await createAllocation({
        dealId: deal.id,
        amount: parsed,
        status: allocStatus
      });
      if (!r.ok) {
        refreshAndClear(r.error);
        return;
      }
      setAllocAmount('');
      refreshAndClear(null);
    });
  }

  function handleRemoveAllocation(allocId: string) {
    if (pending) return;
    startTransition(async () => {
      const r = await deleteAllocation(allocId);
      if (!r.ok) {
        refreshAndClear(r.error);
        return;
      }
      refreshAndClear(null);
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
            disabled={pending}
            icon={Trash2}
            data-testid="deal-detail-archive"
          >
            Archive deal
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={pending}
            data-testid="deal-detail-save"
          >
            {pending ? 'Saving…' : 'Save changes'}
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
          disabled={pending}
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
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-fg-4 transition hover:text-danger"
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
                disabled={pending || !allocAmount.trim()}
                data-testid="allocation-add"
              >
                Add
              </Button>
            </div>
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
