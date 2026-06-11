'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Landmark, Receipt, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Input } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Select } from '@/components/ui/Select';
import { SegTabs } from '@/components/ui/Tabs';
import { issueCapitalCall, resolveCallLp } from '@/lib/capital-calls/actions';
import {
  CALL_KIND_LABEL,
  CALL_RESOLVED_STATUS,
  isLpResolved,
  type CallKind
} from '@/lib/capital-calls/vocabulary';
import { compactMoney } from '@/lib/format';
import type { CallLpView, CapitalCallView } from '@/lib/queries/capital-calls';
import { cn } from '@/lib/utils';

type RunnerState =
  | {
      type: 'issue';
      kind: CallKind;
      label: string;
      total: number | null;
      pct: number | null;
      dueAt: string | null;
    }
  | { type: 'resolve'; call: CapitalCallView; line: CallLpView };

export function CapitalCallsFlow({
  calls,
  committedLps
}: {
  calls: CapitalCallView[];
  committedLps: string[];
}) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(
    calls.find((c) => c.status !== 'settled')?.id ?? null
  );

  const [kind, setKind] = useState<CallKind>('call');
  const [label, setLabel] = useState('');
  const [total, setTotal] = useState('');
  const [pct, setPct] = useState('');
  const [dueAt, setDueAt] = useState('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const totalNum = Number(total);
  const pctNum = Number(pct);
  const open = calls.filter((c) => c.status !== 'settled');
  const inMotion = open.reduce((s, c) => s + (c.total ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Receipt size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Capital calls
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Drawdowns and distributions against your committed roster — every LP line resolves on
              your approval, and a call settles only when the last one lands.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {inMotion > 0 ? compactMoney(inMotion) : open.length}
            </div>
            <div className="text-[10.5px] text-fg-5">
              {inMotion > 0 ? 'being called' : 'open calls'}
            </div>
          </div>
        </div>
      </Card>

      {/* issue a call */}
      {committedLps.length === 0 ? (
        <Card className="p-8 text-center">
          <Landmark size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No committed LPs yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Calls draw against real commitments. Work your Capital Map until an LP commits — the
            roster appears here the moment one does.
          </p>
        </Card>
      ) : (
        <Card className="p-[18px]">
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Sparkles size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Against {committedLps.length} committed LP{committedLps.length === 1 ? '' : 's'}
              </div>
              <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                Issue a {CALL_KIND_LABEL[kind].toLowerCase()}
              </div>
            </div>
            <SegTabs
              tabs={[
                { id: 'call', label: 'Capital call' },
                { id: 'distribution', label: 'Distribution' }
              ]}
              active={kind}
              onChange={(id) => setKind(id as CallKind)}
            />
          </div>
          <div className="grid gap-2.5 sm:grid-cols-[1fr_150px_110px_150px_auto] sm:items-end">
            <Input
              label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                kind === 'call' ? 'e.g. Call 1 — initial drawdown' : 'e.g. Q4 distribution'
              }
              maxLength={200}
            />
            <Input
              label="Total (USD)"
              type="number"
              min={1}
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="2500000"
            />
            <Input
              label="% of commit"
              type="number"
              min={1}
              max={100}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="10"
            />
            <Input
              label="Due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={Sparkles}
              disabled={!label.trim()}
              onClick={() =>
                setRunner({
                  type: 'issue',
                  kind,
                  label: label.trim(),
                  total: Number.isFinite(totalNum) && totalNum > 0 ? totalNum : null,
                  pct: Number.isFinite(pctNum) && pctNum > 0 && pctNum <= 100 ? pctNum : null,
                  dueAt: dueAt || null
                })
              }
            >
              Issue
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Users size={13} className="text-fg-5" aria-hidden />
            {committedLps.map((name) => (
              <Badge key={name} tone="neutral" className="px-2 py-0.5 text-[10px]">
                {name}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* the calls */}
      {calls.length === 0 ? (
        committedLps.length > 0 && (
          <Card className="p-8 text-center">
            <Receipt size={22} className="mx-auto text-fg-4" aria-hidden />
            <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No calls issued yet</h2>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              Issue your first drawdown above — every committed LP gets a line, and you track each
              one to funded.
            </p>
          </Card>
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          {calls.map((c) => {
            const expanded = openId === c.id;
            const settled = c.status === 'settled';
            const resolvedLabel = CALL_RESOLVED_STATUS[c.kind];
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
                      settled
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : 'border-hairline bg-surface-2 text-fg-3'
                    )}
                  >
                    {settled ? (
                      <CheckCircle2 size={17} aria-hidden />
                    ) : (
                      <Receipt size={17} aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-fg-1">{c.label}</div>
                    <div className="mt-0.5 text-[10.5px] text-fg-5">
                      {CALL_KIND_LABEL[c.kind]}
                      {c.total ? ` · ${compactMoney(c.total)}` : ''}
                      {c.pct ? ` · ${c.pct}% of commitments` : ''} · {c.progress.resolved}/
                      {c.progress.total} {resolvedLabel}
                    </div>
                  </div>
                  <Badge
                    tone={c.kind === 'call' ? 'gold' : 'info'}
                    className="px-2 py-0.5 text-[9.5px]"
                  >
                    {settled ? 'Settled' : 'Issued'}
                  </Badge>
                  <div className="w-24 flex-none">
                    <ProgressBar value={c.progress.pct} height={5} label={`${c.label} progress`} />
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-[var(--border-faint)] px-[18px] py-4">
                    {c.progress.complete && (
                      <div className="mb-3 flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3 text-[13px] font-semibold text-success">
                        <CheckCircle2 size={17} aria-hidden />
                        Settled{c.total ? ` · ${compactMoney(c.total)}` : ''} — on your record
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      {c.lines.map((l) => {
                        const done = isLpResolved(c.kind, l.status);
                        return (
                          <div
                            key={l.id}
                            className={cn(
                              'flex items-center gap-3 rounded-[11px] border px-3 py-2.5',
                              done
                                ? 'border-[var(--border-faint)] bg-surface-1'
                                : 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-6 w-6 flex-none items-center justify-center rounded-full border',
                                done
                                  ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                                  : 'border-hairline bg-surface-2 text-fg-5'
                              )}
                            >
                              {done ? (
                                <Check size={12} strokeWidth={2.4} aria-hidden />
                              ) : (
                                <Landmark size={12} aria-hidden />
                              )}
                            </span>
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate text-[12.5px]',
                                done ? 'text-fg-3' : 'font-semibold text-fg-1'
                              )}
                            >
                              {l.lpRef}
                              {c.share ? (
                                <span className="ml-1.5 font-normal text-fg-5">
                                  · {compactMoney(c.share)}
                                </span>
                              ) : null}
                            </span>
                            {done ? (
                              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-success">
                                {resolvedLabel}
                              </span>
                            ) : (
                              <Button
                                variant="gold"
                                size="sm"
                                icon={Sparkles}
                                onClick={() => setRunner({ type: 'resolve', call: c, line: l })}
                              >
                                Mark {resolvedLabel}
                              </Button>
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
          <b className="text-gold-1">Earn:</b> A call is a promise collected. I keep every LP line
          visible until the money is in — and the moment the last line resolves, the settle lands on
          your record.
        </p>
      </Card>

      {runner?.type === 'issue' && (
        <ActionRunner
          title={`Issue the ${CALL_KIND_LABEL[runner.kind].toLowerCase()} — ${runner.label}`}
          steps={[
            'Pull the committed roster',
            'Draft the notices',
            'Stage the LP lines',
            'Prepare for your approval'
          ]}
          draftTitle={`${CALL_KIND_LABEL[runner.kind]} · ${runner.label}`}
          draft={`${CALL_KIND_LABEL[runner.kind]} "${runner.label}"${
            runner.total ? ` for ${compactMoney(runner.total)}` : ''
          }${runner.pct ? ` (${runner.pct}% of commitments)` : ''}${
            runner.dueAt ? `, due ${runner.dueAt}` : ''
          } against ${committedLps.length} committed LP${committedLps.length === 1 ? '' : 's'}: ${committedLps.join(
            ', '
          )}. Approving issues it and notifies every line; each LP then resolves on your approval.`}
          approveLabel="Approve & issue"
          onApprove={async () => {
            const res = await issueCapitalCall({
              kind: runner.kind,
              label: runner.label,
              total: runner.total,
              pct: runner.pct,
              dueAt: runner.dueAt
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setLabel('');
            setTotal('');
            setPct('');
            setDueAt('');
            setToast(`${CALL_KIND_LABEL[runner.kind]} issued — ${runner.label}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'resolve' && (
        <ActionRunner
          title={`Mark ${CALL_RESOLVED_STATUS[runner.call.kind]} — ${runner.line.lpRef}`}
          steps={[
            'Pull the LP line',
            runner.call.kind === 'call' ? 'Confirm funds received' : 'Confirm payment sent',
            'Prepare for your approval'
          ]}
          draftTitle={`${runner.line.lpRef} · ${CALL_RESOLVED_STATUS[runner.call.kind]}`}
          draft={`Resolve ${runner.line.lpRef}'s line on "${runner.call.label}" as ${CALL_RESOLVED_STATUS[runner.call.kind]}${
            runner.call.share ? ` (${compactMoney(runner.call.share)})` : ''
          }. ${
            runner.call.progress.resolved + 1 === runner.call.progress.total
              ? 'This is the last open line — approving settles the whole call and logs it to your record.'
              : `${runner.call.progress.total - runner.call.progress.resolved - 1} line(s) will remain after this one.`
          }`}
          approveLabel="Approve & resolve"
          onApprove={async () => {
            const res = await resolveCallLp({ callId: runner.call.id, lineId: runner.line.id });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(
              runner.call.progress.resolved + 1 === runner.call.progress.total
                ? `${runner.call.label} — settled & recorded`
                : `${runner.line.lpRef} — ${CALL_RESOLVED_STATUS[runner.call.kind]}`
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
