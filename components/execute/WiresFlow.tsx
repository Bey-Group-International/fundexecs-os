'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Check,
  CheckCircle2,
  FileSignature,
  Landmark,
  Lock,
  PenLine,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SegTabs } from '@/components/ui/Tabs';
import { compactMoney } from '@/lib/format';
import type { ClosingRef, SignatureView, WireView } from '@/lib/queries/wires';
import {
  nextWireStatus,
  signatureSummary,
  SIGNATURE_STATUS_LABEL,
  SIGNATURE_STATUS_TONE,
  wireAction,
  wireBoard,
  WIRE_STATUS_LABEL,
  WIRE_STATUS_TONE,
  type SignatureStatus,
  type WireStatus
} from '@/lib/wires/vocabulary';
import {
  advanceWire,
  chaseSignature,
  instructWire,
  resolveSignature,
  sendSignature
} from '@/lib/wires/actions';
import { cn } from '@/lib/utils';

type View = 'signatures' | 'wires' | 'accounts';

type RunnerState =
  | { type: 'send-signature'; document: string; signer: string; closingId: string }
  | { type: 'resolve-signature'; sig: SignatureView; outcome: 'signed' | 'declined' }
  | { type: 'chase-signature'; sig: SignatureView }
  | {
      type: 'instruct-wire';
      direction: 'in' | 'out';
      amount: number;
      counterparty: string;
      reference: string;
      closingId: string;
    }
  | { type: 'advance-wire'; wire: WireView; next: WireStatus };

const TONE_BORDER: Record<string, string> = {
  gold: 'border-l-[var(--gold-1)]',
  azure: 'border-l-[var(--azure)]',
  success: 'border-l-[var(--success)]',
  warning: 'border-l-[var(--warning)]',
  danger: 'border-l-[var(--danger)]'
};

export function WiresFlow({
  signatures,
  wires,
  openClosings
}: {
  signatures: SignatureView[];
  wires: WireView[];
  openClosings: ClosingRef[];
}) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<View>('signatures');

  // Stage-a-signature form
  const [sigDoc, setSigDoc] = useState('');
  const [sigSigner, setSigSigner] = useState('');
  const [sigClosing, setSigClosing] = useState('');

  // Stage-a-wire form
  const [wDirection, setWDirection] = useState<'in' | 'out'>('in');
  const [wAmount, setWAmount] = useState('');
  const [wCounterparty, setWCounterparty] = useState('');
  const [wReference, setWReference] = useState('');
  const [wClosing, setWClosing] = useState('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const closingOptions = [
    { value: '', label: 'No closing — standalone' },
    ...openClosings.map((c) => ({ value: c.id, label: c.counterparty ?? 'Open closing' }))
  ];

  const sigSummary = signatureSummary(signatures);
  const board = wireBoard(wires);
  const wAmountNum = Number(wAmount);
  const wireFormReady =
    Number.isFinite(wAmountNum) && wAmountNum > 0 && wCounterparty.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Banknote size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Signatures &amp; wires
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              The signature room &amp; money movement — every record here is yours: signatures are
              attestations, wires are recorded instructions. Banking and e-sign rails attach later.
            </p>
          </div>
        </div>
      </Card>

      {/* summary strip — the prototype's three tiles, from real ledger rows */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Card className="px-3.5 py-3">
          <div className="text-[10.5px] text-fg-4">Signatures</div>
          <div
            className={cn(
              'mt-1 text-[19px] font-semibold tabular-nums',
              sigSummary.awaiting > 0 ? 'text-warning' : 'text-success'
            )}
          >
            {sigSummary.signed}/{sigSummary.total}
          </div>
          <div className="text-[10px] text-fg-5">{sigSummary.awaiting} awaiting</div>
        </Card>
        <Card className="px-3.5 py-3">
          <div className="text-[10.5px] text-fg-4">Outbound staged</div>
          <div className="mt-1 text-[19px] font-semibold tabular-nums text-gold-1">
            {board.outStaged}
          </div>
          <div className="text-[10px] text-fg-5">{compactMoney(board.outTotal)} total out</div>
        </Card>
        <Card className="px-3.5 py-3">
          <div className="text-[10.5px] text-fg-4">Inbound expected</div>
          <div className="mt-1 text-[19px] font-semibold tabular-nums text-azure-1">
            {compactMoney(board.inExpected)}
          </div>
          <div className="text-[10px] text-fg-5">capital incoming</div>
        </Card>
      </div>

      {/* the three inner views */}
      <SegTabs
        tabs={[
          { id: 'signatures', label: 'Signatures', icon: PenLine },
          { id: 'wires', label: 'Wire transfers', icon: Banknote },
          { id: 'accounts', label: 'Accounts', icon: Landmark }
        ]}
        active={view}
        onChange={(id) => setView(id as View)}
      />

      {view === 'signatures' && (
        <>
          {/* send a document out */}
          <Card className="p-[18px]">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                <PenLine size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  The signature room
                </div>
                <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                  Send a document out
                </div>
              </div>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
              <Input
                label="Document"
                value={sigDoc}
                onChange={(e) => setSigDoc(e.target.value)}
                placeholder="e.g. Subscription agreement"
                maxLength={200}
              />
              <Input
                label="Signer"
                value={sigSigner}
                onChange={(e) => setSigSigner(e.target.value)}
                placeholder="Who signs"
                maxLength={200}
              />
              <Select
                label="Closing"
                options={closingOptions}
                value={sigClosing}
                onChange={(e) => setSigClosing(e.target.value)}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={Sparkles}
                disabled={!sigDoc.trim() || !sigSigner.trim()}
                onClick={() =>
                  setRunner({
                    type: 'send-signature',
                    document: sigDoc.trim(),
                    signer: sigSigner.trim(),
                    closingId: sigClosing
                  })
                }
              >
                Send out
              </Button>
            </div>
          </Card>

          {/* the signature rows */}
          {signatures.length === 0 ? (
            <Card className="p-8 text-center">
              <FileSignature size={22} className="mx-auto text-fg-4" aria-hidden />
              <h2 className="mt-3 text-[15px] font-semibold text-fg-1">
                Nothing out for signature yet
              </h2>
              <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
                The closing docs you send out land here — tracked to signed or declined, each
                outcome recorded on your approval.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-1.5">
              {signatures
                .slice()
                .sort(
                  (a, b) =>
                    Number(a.status !== 'out_for_signature') -
                    Number(b.status !== 'out_for_signature')
                )
                .map((s) => {
                  const status = s.status as SignatureStatus;
                  const tone = SIGNATURE_STATUS_TONE[status] ?? 'warning';
                  const done = s.status !== 'out_for_signature';
                  const signed = s.status === 'signed';
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'flex items-center gap-3 rounded-[12px] border border-hairline border-l-2 bg-surface-1 px-3.5 py-3',
                        TONE_BORDER[tone],
                        done && 'opacity-75'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                          signed
                            ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                            : 'border-hairline bg-surface-2 text-fg-3'
                        )}
                      >
                        {signed ? (
                          <Check size={15} aria-hidden />
                        ) : (
                          <FileSignature size={15} aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-fg-1">
                          {s.document}
                        </div>
                        <div className="text-[10.5px] text-fg-5">
                          {s.signer}
                          {s.chasedAt && !done
                            ? ` · reminder recorded ${new Date(s.chasedAt).toLocaleDateString()}`
                            : ''}
                        </div>
                      </div>
                      <Badge tone={tone} className="flex-none px-2 py-0.5 text-[9px]">
                        {SIGNATURE_STATUS_LABEL[status] ?? s.status}
                      </Badge>
                      {s.status === 'out_for_signature' && (
                        <div className="flex flex-none items-center gap-1.5">
                          <Button
                            variant="gold"
                            size="sm"
                            icon={PenLine}
                            onClick={() =>
                              setRunner({ type: 'resolve-signature', sig: s, outcome: 'signed' })
                            }
                          >
                            Sign
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Send}
                            onClick={() => setRunner({ type: 'chase-signature', sig: s })}
                          >
                            Chase
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={XCircle}
                            onClick={() =>
                              setRunner({ type: 'resolve-signature', sig: s, outcome: 'declined' })
                            }
                          >
                            Declined
                          </Button>
                        </div>
                      )}
                      {signed && <Lock size={14} className="flex-none text-success" aria-hidden />}
                    </div>
                  );
                })}
            </div>
          )}
        </>
      )}

      {view === 'wires' && (
        <>
          {/* stage a wire */}
          <Card className="p-[18px]">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                <Banknote size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  Money movement
                </div>
                <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                  Stage a wire instruction
                </div>
              </div>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-[130px_1fr_1fr_auto] sm:items-end">
              <Select
                label="Direction"
                options={[
                  { value: 'in', label: 'Incoming' },
                  { value: 'out', label: 'Outgoing' }
                ]}
                value={wDirection}
                onChange={(e) => setWDirection(e.target.value as 'in' | 'out')}
              />
              <Input
                label="Amount (USD)"
                type="number"
                min={1}
                value={wAmount}
                onChange={(e) => setWAmount(e.target.value)}
                placeholder="250000"
              />
              <Input
                label="Counterparty"
                value={wCounterparty}
                onChange={(e) => setWCounterparty(e.target.value)}
                placeholder="Who's on the other side"
                maxLength={200}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={Sparkles}
                disabled={!wireFormReady}
                onClick={() =>
                  setRunner({
                    type: 'instruct-wire',
                    direction: wDirection,
                    amount: wAmountNum,
                    counterparty: wCounterparty.trim(),
                    reference: wReference.trim(),
                    closingId: wClosing
                  })
                }
              >
                Stage wire
              </Button>
            </div>
            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
              <Input
                label="Reference (optional)"
                value={wReference}
                onChange={(e) => setWReference(e.target.value)}
                placeholder="Memo / reference line"
                maxLength={200}
              />
              <Select
                label="Closing"
                options={closingOptions}
                value={wClosing}
                onChange={(e) => setWClosing(e.target.value)}
              />
            </div>
          </Card>

          {/* the wire board */}
          {wires.length === 0 ? (
            <Card className="p-8 text-center">
              <Banknote size={22} className="mx-auto text-fg-4" aria-hidden />
              <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No wires on the ledger</h2>
              <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
                Instructions you stage track here — staged, sent, settled — each stage advanced on
                your approval under dual control.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-1.5">
              {wires
                .slice()
                .sort((a, b) => Number(a.status === 'settled') - Number(b.status === 'settled'))
                .map((w) => {
                  const status = w.status as WireStatus;
                  const tone = WIRE_STATUS_TONE[status] ?? 'gold';
                  const done = w.status === 'settled';
                  const out = w.direction === 'out';
                  const action = wireAction(w.direction, w.status);
                  const next = nextWireStatus(w.status);
                  return (
                    <div
                      key={w.id}
                      className={cn(
                        'flex items-center gap-3 rounded-[12px] border border-hairline border-l-2 bg-surface-1 px-3.5 py-3',
                        TONE_BORDER[tone],
                        done && 'opacity-75'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                          out
                            ? 'border-[var(--warning-line)] bg-[var(--warning-soft)] text-warning'
                            : 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1'
                        )}
                      >
                        {out ? (
                          <ArrowUpRight size={15} aria-hidden />
                        ) : (
                          <ArrowDownLeft size={15} aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-fg-1">
                            {w.counterparty}
                          </span>
                          <span
                            className={cn(
                              'flex-none text-[12.5px] font-semibold tabular-nums',
                              out ? 'text-fg-1' : 'text-success'
                            )}
                          >
                            {out ? '−' : '+'}
                            {compactMoney(w.amount)}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-fg-5">
                          {out ? 'Outgoing' : 'Incoming'}
                          {w.reference ? ` · ${w.reference}` : ''}
                        </div>
                      </div>
                      <Badge tone={tone} className="flex-none px-2 py-0.5 text-[9px]">
                        {WIRE_STATUS_LABEL[status] ?? w.status}
                      </Badge>
                      {action && next && (
                        <Button
                          variant={action.gold ? 'gold' : 'secondary'}
                          size="sm"
                          icon={action.gold ? Send : Check}
                          className="flex-none"
                          onClick={() => setRunner({ type: 'advance-wire', wire: w, next })}
                        >
                          {action.label}
                        </Button>
                      )}
                      {done && <Lock size={14} className="flex-none text-success" aria-hidden />}
                    </div>
                  );
                })}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-5">
                <ShieldCheck size={13} className="text-success" aria-hidden />
                Every wire is recorded under dual-control approval and logs to your Chain of Trust —
                no money moves through FundExecs OS.
              </div>
            </div>
          )}
        </>
      )}

      {view === 'accounts' && (
        <>
          {/* Honest accounts strip: balances render only from real connected
              data — there is none yet, so this is the empty state. Never
              EX_ACCOUNTS seeds. */}
          <Card className="flex items-baseline justify-between px-4 py-3.5">
            <div>
              <div className="text-[11px] text-fg-4">Total fund cash</div>
              <div className="mt-1 text-[24px] font-semibold tabular-nums text-fg-5">—</div>
            </div>
            <span className="text-[11px] text-fg-5">no accounts connected</span>
          </Card>
          <Card className="p-8 text-center">
            <Landmark size={22} className="mx-auto text-fg-4" aria-hidden />
            <h2 className="mt-3 text-[15px] font-semibold text-fg-1">
              Balances sync once banking is connected
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              Your capital-call, operating and escrow accounts will appear here with live balances
              when a banking connection lands. Until then, nothing is shown — no balance on this
              screen is ever illustrative or presumed.
            </p>
          </Card>
          <div className="flex items-center gap-2 text-[11px] text-fg-5">
            <RefreshCw size={13} className="text-fg-4" aria-hidden />
            Balances sync from your banks. Earn flags when a call or wire is needed.
          </div>
        </>
      )}

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Money moves on instructions, and instructions get
          lost in inboxes. Everything here is on the ledger — staged, advanced one stage at a time
          on your approval, and settled only when you confirm it settled.
        </p>
      </Card>

      {runner?.type === 'send-signature' && (
        <ActionRunner
          title={`Send for signature — ${runner.document}`}
          steps={[
            'Stage the document',
            'Verify the signer',
            'Queue the signature request',
            'Prepare for your approval'
          ]}
          draftTitle={`Signature request · ${runner.document}`}
          draft={`"${runner.document}" goes out to ${runner.signer}${
            runner.closingId ? ' under its closing' : ''
          }. Approving puts it on the ledger as awaiting; you record the outcome when it comes back. Execution itself happens outside FundExecs OS until the e-sign rail lands.`}
          approveLabel="Approve & send"
          onApprove={async () => {
            const res = await sendSignature({
              document: runner.document,
              signer: runner.signer,
              closingId: runner.closingId || null
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setSigDoc('');
            setSigSigner('');
            setSigClosing('');
            setToast(`Out for signature — ${runner.document}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'resolve-signature' && (
        <ActionRunner
          title={`${runner.outcome === 'signed' ? 'Sign' : 'Mark declined'} — ${runner.sig.document}`}
          steps={
            runner.outcome === 'signed'
              ? [
                  'Open the execution copy',
                  'Record your attestation',
                  'Notify the ledger',
                  'Log to Chain of Trust'
                ]
              : ['Pull the signature request', 'Verify the outcome', 'Prepare for your approval']
          }
          draftTitle={`${runner.sig.document} · ${runner.outcome}`}
          draft={
            runner.outcome === 'signed'
              ? `Record "${runner.sig.document}" (${runner.sig.signer}) as signed. This is your attestation — the document was executed outside FundExecs OS — timestamped, final on the ledger, and logged to your Chain of Trust.`
              : `Record ${runner.sig.signer}'s outcome on "${runner.sig.document}" as declined. A signature resolves exactly once — this is final on the ledger.`
          }
          approveLabel={runner.outcome === 'signed' ? 'Approve & sign' : 'Approve & record'}
          onApprove={async () => {
            const res = await resolveSignature({
              signatureId: runner.sig.id,
              outcome: runner.outcome
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.sig.document} — ${runner.outcome}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'chase-signature' && (
        <ActionRunner
          title={`Chase — ${runner.sig.document}`}
          steps={['Pull the outstanding request', 'Draft the reminder', 'Record the chase']}
          draftTitle={`Reminder · ${runner.sig.signer}`}
          draft={`"${runner.sig.document}" is still out with ${runner.sig.signer} — Earn drafted the reminder. Approving records the chase on the ledger; send it from your own channel. The request stays open until the outcome comes back.`}
          approveLabel="Approve & record"
          onApprove={async () => {
            const res = await chaseSignature({ signatureId: runner.sig.id });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.sig.signer} — chase recorded`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'instruct-wire' && (
        <ActionRunner
          title={`Stage the wire — ${compactMoney(runner.amount)} ${runner.direction === 'in' ? 'in' : 'out'}`}
          steps={[
            'Draft the instruction',
            'Verify amount and counterparty',
            'Stage on the ledger',
            'Prepare for your approval'
          ]}
          draftTitle={`Wire instruction · ${runner.counterparty}`}
          draft={`${runner.direction === 'in' ? 'Inbound' : 'Outbound'} wire of ${compactMoney(runner.amount)} — ${
            runner.counterparty
          }${runner.reference ? ` (ref: ${runner.reference})` : ''}. Approving RECORDS the instruction — no money moves through FundExecs OS. It advances to sent and settled only on your further approvals.`}
          approveLabel="Approve & stage"
          onApprove={async () => {
            const res = await instructWire({
              direction: runner.direction,
              amount: runner.amount,
              counterparty: runner.counterparty,
              reference: runner.reference || null,
              closingId: runner.closingId || null
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setWAmount('');
            setWCounterparty('');
            setWReference('');
            setWClosing('');
            setToast(`Wire staged — ${compactMoney(runner.amount)} ${runner.counterparty}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'advance-wire' && (
        <ActionRunner
          title={`${runner.wire.direction === 'out' && runner.wire.status === 'instructed' ? 'Release' : 'Confirm'} — ${compactMoney(runner.wire.amount)} ${runner.wire.counterparty}`}
          steps={[
            'Verify account & amount',
            'Dual-control approval',
            runner.wire.direction === 'out' ? 'Release the wire' : 'Match the inbound funds',
            runner.next === 'settled' ? 'Log to Chain of Trust' : 'Record the stage'
          ]}
          draftTitle={`${compactMoney(runner.wire.amount)} · ${runner.wire.counterparty}`}
          draft={`${runner.wire.direction === 'out' ? 'Outbound' : 'Inbound'} wire of ${compactMoney(runner.wire.amount)} — ${
            runner.wire.counterparty
          }. Approve to ${
            runner.wire.direction === 'out' && runner.wire.status === 'instructed'
              ? 'release'
              : 'confirm'
          } under dual control. This RECORDS the wire against your bank — no money moves through FundExecs OS${
            runner.next === 'settled' ? '; settling logs it to your Chain of Trust' : ''
          }.`}
          approveLabel="Approve & advance"
          onApprove={async () => {
            const res = await advanceWire({ wireId: runner.wire.id });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(
              `${compactMoney(runner.wire.amount)} ${runner.wire.counterparty} — ${WIRE_STATUS_LABEL[runner.next].toLowerCase()}`
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
