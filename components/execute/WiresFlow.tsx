'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  FileSignature,
  PenTool,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { compactMoney } from '@/lib/format';
import type { ClosingRef, SignatureView, WireView } from '@/lib/queries/wires';
import type { WireTotals } from '@/lib/wires/vocabulary';
import {
  nextWireStatus,
  SIGNATURE_STATUS_LABEL,
  WIRE_SEQUENCE,
  WIRE_STATUS_LABEL,
  type SignatureStatus,
  type WireStatus
} from '@/lib/wires/vocabulary';
import { advanceWire, instructWire, resolveSignature, sendSignature } from '@/lib/wires/actions';
import { cn } from '@/lib/utils';

const SIG_TONE: Record<SignatureStatus, BadgeTone> = {
  out_for_signature: 'warning',
  signed: 'success',
  declined: 'danger'
};

const WIRE_TONE: Record<WireStatus, BadgeTone> = {
  instructed: 'warning',
  sent: 'azure',
  settled: 'success'
};

type RunnerState =
  | { type: 'send-signature'; document: string; signer: string; closingId: string }
  | { type: 'resolve-signature'; sig: SignatureView; outcome: 'signed' | 'declined' }
  | {
      type: 'instruct-wire';
      direction: 'in' | 'out';
      amount: number;
      counterparty: string;
      reference: string;
      closingId: string;
    }
  | { type: 'advance-wire'; wire: WireView; next: WireStatus };

export function WiresFlow({
  signatures,
  wires,
  totals,
  openClosings
}: {
  signatures: SignatureView[];
  wires: WireView[];
  totals: WireTotals;
  openClosings: ClosingRef[];
}) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const outForSignature = signatures.filter((s) => s.status === 'out_for_signature').length;
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
              Signatures & wires
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              The instruction ledger behind every close — what went out for signature, what’s
              moving, what’s settled. Banking and e-sign rails attach later; the record starts now.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {totals.accounted !== 0 ? compactMoney(totals.accounted) : outForSignature}
            </div>
            <div className="text-[10.5px] text-fg-5">
              {totals.accounted !== 0 ? 'net settled' : 'out for signature'}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(
            [
              ['Settled in', totals.settledIn],
              ['Settled out', totals.settledOut],
              ['In flight', totals.inFlight]
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3 py-2.5"
            >
              <div className="text-[15px] font-semibold tabular-nums text-fg-1">
                {compactMoney(value)}
              </div>
              <div className="text-[10px] uppercase tracking-[0.08em] text-fg-5">{label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* signatures lane */}
      <Card className="p-[18px]">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
            <PenTool size={16} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Signatures
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

        {signatures.length === 0 ? (
          <p className="mt-4 text-center text-[12.5px] text-fg-4">
            Nothing out for signature yet — the closing docs you send land here.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-1.5">
            {signatures.map((s) => {
              const tone = SIG_TONE[s.status as SignatureStatus] ?? 'neutral';
              const label = SIGNATURE_STATUS_LABEL[s.status as SignatureStatus] ?? s.status;
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                    <FileSignature size={15} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{s.document}</div>
                    <div className="text-[10.5px] text-fg-5">{s.signer}</div>
                  </div>
                  <Badge tone={tone} className="px-2 py-0.5 text-[9.5px]">
                    {label}
                  </Badge>
                  {s.status === 'out_for_signature' && (
                    <div className="flex flex-none items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={CheckCircle2}
                        onClick={() =>
                          setRunner({ type: 'resolve-signature', sig: s, outcome: 'signed' })
                        }
                      >
                        Signed
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
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* wires lane */}
      <Card className="p-[18px]">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
            <Banknote size={16} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Wires
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

        {wires.length === 0 ? (
          <p className="mt-4 text-center text-[12.5px] text-fg-4">
            No wires on the ledger yet — instructions you stage track here, instructed → sent →
            settled.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-1.5">
            {wires.map((w) => {
              const next = nextWireStatus(w.status);
              const tone = WIRE_TONE[w.status as WireStatus] ?? 'neutral';
              const stageIdx = (WIRE_SEQUENCE as readonly string[]).indexOf(w.status);
              return (
                <div
                  key={w.id}
                  className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                      w.direction === 'in'
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1'
                    )}
                  >
                    {w.direction === 'in' ? (
                      <ArrowDownLeft size={15} aria-hidden />
                    ) : (
                      <ArrowUpRight size={15} aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-fg-1">
                      {compactMoney(w.amount)} · {w.counterparty}
                    </div>
                    <div className="text-[10.5px] text-fg-5">
                      {w.direction === 'in' ? 'Incoming' : 'Outgoing'}
                      {w.reference ? ` · ${w.reference}` : ''} · stage {stageIdx + 1}/
                      {WIRE_SEQUENCE.length}
                    </div>
                  </div>
                  <Badge tone={tone} className="px-2 py-0.5 text-[9.5px]">
                    {WIRE_STATUS_LABEL[w.status as WireStatus] ?? w.status}
                  </Badge>
                  {next && (
                    <Button
                      variant="gold"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => setRunner({ type: 'advance-wire', wire: w, next })}
                    >
                      Mark {WIRE_STATUS_LABEL[next].toLowerCase()}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

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
          }. Approving puts it on the ledger as out-for-signature; you record the outcome when it comes back.`}
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
          title={`${runner.outcome === 'signed' ? 'Mark signed' : 'Mark declined'} — ${runner.sig.document}`}
          steps={['Pull the signature request', 'Verify the outcome', 'Prepare for your approval']}
          draftTitle={`${runner.sig.document} · ${runner.outcome}`}
          draft={`Record ${runner.sig.signer}'s outcome on "${runner.sig.document}" as ${runner.outcome}. A signature resolves exactly once — this is final on the ledger.`}
          approveLabel="Approve & record"
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
          draft={`${runner.direction === 'in' ? 'Incoming' : 'Outgoing'} wire of ${compactMoney(runner.amount)} ${
            runner.direction === 'in' ? 'from' : 'to'
          } ${runner.counterparty}${runner.reference ? ` (ref: ${runner.reference})` : ''}. Approving stages it as instructed; it advances to sent and settled only on your further approvals.`}
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
          title={`Mark ${WIRE_STATUS_LABEL[runner.next].toLowerCase()} — ${compactMoney(runner.wire.amount)} ${runner.wire.counterparty}`}
          steps={[
            'Pull the instruction',
            runner.next === 'settled' ? 'Confirm funds landed' : 'Confirm release',
            'Prepare for your approval'
          ]}
          draftTitle={`${runner.wire.counterparty} · ${WIRE_STATUS_LABEL[runner.next]}`}
          draft={`Advance the ${compactMoney(runner.wire.amount)} ${
            runner.wire.direction === 'in' ? 'incoming' : 'outgoing'
          } wire one stage to ${WIRE_STATUS_LABEL[runner.next].toLowerCase()}. Stages move strictly in order — nothing skips ahead of the money.`}
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
