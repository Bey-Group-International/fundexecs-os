'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import { Drawer } from '@/components/drawers/Drawer';
import { upsertObjection } from '@/lib/actions/objections';
import type { ObjectionItem } from '@/lib/queries/objections';

/** Common objection categories in a capital raise. Free text still allowed. */
const CATEGORY_OPTIONS = [
  { value: 'fees', label: 'Fees & terms' },
  { value: 'track_record', label: 'Track record' },
  { value: 'team', label: 'Team' },
  { value: 'strategy', label: 'Strategy / thesis' },
  { value: 'timing', label: 'Timing' },
  { value: 'fund_size', label: 'Fund size' },
  { value: 'liquidity', label: 'Liquidity' },
  { value: 'other', label: 'Other' }
];

export interface ObjectionDrawerProps {
  open: boolean;
  onClose: () => void;
  lps: Array<{ id: string; name: string }>;
  /** When set, the drawer edits this objection in place. */
  editing?: ObjectionItem | null;
}

export function ObjectionDrawer({ open, onClose, lps, editing }: ObjectionDrawerProps) {
  const router = useRouter();
  const isEdit = Boolean(editing);

  const [lpId, setLpId] = useState(editing?.lpId ?? lps[0]?.id ?? '');
  const [category, setCategory] = useState(editing?.category ?? CATEGORY_OPTIONS[0].value);
  const [objection, setObjection] = useState(editing?.objection ?? '');
  const [rebuttal, setRebuttal] = useState(editing?.rebuttal ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!lpId || !objection.trim() || !category.trim()) return;
    setError(null);
    setPending(true);
    const result = await upsertObjection({
      id: editing?.id,
      lpId,
      category,
      objection,
      rebuttal,
      status: editing?.status
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
    router.refresh();
  }

  const lpOptions = lps.map((l) => ({ value: l.id, label: l.name }));
  const canSubmit = Boolean(lpId && objection.trim() && category.trim());

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit objection' : 'Log objection'}
      subtitle={
        isEdit
          ? 'Refine the objection, its category, or the drafted rebuttal.'
          : 'Capture an LP objection and draft the rebuttal you’ll send.'
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="objection-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="objection-form"
            disabled={pending || !canSubmit}
            data-testid="objection-submit"
          >
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Log objection'}
          </Button>
        </>
      }
    >
      <form id="objection-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {lpOptions.length > 0 ? (
          <Select
            label="LP"
            value={lpId}
            onChange={(e) => setLpId(e.target.value)}
            options={lpOptions}
            data-testid="objection-lp"
          />
        ) : (
          <div className="rounded-xl border border-[var(--warning-line)] bg-[var(--warning-soft)] px-3 py-2.5 text-[12px] text-warning">
            Add a capital provider first — objections are tied to an LP.
          </div>
        )}

        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={CATEGORY_OPTIONS}
          data-testid="objection-category"
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="objection-text" className="text-[12.5px] font-medium text-fg-3">
            Objection
          </label>
          <textarea
            id="objection-text"
            required
            rows={3}
            value={objection}
            onChange={(e) => setObjection(e.target.value)}
            placeholder="“Your fees are above market for a debut fund.”"
            data-testid="objection-text"
            className="w-full resize-y rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-sm text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="objection-rebuttal" className="text-[12.5px] font-medium text-fg-3">
            Rebuttal <span className="font-normal text-fg-5">· optional</span>
          </label>
          <textarea
            id="objection-rebuttal"
            rows={4}
            value={rebuttal}
            onChange={(e) => setRebuttal(e.target.value)}
            placeholder="How you’ll respond — terms context, comparables, structure."
            data-testid="objection-rebuttal"
            className="w-full resize-y rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-sm text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>

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

export default ObjectionDrawer;
