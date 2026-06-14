'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Radar, Save } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { saveSourcingBrief, setSourcingBriefActive } from '@/lib/actions/sourcing-brief';
import type { SourcingBrief } from '@/lib/queries/sourcing-brief';

/* The standing sourcing brief editor. Marcus (Head of Deal Origination) works
 * this thesis on a schedule: each cycle stages a "scout targets" proposal in
 * the Action Queue for your approval — nothing runs until you approve. */
export function SourcingBriefCard({ brief }: { brief: SourcingBrief | null }) {
  const router = useRouter();
  const [thesis, setThesis] = useState(brief?.thesis ?? '');
  const [active, setActive] = useState(brief?.active ?? true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = thesis.trim() !== (brief?.thesis ?? '').trim();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveSourcingBrief({ thesis, active });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function toggleActive() {
    if (!brief) return; // nothing saved yet — Save sets the initial state
    const next = !active;
    setActive(next);
    setError(null);
    startTransition(async () => {
      const res = await setSourcingBriefActive(next);
      if (!res.ok) {
        setActive(!next); // revert on failure
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radar size={17} className="text-accent" aria-hidden />
          <h2 className="text-[14.5px] font-semibold text-fg-1">Standing sourcing brief</h2>
        </div>
        <button
          type="button"
          onClick={toggleActive}
          disabled={!brief || pending}
          className="flex items-center gap-1.5 text-[12px] text-fg-3 disabled:opacity-50"
          aria-pressed={active}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${active ? 'bg-success' : 'bg-fg-4'}`}
            aria-hidden
          />
          {active ? 'Active' : 'Paused'}
        </button>
      </div>

      <p className="mt-1 text-[12.5px] text-fg-3">
        The mandate Marcus scouts on a schedule. Each cycle stages on-thesis targets in your Action
        Queue for approval.
      </p>

      <textarea
        value={thesis}
        onChange={(e) => {
          setThesis(e.target.value);
          setSaved(false);
        }}
        rows={3}
        maxLength={1200}
        placeholder="e.g. Lower-middle-market B2B SaaS, $2–10M ARR, profitable or near, Southeast US; founder-led carve-outs welcome."
        className="mt-3 w-full resize-y rounded-[10px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg-1 placeholder:text-fg-4 focus:border-[var(--accent-line)] focus:outline-none"
      />

      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={Save}
          disabled={pending || !dirty || thesis.trim().length === 0}
          onClick={save}
        >
          {pending ? 'Saving…' : 'Save brief'}
        </Button>
        {saved && !dirty && <span className="text-[12px] text-success">Saved</span>}
      </div>
    </Card>
  );
}
