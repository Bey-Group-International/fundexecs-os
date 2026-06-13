'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Loader2, Radar, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { approveTasklet, dismissTasklet } from '@/lib/tasklets/actions';
import type { Tasklet, TaskletSignalSource } from '@/lib/tasklets/types';
import { cn } from '@/lib/utils';

/**
 * The tasklet queue — approve-ready cards the executive team drafted from real,
 * observed signals. One card = one signal → one routed draft → one decision.
 * Draft-only: Approve records the outcome to the Earn ledger + Chain of Trust
 * (the same approve loop Earn uses); Dismiss retires it. Used both as the
 * command-center "Today's tasklets" band and inside the Earn dock.
 */

const SOURCE_LABEL: Record<TaskletSignalSource, string> = {
  inbox: 'Inbox signal',
  loop_event: 'Pipeline signal',
  public_surface: 'Public inbound'
};

type Decision = { ok: boolean; message: string; href?: string };

export function TaskletQueue({
  initialTasklets,
  variant = 'band'
}: {
  initialTasklets: Tasklet[];
  variant?: 'band' | 'dock';
}) {
  const router = useRouter();
  const [tasklets, setTasklets] = useState<Tasklet[]>(initialTasklets);
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<Decision | null>(null);

  if (tasklets.length === 0) return null;

  async function decide(t: Tasklet, action: 'approve' | 'dismiss') {
    setPending(t.id);
    setResult(null);
    try {
      const res = action === 'approve' ? await approveTasklet(t.id) : await dismissTasklet(t.id);
      if (res.ok) {
        setTasklets((prev) => prev.filter((x) => x.id !== t.id));
        if (action === 'approve') setResult({ ok: true, message: res.message, href: res.href });
      } else {
        setResult({ ok: false, message: res.error });
      }
    } catch {
      setResult({ ok: false, message: 'Could not complete — try again.' });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={cn('flex flex-col', variant === 'dock' ? 'gap-2' : 'gap-2.5')}>
      {tasklets.map((t) => (
        <div
          key={t.id}
          className="rounded-[12px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-3"
        >
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-5">
            <Radar size={11} className="text-azure-1" aria-hidden />
            {SOURCE_LABEL[t.signalSource]}
            <span aria-hidden>·</span>
            <span className="text-gold-1">{t.specialistName}</span>
          </div>
          <div className="mt-1.5 text-[13px] font-semibold leading-snug text-fg-1">{t.title}</div>
          {t.signalSummary && (
            <div className="mt-0.5 text-[11.5px] leading-snug text-fg-4">{t.signalSummary}</div>
          )}
          {t.draft && (
            <p className="mt-2 rounded-[9px] border border-hairline bg-surface-2 px-2.5 py-2 text-[11.5px] leading-relaxed text-fg-3">
              {t.draft}
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <Button
              variant="gold"
              size="sm"
              icon={pending === t.id ? Loader2 : Check}
              disabled={pending === t.id}
              onClick={() => void decide(t, 'approve')}
            >
              {pending === t.id ? 'Recording…' : 'Approve'}
            </Button>
            <button
              type="button"
              disabled={pending === t.id}
              onClick={() => void decide(t, 'dismiss')}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-fg-4 transition hover:bg-surface-2 hover:text-fg-2 disabled:opacity-50"
            >
              <X size={13} aria-hidden />
              Dismiss
            </button>
          </div>
        </div>
      ))}

      {result && (
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-[12px]',
            result.ok
              ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-fg-2'
              : 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger'
          )}
        >
          <Sparkles size={13} className="flex-none text-gold-1" aria-hidden />
          <span className="min-w-0 flex-1">{result.message}</span>
          {result.ok && result.href && (
            <button
              type="button"
              onClick={() => router.push(result.href!)}
              className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-azure-1"
            >
              Open
              <ArrowRight size={12} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
