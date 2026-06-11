'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  FileSignature,
  Landmark,
  Lock,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { executeClosingStep, openClosing } from '@/lib/closings/actions';
import {
  CLOSING_KIND_LABEL,
  STEP_SEQUENCE,
  isClosingKind,
  isStepDone,
  nextExecutableSeq,
  type ClosingKind
} from '@/lib/closings/sequence';
import { compactMoney } from '@/lib/format';
import type { ClosingCandidate, ClosingView } from '@/lib/queries/closings';
import { cn } from '@/lib/utils';

const KIND_TONE: Record<string, BadgeTone> = {
  deal: 'azure',
  lp_commitment: 'gold',
  engagement: 'info'
};

type RunnerState =
  | { type: 'open'; candidate: ClosingCandidate }
  | { type: 'step'; closing: ClosingView; seq: number; name: string; run: string[] };

export function ClosingsFlow({
  closings,
  candidates
}: {
  closings: ClosingView[];
  candidates: ClosingCandidate[];
}) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(
    closings.find((c) => c.status === 'open')?.id ?? null
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const open = closings.filter((c) => c.status === 'open');
  const atClose = open.reduce((s, c) => s + (c.amount ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <FileSignature size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Closings</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Commitment to close, step-gated — each step executes in order, on your approval, and
              the close lands on your record.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {atClose > 0 ? compactMoney(atClose) : open.length}
            </div>
            <div className="text-[10.5px] text-fg-5">
              {atClose > 0 ? 'in motion' : 'open closings'}
            </div>
          </div>
        </div>
      </Card>

      {/* open a closing */}
      {candidates.length > 0 && (
        <Card className="p-[18px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Sparkles size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Ready to close
              </div>
              <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                Open a signature room
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {candidates.map((c) => (
              <div
                key={`${c.kind}:${c.id}`}
                className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                  {c.kind === 'deal' ? (
                    <Building2 size={16} aria-hidden />
                  ) : (
                    <Landmark size={16} aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-fg-1">{c.name}</div>
                  <div className="text-[10.5px] text-fg-5">
                    {CLOSING_KIND_LABEL[c.kind]}
                    {c.amount ? ` · ${compactMoney(c.amount)}` : ''}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Sparkles}
                  onClick={() => setRunner({ type: 'open', candidate: c })}
                >
                  Open closing
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* the closings */}
      {closings.length === 0 ? (
        <Card className="p-8 text-center">
          <FileSignature size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">Nothing at close yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Drive a deal to Committed or lock an LP allocation on your Capital Map — it lands here
            as a signature room, step-gated to a funded close.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {closings.map((c) => {
            const expanded = openId === c.id;
            const gate = nextExecutableSeq(c.steps);
            const kindLabel = isClosingKind(c.kind) ? CLOSING_KIND_LABEL[c.kind] : c.kind;
            return (
              <Card key={c.id} className="p-0">
                <button
                  type="button"
                  onClick={() => setOpenId(expanded ? null : c.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-[18px] py-4 text-left"
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border',
                      c.status === 'closed'
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : 'border-hairline bg-surface-2 text-fg-3'
                    )}
                  >
                    {c.status === 'closed' ? (
                      <CheckCircle2 size={17} aria-hidden />
                    ) : (
                      <FileSignature size={17} aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-fg-1">
                      {c.counterparty ?? kindLabel}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-fg-5">
                      {kindLabel}
                      {c.amount ? ` · ${compactMoney(c.amount)}` : ''} · {c.progress.done}/
                      {c.progress.total} steps
                    </div>
                  </div>
                  <Badge tone={KIND_TONE[c.kind] ?? 'neutral'} className="px-2 py-0.5 text-[9.5px]">
                    {c.status === 'closed' ? 'Closed' : 'Open'}
                  </Badge>
                  <div className="w-24 flex-none">
                    <ProgressBar
                      value={c.progress.pct}
                      height={5}
                      label={`${c.counterparty ?? kindLabel} progress`}
                    />
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-[var(--border-faint)] px-[18px] py-4">
                    {c.progress.complete ? (
                      <div className="mb-3 flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3 text-[13px] font-semibold text-success">
                        <CheckCircle2 size={17} aria-hidden />
                        Closed{c.amount ? ` & funded · ${compactMoney(c.amount)}` : ''} — on your
                        record
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-1">
                      {c.steps.map((s) => {
                        const done = isStepDone(s.status);
                        const isNext = gate === s.seq && c.status === 'open';
                        const spec = isClosingKind(c.kind)
                          ? STEP_SEQUENCE[c.kind as ClosingKind][s.seq - 1]
                          : undefined;
                        return (
                          <div
                            key={s.id}
                            className={cn(
                              'flex items-center gap-3 rounded-[11px] border px-3 py-2.5',
                              isNext
                                ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                                : 'border-[var(--border-faint)] bg-surface-1'
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[10px] font-bold',
                                done
                                  ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                                  : isNext
                                    ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                                    : 'border-hairline bg-surface-2 text-fg-5'
                              )}
                            >
                              {done ? <Check size={12} strokeWidth={2.4} aria-hidden /> : s.seq}
                            </span>
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate text-[12.5px]',
                                done
                                  ? 'text-fg-3'
                                  : isNext
                                    ? 'font-semibold text-fg-1'
                                    : 'text-fg-5'
                              )}
                            >
                              {s.name}
                            </span>
                            {done ? (
                              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-success">
                                Done
                              </span>
                            ) : isNext ? (
                              <Button
                                variant="gold"
                                size="sm"
                                icon={Sparkles}
                                onClick={() =>
                                  setRunner({
                                    type: 'step',
                                    closing: c,
                                    seq: s.seq,
                                    name: s.name,
                                    run: spec?.run ?? ['Execute the step', 'Verify', 'Record']
                                  })
                                }
                              >
                                Execute
                              </Button>
                            ) : (
                              <Lock size={13} className="text-fg-5" aria-hidden />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Closings fail in the gaps between steps. I hold the
          sequence — each step executes in order, nothing is skipped, and the close is logged the
          moment it lands.
        </p>
      </Card>

      {runner?.type === 'open' && (
        <ActionRunner
          title={`Open the closing — ${runner.candidate.name}`}
          steps={[
            'Pull the committed terms',
            'Stage the signature room',
            'Sequence the execution steps',
            'Prepare for your approval'
          ]}
          draftTitle={`Signature room · ${runner.candidate.name}`}
          draft={`A ${CLOSING_KIND_LABEL[runner.candidate.kind].toLowerCase()} room for ${runner.candidate.name}${runner.candidate.amount ? ` (${compactMoney(runner.candidate.amount)})` : ''} with the ${STEP_SEQUENCE[runner.candidate.kind].length}-step sequence staged — ${STEP_SEQUENCE[
            runner.candidate.kind
          ]
            .map((s) => s.name.toLowerCase())
            .join(' → ')}. Approving opens the room; each step then executes on your approval.`}
          approveLabel="Approve & open"
          onApprove={async () => {
            const res = await openClosing({
              kind: runner.candidate.kind,
              counterparty: runner.candidate.name,
              amount: runner.candidate.amount
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`Signature room opened — ${runner.candidate.name}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'step' && (
        <ActionRunner
          title={`${runner.name} — ${runner.closing.counterparty ?? 'closing'}`}
          steps={[...runner.run, 'Prepare for your approval']}
          draftTitle={runner.name}
          draft={`Step ${runner.seq} of ${runner.closing.progress.total} for ${runner.closing.counterparty ?? 'this closing'} — ${runner.name.toLowerCase()}. Approving executes it and arms the next step; the final step closes the room and logs the close to your record.`}
          approveLabel="Approve & execute"
          onApprove={async () => {
            const res = await executeClosingStep({
              closingId: runner.closing.id,
              seq: runner.seq
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(
              runner.seq === runner.closing.progress.total
                ? `${runner.closing.counterparty ?? 'Closing'} — closed & recorded`
                : `${runner.name} — executed`
            );
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
