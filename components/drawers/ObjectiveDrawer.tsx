'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import { Drawer } from './Drawer';
import { EarnContextProvider } from '@/components/shell/earn/EarnContext';
import { createObjective, updateObjective } from '@/lib/actions/strategy';

export interface ObjectiveDraft {
  id?: string;
  objective: string;
  timeline: string | null;
  priority: 'high' | 'medium' | 'low';
}

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High priority' },
  { value: 'medium', label: 'Medium priority' },
  { value: 'low', label: 'Low priority' }
];

const TIMELINE_OPTIONS = [
  { value: '100-day', label: '100-day horizon' },
  { value: '30-day', label: '30-day horizon' },
  { value: '10-day', label: '10-day sprint' }
];

export function ObjectiveDrawer({
  open,
  onClose,
  initial
}: {
  open: boolean;
  onClose: () => void;
  /** When set, the drawer behaves as edit; when null/undefined, create. */
  initial?: ObjectiveDraft | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ObjectiveDraft>({
    objective: initial?.objective ?? '',
    timeline: initial?.timeline ?? '100-day',
    priority: initial?.priority ?? 'medium'
  });

  // Re-seed when the editing target changes.
  const initialKey = initial?.id ?? null;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (initialKey !== seededKey) {
    setSeededKey(initialKey);
    setDraft({
      objective: initial?.objective ?? '',
      timeline: initial?.timeline ?? '100-day',
      priority: initial?.priority ?? 'medium'
    });
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!draft.objective.trim()) {
      setError('Objective text is required.');
      return;
    }
    startTransition(async () => {
      const r = initial?.id
        ? await updateObjective(initial.id, {
            objective: draft.objective,
            timeline: draft.timeline,
            priority: draft.priority
          })
        : await createObjective({
            objective: draft.objective,
            timeline: draft.timeline,
            priority: draft.priority
          });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      onClose();
      router.refresh();
    });
  }

  const editing = Boolean(initial?.id);

  return (
    <EarnContextProvider
      value={{ kind: 'strategy', entityId: initial?.id, entityLabel: initial?.objective }}
    >
      <Drawer
        open={open}
        onClose={onClose}
        title={editing ? 'Edit objective' : 'New objective'}
        subtitle="Add a 100 / 30 / 10 objective to the active plan."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={onClose} data-testid="objective-cancel">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="objective-form"
              disabled={pending || !draft.objective.trim()}
              data-testid="objective-submit"
            >
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Add objective'}
            </Button>
          </>
        }
      >
        <form id="objective-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="objective-text" className="text-[12.5px] font-medium text-fg-3">
              Objective
            </label>
            <textarea
              id="objective-text"
              value={draft.objective}
              onChange={(e) => setDraft((d) => ({ ...d, objective: e.target.value }))}
              required
              rows={3}
              className="w-full resize-y rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-sm text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
              placeholder="What outcome will this objective drive?"
              data-testid="objective-text"
            />
          </div>
          <Select
            label="Timeline"
            value={draft.timeline ?? '100-day'}
            onChange={(e) => setDraft((d) => ({ ...d, timeline: e.target.value }))}
            options={TIMELINE_OPTIONS}
            data-testid="objective-timeline"
          />
          <Select
            label="Priority"
            value={draft.priority}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                priority: e.target.value as ObjectiveDraft['priority']
              }))
            }
            options={PRIORITY_OPTIONS}
            data-testid="objective-priority"
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
    </EarnContextProvider>
  );
}

export default ObjectiveDrawer;
