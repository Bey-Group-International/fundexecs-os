'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import { Drawer } from './Drawer';
import { addServiceProvider } from '@/lib/actions/partners';

const CATEGORY_OPTIONS = [
  { value: 'legal', label: 'Legal counsel' },
  { value: 'fund_admin', label: 'Fund administrator' },
  { value: 'placement', label: 'Placement agent' },
  { value: 'prime_broker', label: 'Prime broker' },
  { value: 'audit_tax', label: 'Audit & tax' },
  { value: 'general', label: 'Other' }
];

export function NewPartnerDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('legal');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setCategory('legal');
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const result = await addServiceProvider({ name, category });
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
      title="Add partner"
      subtitle="Add a service provider to your capital stack."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="new-partner-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="new-partner-form"
            disabled={pending || !name.trim()}
            data-testid="new-partner-submit"
          >
            {pending ? 'Saving…' : 'Add partner'}
          </Button>
        </>
      }
    >
      <form id="new-partner-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Partner name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Cooley LLP"
          data-testid="new-partner-name"
        />
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={CATEGORY_OPTIONS}
          data-testid="new-partner-category"
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

export default NewPartnerDrawer;
