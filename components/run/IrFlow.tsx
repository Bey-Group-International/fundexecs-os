'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { markIrSent, seedIr } from '@/lib/run-ops/actions';
import { IR_BASELINE } from '@/lib/run-ops/vocabulary';
import type { IrItemView } from '@/lib/queries/run-ops';

function dueLabel(iso: string | null): string {
  if (!iso) return 'No date';
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${days}d`;
}

type RunnerState = { type: 'seed' } | { type: 'send'; item: IrItemView };

export function IrFlow({ items }: { items: IrItemView[] }) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const due = items.filter((i) => i.status === 'todo');

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Users size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              IR &amp; reporting
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Eleanor&apos;s LP cadence — the deliverables investors expect, on a clock, sent on
              your approval.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{due.length}</div>
            <div className="text-[10.5px] text-fg-5">deliverables due</div>
          </div>
        </div>
      </Card>

      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <Users size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No reporting cadence yet</h2>
          <p className="mx-auto mb-4 mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Eleanor sets the deliverables LPs expect — the quarterly letter, capital account
            statements, the pipeline update — each dated and driven to sent.
          </p>
          <Button variant="gold" icon={Sparkles} onClick={() => setRunner({ type: 'seed' })}>
            Set the cadence with Eleanor
          </Button>
        </Card>
      ) : (
        <Card className="p-[18px]">
          <div className="flex flex-col gap-1.5">
            {items
              .slice()
              .sort((a, b) => (a.status === 'todo' ? 0 : 1) - (b.status === 'todo' ? 0 : 1))
              .map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{i.cat}</div>
                    <div className="mt-0.5 text-[10.5px] text-fg-5">
                      {i.status === 'sent' ? 'Delivered' : dueLabel(i.dueAt)}
                    </div>
                  </div>
                  {i.status === 'todo' ? (
                    <>
                      <Badge
                        tone={dueLabel(i.dueAt).includes('overdue') ? 'danger' : 'azure'}
                        className="px-2 py-0.5 text-[9.5px]"
                      >
                        {dueLabel(i.dueAt)}
                      </Badge>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Sparkles}
                        onClick={() => setRunner({ type: 'send', item: i })}
                      >
                        Prepare &amp; send
                      </Button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-success">
                      <CheckCircle2 size={12} aria-hidden />
                      Sent
                    </span>
                  )}
                </div>
              ))}
          </div>
        </Card>
      )}

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Confidence between raises is built on cadence.
          Eleanor assembles every deliverable from your workspace — nothing reaches an LP until you
          approve.
        </p>
      </Card>

      {runner?.type === 'seed' && (
        <ActionRunner
          title="Set the reporting cadence"
          steps={[
            'Read your raise stage and LP roster',
            'Assemble the deliverable calendar',
            'Date each deliverable',
            'Prepare for your approval'
          ]}
          draftTitle="Eleanor's reporting cadence"
          draft={`${IR_BASELINE.length} dated deliverables: ${IR_BASELINE.map((i) => i.cat.toLowerCase()).join(', ')}. Approving stands the calendar up — each deliverable is then assembled and sent on your approval.`}
          approveLabel="Approve & set"
          onApprove={async () => {
            const res = await seedIr();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast('Reporting cadence set');
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'send' && (
        <ActionRunner
          title={`Prepare & send — ${runner.item.cat}`}
          steps={[
            'Assemble the deliverable from your workspace',
            'Cross-check the numbers',
            'Stage the distribution list',
            'Prepare for your approval'
          ]}
          draftTitle={`${runner.item.cat}`}
          draft={`${runner.item.cat}, assembled from your live workspace and staged for your LP list. Approving marks it sent on the cadence.`}
          approveLabel="Approve & send"
          onApprove={async () => {
            const res = await markIrSent(runner.item.id);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.item.cat} — sent`);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-[14px] border border-[var(--success-line)] bg-bg-2 px-4 py-3 shadow-[var(--shadow-lg)]">
          <ShieldCheck size={17} className="text-success" aria-hidden />
          <div>
            <div className="text-[13px] font-semibold text-fg-1">Earn completed an action</div>
            <div className="text-[11.5px] text-fg-4">{toast}</div>
          </div>
        </div>
      )}
    </div>
  );
}
