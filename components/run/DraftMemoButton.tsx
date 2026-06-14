'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { generateMemoFromDiligence } from '@/lib/actions/materials';

/* Draft an IC memo from a completed diligence run. Deterministic + gated: the
 * operator triggers it, it composes from the committee's findings, and the memo
 * lands in Materials as a draft for review. Disabled until the run completes. */
export function DraftMemoButton({ runId, status }: { runId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ready = status === 'complete';

  function draft() {
    setError(null);
    startTransition(async () => {
      const res = await generateMemoFromDiligence(runId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      router.push('/materials');
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        icon={FileText}
        disabled={!ready || pending || done}
        onClick={draft}
        title={ready ? undefined : 'Finish the diligence committee first'}
      >
        {pending ? 'Drafting…' : done ? 'Memo drafted' : 'Draft IC memo'}
      </Button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </div>
  );
}
