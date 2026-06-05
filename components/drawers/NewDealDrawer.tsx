'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import { Drawer } from './Drawer';
import { createDeal } from '@/lib/actions/deals';

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

export function NewDealDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [stage, setStage] = useState('sourcing');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setStage('sourcing');
    setAmount('');
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const parsedAmount = amount ? Number(amount.replace(/[^0-9.]/g, '')) : null;
    const result = await createDeal({
      name,
      stage,
      amount: Number.isFinite(parsedAmount) ? (parsedAmount as number) : null
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    onClose();
    router.refresh();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add to pipeline"
      subtitle="Create a new deal in the active organization."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="new-deal-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="new-deal-form"
            disabled={pending || !name.trim()}
            data-testid="new-deal-submit"
          >
            {pending ? 'Saving…' : 'Add deal'}
          </Button>
        </>
      }
    >
      <form id="new-deal-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Deal name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project Atlas — SaaS rollup"
          data-testid="new-deal-name"
        />
        <Select
          label="Stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          options={STAGE_OPTIONS}
          data-testid="new-deal-stage"
        />
        <Input
          label="Amount (USD)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 12500000"
          inputMode="numeric"
          data-testid="new-deal-amount"
        />
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </div>
        ) : null}
      </form>
    </Drawer>
  );
}

export default NewDealDrawer;
