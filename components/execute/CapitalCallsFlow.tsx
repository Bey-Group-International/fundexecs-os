'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Landmark,
  Receipt,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Input } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SegTabs } from '@/components/ui/Tabs';
import { chaseCallLp, issueCapitalCall, resolveCallLp } from '@/lib/capital-calls/actions';
import {
  CALL_KIND_LABEL,
  CALL_RESOLVED_STATUS,
  DIST_STATUS,
  LP_STATE_LABEL,
  type CallKind
} from '@/lib/capital-calls/vocabulary';
import { compactMoney } from '@/lib/format';
import type { CallLpView, CapitalCallView, DistributionView } from '@/lib/queries/capital-calls';
import type { CapitalSummary } from '@/lib/capital-calls/vocabulary';
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
  | { type: 'resolve'; call: CapitalCallView; line: CallLpView }
  | { type: 'chase'; call: CapitalCallView; line: CallLpView };

const POSTURE_BORDER: Record<CapitalCallView['posture'], string> = {
  settled: 'border-l-[var(--success)]',
  overdue: 'border-l-[var(--danger)]',
  open: 'border-l-[var(--gold-1)]'
};

const LINE_BORDER: Record<CallLpView['state'], string> = {
  resolved: 'border-l-[var(--success)]',
  pending: 'border-l-[var(--gold-1)]',
  overdue: 'border-l-[var(--danger)]'
};

/**
 * Render a date-only "YYYY-MM-DD" as the local calendar day. Parsing it
 * through `new Date(string)` would read it as UTC midnight and shift the
 * displayed day back in western timezones.
 */
function localDate(dateOnly: string): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  if (!y || !m || !d) return dateOnly;
  return new Date(y, m - 1, d).toLocaleDateString();
}

/** Date-only strings render as local calendar days; timestamps parse normally. */
function displayDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? localDate(value)
    : new Date(value).toLocaleDateString();
}

function dueLabel(c: CapitalCallView): string {
  if (c.status === 'settled') return 'Complete';
  if (!c.dueAt) return 'No due date';
  const date = localDate(c.dueAt);
  return c.overdueCount > 0 ? `Was due ${date}` : `Due ${date}`;
}

export function CapitalCallsFlow({
  calls,
  committedLps,
  summary,
  distributions,
  distributedTotal
}: {
  calls: CapitalCallView[];
  committedLps: string[];
  summary: CapitalSummary;
  distributions: DistributionView[];
  distributedTotal: number;
}) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<'calls' | 'dist'>('calls');

  const drawdowns = calls.filter((c) => c.kind === 'call');
  const [openId, setOpenId] = useState<string | null>(
    drawdowns.find((c) => c.status !== 'settled')?.id ?? drawdowns[0]?.id ?? null
  );
  const [openDistId, setOpenDistId] = useState<string | null>(null);
  const call = drawdowns.find((c) => c.id === openId) ?? drawdowns[0] ?? null;

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

  const tiles =
    summary.committed > 0
      ? [
          {
            label: 'Committed',
            value: compactMoney(summary.committed),
            sub: 'total LP commitments',
            cls: 'text-gold-1'
          },
          {
            label: 'Called',
            value: compactMoney(summary.called),
            sub: `${Math.round((summary.called / summary.committed) * 100)}% of commitments`,
            cls: 'text-azure-1'
          },
          {
            label: 'Dry powder',
            value: compactMoney(summary.dryPowder),
            sub: 'uncalled',
            cls: 'text-success'
          }
        ]
      : [];

  function lineRow(c: CapitalCallView, l: CallLpView) {
    const done = l.state === 'resolved';
    const stateLabel = LP_STATE_LABEL[c.kind][l.state];
    return (
      <div
        key={l.id}
        className={cn(
          'flex items-center gap-3 rounded-[11px] border border-hairline border-l-2 bg-surface-1 px-3 py-2.5',
          LINE_BORDER[l.state],
          done && 'opacity-75'
        )}
      >
        <Avatar name={l.lpRef} size={30} tone={done ? 'gold' : 'azure'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-fg-1">{l.lpRef}</div>
          <div className={cn('text-[10.5px]', l.state === 'overdue' ? 'text-danger' : 'text-fg-5')}>
            {stateLabel}
            {l.chasedAt && !done
              ? ` · reminder recorded ${new Date(l.chasedAt).toLocaleDateString()}`
              : ''}
          </div>
        </div>
        {l.amount != null && (
          <span
            className={cn(
              'flex-none text-[13px] font-semibold tabular-nums',
              done ? 'text-success' : 'text-fg-2'
            )}
          >
            {compactMoney(l.amount)}
          </span>
        )}
        {done ? (
          <CheckCircle2 size={16} className="flex-none text-success" aria-hidden />
        ) : l.state === 'overdue' ? (
          <Button
            variant="gold"
            size="sm"
            icon={Send}
            className="flex-none"
            onClick={() => setRunner({ type: 'chase', call: c, line: l })}
          >
            Chase
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={Check}
            className="flex-none"
            onClick={() => setRunner({ type: 'resolve', call: c, line: l })}
          >
            Confirm
          </Button>
        )}
      </div>
    );
  }

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
        </div>
      </Card>

      {/* fund capital overview — real commitments and issued calls only */}
      {tiles.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {tiles.map((t) => (
            <Card key={t.label} className="px-3.5 py-3">
              <div className="text-[10.5px] text-fg-4">{t.label}</div>
              <div className={cn('mt-1 text-[18px] font-semibold tabular-nums', t.cls)}>
                {t.value}
              </div>
              <div className="mt-0.5 text-[9.5px] text-fg-5">{t.sub}</div>
            </Card>
          ))}
        </div>
      )}

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

      {/* drawdowns vs distributions */}
      <SegTabs
        tabs={[
          { id: 'calls', label: 'Drawdowns', icon: ArrowDownLeft, count: drawdowns.length },
          { id: 'dist', label: 'Distributions', icon: ArrowUpRight, count: distributions.length }
        ]}
        active={view}
        onChange={(id) => setView(id as 'calls' | 'dist')}
      />

      {view === 'dist' ? (
        distributions.length === 0 ? (
          <Card className="p-8 text-center">
            <ArrowUpRight size={22} className="mx-auto text-fg-4" aria-hidden />
            <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No distributions yet</h2>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              Distributions you issue here and paid events from your LP Room ledger both land in
              this list — returning capital to LPs builds your track record for the next fund.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {distributions.map((d) => {
              const st = DIST_STATUS[d.status];
              const srcCall = d.callId != null ? calls.find((c) => c.id === d.callId) : undefined;
              const expandable = srcCall != null && d.status === 'staged';
              const expanded = expandable && openDistId === d.id;
              return (
                <Card
                  key={d.id}
                  className={cn(
                    'border-l-2 p-0',
                    st.tone === 'success'
                      ? 'border-l-[var(--success)]'
                      : st.tone === 'gold'
                        ? 'border-l-[var(--gold-1)]'
                        : 'border-l-[var(--border)]'
                  )}
                >
                  <button
                    type="button"
                    disabled={!expandable}
                    aria-expanded={expandable ? expanded : undefined}
                    onClick={() => setOpenDistId(expanded ? null : d.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-[18px] py-3.5 text-left',
                      !expandable && 'cursor-default'
                    )}
                  >
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
                      <ArrowUpRight size={15} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-fg-1">{d.name}</div>
                      <div className="mt-0.5 text-[10.5px] text-fg-5">
                        {d.detail}
                        {d.date ? ` · ${displayDate(d.date)}` : ''}
                      </div>
                    </div>
                    {d.amount != null && (
                      <span className="flex-none text-[13px] font-semibold tabular-nums text-success">
                        +{compactMoney(d.amount)}
                      </span>
                    )}
                    <Badge tone={st.tone} className="flex-none px-2 py-0.5 text-[9px]">
                      {st.label}
                    </Badge>
                  </button>
                  {expanded && srcCall && (
                    <div className="flex flex-col gap-1.5 border-t border-[var(--border-faint)] px-[18px] py-3.5">
                      {srcCall.lines.map((l) => lineRow(srcCall, l))}
                    </div>
                  )}
                </Card>
              );
            })}
            <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-5">
              <TrendingUp size={13} className="text-gold-1" aria-hidden />
              {distributedTotal > 0 ? (
                <>
                  {compactMoney(distributedTotal)} returned to LPs
                  {summary.called > 0
                    ? ` · DPI ${(distributedTotal / summary.called).toFixed(2)}x`
                    : ''}{' '}
                  — distributions build your track record for the next fund.
                </>
              ) : (
                <>Distributions returned to LPs build your track record for the next fund.</>
              )}
            </div>
          </div>
        )
      ) : drawdowns.length === 0 ? (
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
        <>
          {/* call selector */}
          <div className="flex flex-wrap gap-2">
            {drawdowns.map((c) => {
              const on = c.id === call?.id;
              const settled = c.status === 'settled';
              const fp =
                c.total && c.total > 0
                  ? Math.round((c.fundedAmount / c.total) * 100)
                  : c.progress.pct;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-[11px] border px-3 py-2 text-left transition',
                    on
                      ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]'
                      : 'border-hairline bg-surface-1 hover:bg-surface-2'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 flex-none items-center justify-center rounded-[8px]',
                      settled
                        ? 'bg-success text-white'
                        : on
                          ? 'bg-accent text-white'
                          : 'border border-hairline bg-surface-2 text-fg-3'
                    )}
                  >
                    {settled ? <Check size={14} aria-hidden /> : <Receipt size={14} aria-hidden />}
                  </span>
                  <span>
                    <span
                      className={cn(
                        'block text-[12.5px] font-semibold',
                        on ? 'text-fg-1' : 'text-fg-2'
                      )}
                    >
                      {c.label}
                    </span>
                    <span className="block text-[10px] text-fg-5">
                      {c.total != null ? compactMoney(c.total) : `${c.progress.total} LPs`} · {fp}%
                      in
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {call && (
            <>
              {/* call posture */}
              <Card className={cn('border-l-[3px] px-4 py-3.5', POSTURE_BORDER[call.posture])}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-fg-1">{call.label}</span>
                  {call.pct != null && (
                    <Badge
                      tone={call.posture === 'settled' ? 'success' : 'gold'}
                      className="px-2 py-0.5 text-[9.5px]"
                    >
                      {call.pct}% draw
                    </Badge>
                  )}
                  <span className="flex-1" />
                  <span
                    className={cn(
                      'text-[11.5px] font-semibold',
                      call.posture === 'overdue' ? 'text-danger' : 'text-fg-3'
                    )}
                  >
                    {dueLabel(call)}
                  </span>
                </div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[11.5px] text-fg-3">
                    {call.total != null ? (
                      <>
                        <b className="text-fg-1">{compactMoney(call.fundedAmount)}</b> of{' '}
                        {compactMoney(call.total)} funded
                      </>
                    ) : (
                      <>
                        <b className="text-fg-1">{call.progress.resolved}</b> of{' '}
                        {call.progress.total} funded
                      </>
                    )}
                  </span>
                  {call.overdueCount > 0 && (
                    <span className="text-[11px] text-danger">{call.overdueCount} overdue</span>
                  )}
                </div>
                <ProgressBar
                  value={
                    call.total && call.total > 0
                      ? Math.round((call.fundedAmount / call.total) * 100)
                      : call.progress.pct
                  }
                  height={7}
                  label={`${call.label} funded`}
                />
              </Card>

              {/* per-LP funding */}
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                LP funding · {call.lines.length}
              </div>
              <div className="flex flex-col gap-1.5">
                {call.lines
                  .slice()
                  .sort((a, b) => Number(a.state === 'resolved') - Number(b.state === 'resolved'))
                  .map((l) => lineRow(call, l))}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-fg-5">
                <ShieldCheck size={13} className="text-success" aria-hidden />
                Every line resolves on your approval — notices, receipts and chases are all recorded
                here, and a settled call lands on your record.
              </div>
            </>
          )}
        </>
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
            'Set each LP line pro-rata to their commitment',
            'Draft the notices',
            'Prepare for your approval'
          ]}
          draftTitle={`${CALL_KIND_LABEL[runner.kind]} · ${runner.label}`}
          draft={`${CALL_KIND_LABEL[runner.kind]} "${runner.label}"${
            runner.total ? ` for ${compactMoney(runner.total)}` : ''
          }${runner.pct ? ` (${runner.pct}% of commitments)` : ''}${
            runner.dueAt ? `, due ${runner.dueAt}` : ''
          } against ${committedLps.length} committed LP${committedLps.length === 1 ? '' : 's'}: ${committedLps.join(
            ', '
          )}. Each LP's share is fixed pro-rata to their real commitment at issue. Approving issues it; each line then resolves on your approval.`}
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
          title={`Confirm — ${runner.line.lpRef}`}
          steps={[
            runner.call.kind === 'call'
              ? 'Verify the wire against your bank'
              : 'Verify the payment went out',
            'Match it to the call',
            runner.call.progress.resolved + 1 === runner.call.progress.total
              ? 'Log to Chain of Trust'
              : 'Record the receipt'
          ]}
          draftTitle={`${runner.line.lpRef}${
            runner.line.amount != null ? ` · ${compactMoney(runner.line.amount)}` : ''
          }`}
          draft={`${runner.line.lpRef} ${runner.call.kind === 'call' ? 'owes' : 'is due'}${
            runner.line.amount != null ? ` ${compactMoney(runner.line.amount)}` : ' their share'
          } on "${runner.call.label}". Confirming RECORDS the ${
            runner.call.kind === 'call' ? 'funding' : 'payment'
          } — no money moves through FundExecs OS; you attest against your bank. ${
            runner.call.progress.resolved + 1 === runner.call.progress.total
              ? 'This is the last open line — approving settles the whole call and logs it to your record.'
              : `${runner.call.progress.total - runner.call.progress.resolved - 1} line(s) will remain after this one.`
          }`}
          approveLabel="Approve & confirm"
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

      {runner?.type === 'chase' && (
        <ActionRunner
          title={`Chase — ${runner.line.lpRef}`}
          steps={['Pull the overdue line', 'Draft the reminder', 'Record the chase']}
          draftTitle={`Reminder · ${runner.line.lpRef}`}
          draft={`${runner.line.lpRef} is past due on "${runner.call.label}"${
            runner.line.amount != null ? ` (${compactMoney(runner.line.amount)})` : ''
          } — Earn drafted the reminder below. Approving records the chase on the line; send the reminder from your own channel. The line stays open until you confirm receipt against your bank.`}
          approveLabel="Approve & record"
          onApprove={async () => {
            const res = await chaseCallLp({ callId: runner.call.id, lineId: runner.line.id });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.line.lpRef} — chase recorded`);
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
