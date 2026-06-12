'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Check,
  CircleDashed,
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
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SegTabs } from '@/components/ui/Tabs';
import { compactMoney } from '@/lib/format';
import type { ClosingRef, SignatureView, WireView } from '@/lib/queries/wires';
import type { WireTotals } from '@/lib/wires/vocabulary';
import {
  clearWireVerb,
  SIGNATURE_STATUS_LABEL,
  WIRE_STATUS_LABEL,
  type SignatureStatus,
  type WireStatus
} from '@/lib/wires/vocabulary';
import {
  chaseSignature,
  clearWire,
  markSignaturePartial,
  resolveSignature,
  sendSignature,
  stageWire
} from '@/lib/wires/actions';
import { cn } from '@/lib/utils';

/*
 * Signatures & wires — prototype parity (SignaturesWires, execute.jsx.txt)
 * under the Execute honesty contracts: signatures are attestations (the
 * document executes outside FundExecs OS; the DocuSign hook point is
 * documented in lib/wires/actions.ts), wires are record-keeping +
 * attestation (no money moves through FundExecs OS), and account balances
 * render only from real connected data — none exists yet, so the Accounts
 * view is the honest empty state.
 */

const SIG_TONE: Record<SignatureStatus, BadgeTone> = {
  out_for_signature: 'warning',
  partial: 'gold',
  signed: 'success',
  declined: 'danger'
};

const WIRE_TONE: Record<WireStatus, BadgeTone> = {
  staged: 'gold',
  expected: 'azure',
  cleared: 'success'
};

/** The prototype's left accent bar, by badge tone. */
const TONE_BAR: Record<BadgeTone, string> = {
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--azure-1)',
  neutral: 'var(--fg-5)'
};

type InnerView = 'signatures' | 'wires' | 'accounts';

type RunnerState =
  | { type: 'send-signature'; document: string; signer: string; closingId: string }
  | { type: 'resolve-signature'; sig: SignatureView; outcome: 'signed' | 'declined' }
  | { type: 'mark-partial'; sig: SignatureView }
  | { type: 'chase'; sig: SignatureView }
  | {
      type: 'stage-wire';
      direction: 'in' | 'out';
      amount: number;
      counterparty: string;
      reference: string;
      closingId: string;
    }
  | { type: 'clear-wire'; wire: WireView };

const resolvedSig = (s: SignatureView) => s.status === 'signed' || s.status === 'declined';

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
  const [view, setView] = useState<InnerView>('signatures');
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

  const sigDone = signatures.filter((s) => s.status === 'signed').length;
  const sigPending = signatures.filter((s) => !resolvedSig(s)).length;
  const wAmountNum = Number(wAmount);
  const wireFormReady =
    Number.isFinite(wAmountNum) && wAmountNum > 0 && wCounterparty.trim().length > 0;

  const sortedSigs = signatures
    .slice()
    .sort((a, b) => Number(resolvedSig(a)) - Number(resolvedSig(b)));
  const sortedWires = wires
    .slice()
    .sort((a, b) => Number(a.status === 'cleared') - Number(b.status === 'cleared'));

  return (
    <div className="flex flex-col gap-4">
      {/* hero + the prototype's summary strip */}
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
              The signature room & money movement — every attestation and wire on the ledger. This
              records what happened at your bank and your desk; no money moves through FundExecs OS.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <div className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-3">
            <div className="text-[10.5px] text-fg-4">Signatures</div>
            <div
              className={cn(
                'mt-1 text-[19px] font-semibold tabular-nums',
                sigPending ? 'text-warning' : 'text-success'
              )}
            >
              {sigDone}/{signatures.length}
            </div>
            <div className="text-[10px] text-fg-5">{sigPending} awaiting</div>
          </div>
          <div className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-3">
            <div className="text-[10.5px] text-fg-4">Outbound staged</div>
            <div className="mt-1 text-[19px] font-semibold tabular-nums text-gold-1">
              {totals.outboundStaged}
            </div>
            <div className="text-[10px] text-fg-5">
              {compactMoney(totals.outboundTotal)} total out
            </div>
          </div>
          <div className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-3">
            <div className="text-[10.5px] text-fg-4">Inbound expected</div>
            <div className="mt-1 text-[19px] font-semibold tabular-nums text-azure-1">
              {compactMoney(totals.inboundExpected)}
            </div>
            <div className="text-[10px] text-fg-5">capital incoming</div>
          </div>
        </div>
      </Card>

      {/* the prototype's nested view tabs */}
      <SegTabs
        active={view}
        onChange={(id) => setView(id as InnerView)}
        tabs={[
          { id: 'signatures', label: 'Signatures', icon: PenLine },
          { id: 'wires', label: 'Wire transfers', icon: Banknote },
          { id: 'accounts', label: 'Accounts', icon: Landmark }
        ]}
      />

      {view === 'signatures' && (
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

          {signatures.length === 0 ? (
            <p className="mt-4 text-center text-[12.5px] text-fg-4">
              Nothing out for signature yet — the closing docs you send land here.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-[7px]">
              {sortedSigs.map((s) => {
                const tone = SIG_TONE[s.status as SignatureStatus] ?? 'neutral';
                const label = SIGNATURE_STATUS_LABEL[s.status as SignatureStatus] ?? s.status;
                const done = s.status === 'signed';
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3',
                      done && 'opacity-[0.74]'
                    )}
                    style={{ borderLeftWidth: 2, borderLeftColor: TONE_BAR[tone] }}
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                        done
                          ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                          : 'border-hairline bg-surface-2 text-fg-3'
                      )}
                    >
                      {done ? (
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
                        {s.chasedAt ? ' · chased' : ''}
                      </div>
                    </div>
                    <Badge tone={tone} className="px-2 py-0.5 text-[9.5px]">
                      {label}
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
                          variant="ghost"
                          size="sm"
                          icon={CircleDashed}
                          onClick={() => setRunner({ type: 'mark-partial', sig: s })}
                        >
                          Partial
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
                    {s.status === 'partial' && (
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
                          onClick={() => setRunner({ type: 'chase', sig: s })}
                        >
                          Chase
                        </Button>
                      </div>
                    )}
                    {done && <Lock size={14} className="flex-none text-success" aria-hidden />}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {view === 'wires' && (
        <Card className="p-[18px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Banknote size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                The wire board
              </div>
              <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                Stage a wire on the ledger
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
                  type: 'stage-wire',
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
              No wires on the ledger yet — outbound wires stage until you release, inbound sit
              expected until you confirm receipt.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-[7px]">
              {sortedWires.map((w) => {
                const tone = WIRE_TONE[w.status as WireStatus] ?? 'neutral';
                const verb = clearWireVerb(w.status);
                const done = w.status === 'cleared';
                const out = w.direction === 'out';
                return (
                  <div
                    key={w.id}
                    className={cn(
                      'flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3',
                      done && 'opacity-[0.74]'
                    )}
                    style={{ borderLeftWidth: 2, borderLeftColor: TONE_BAR[tone] }}
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
                            'flex-none font-mono text-[12.5px] font-semibold tabular-nums',
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
                    <Badge tone={tone} className="px-2 py-0.5 text-[9.5px]">
                      {WIRE_STATUS_LABEL[w.status as WireStatus] ?? w.status}
                    </Badge>
                    {verb === 'release' && (
                      <Button
                        variant="gold"
                        size="sm"
                        icon={Send}
                        className="flex-none"
                        onClick={() => setRunner({ type: 'clear-wire', wire: w })}
                      >
                        Release
                      </Button>
                    )}
                    {verb === 'confirm' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Check}
                        className="flex-none"
                        onClick={() => setRunner({ type: 'clear-wire', wire: w })}
                      >
                        Confirm
                      </Button>
                    )}
                    {done && <Lock size={14} className="flex-none text-success" aria-hidden />}
                  </div>
                );
              })}
              <div className="mt-2 flex items-center gap-2 text-[11px] text-fg-5">
                <ShieldCheck size={13} className="flex-none text-success" aria-hidden />
                Every wire clears under dual-control approval and logs to your Chain of Trust — this
                records the wire; the money moves at your bank.
              </div>
            </div>
          )}
        </Card>
      )}

      {view === 'accounts' && (
        <Card className="p-[18px]">
          <div className="flex flex-col gap-2.5">
            {/* the prototype's "Total fund cash" strip — honest: no banking is
                connected, so no balance renders (never EX_ACCOUNTS seeds) */}
            <div className="flex items-baseline justify-between rounded-[12px] border border-hairline bg-surface-1 px-4 py-3.5">
              <div>
                <div className="text-[11px] text-fg-4">Total fund cash</div>
                <div className="mt-0.5 text-[24px] font-semibold tabular-nums text-fg-3">—</div>
              </div>
              <span className="text-[11px] text-fg-5">no accounts connected</span>
            </div>
            <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-8 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-3">
                <Landmark size={18} strokeWidth={1.9} aria-hidden />
              </span>
              <h2 className="mt-3 text-[14.5px] font-semibold text-fg-1">
                Balances sync once banking is connected
              </h2>
              <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
                FundExecs OS records and attests wires — it doesn’t hold or move money. When banking
                connects, total fund cash and per-account balances render here from real data.
                Nothing illustrative, nothing seeded.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-fg-5">
              <RefreshCw size={13} className="flex-none text-fg-4" aria-hidden />
              Balances will sync from your banks. Earn flags when a call or wire is needed.
            </div>
          </div>
        </Card>
      )}

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Money moves on instructions, and instructions get
          lost in inboxes. Everything here is on the ledger — staged, cleared on your dual-control
          approval, and logged to your Chain of Trust the moment it completes.
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
          }. The document travels outside FundExecs OS — approving puts it on the ledger as awaiting; you record the outcome when it comes back.`}
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

      {runner?.type === 'resolve-signature' && runner.outcome === 'signed' && (
        <ActionRunner
          title={`Sign — ${runner.sig.document}`}
          steps={[
            'Open the execution copy',
            'Apply your signature',
            'Notify counterparties',
            'Log to Chain of Trust'
          ]}
          draftTitle={runner.sig.document}
          draft={`Your signature on "${runner.sig.document}" (${runner.sig.signer}). The document was executed outside FundExecs OS — approving records your attestation on the ledger, timestamped and logged to your Chain of Trust. A signature resolves exactly once.`}
          approveLabel="Approve & sign"
          onApprove={async () => {
            const res = await resolveSignature({ signatureId: runner.sig.id, outcome: 'signed' });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.sig.document} — signed`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'resolve-signature' && runner.outcome === 'declined' && (
        <ActionRunner
          title={`Mark declined — ${runner.sig.document}`}
          steps={['Pull the signature request', 'Verify the outcome', 'Prepare for your approval']}
          draftTitle={`${runner.sig.document} · declined`}
          draft={`Record ${runner.sig.signer}'s outcome on "${runner.sig.document}" as declined. A signature resolves exactly once — this is final on the ledger.`}
          approveLabel="Approve & record"
          onApprove={async () => {
            const res = await resolveSignature({
              signatureId: runner.sig.id,
              outcome: 'declined'
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.sig.document} — declined`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'mark-partial' && (
        <ActionRunner
          title={`Mark partial — ${runner.sig.document}`}
          steps={[
            'Pull the signature request',
            'Count the signatures in',
            'Prepare for your approval'
          ]}
          draftTitle={`${runner.sig.document} · partial`}
          draft={`Some signers on "${runner.sig.document}" are in; the countersignature is outstanding. Approving marks it partial on the ledger — chase the rest from here.`}
          approveLabel="Approve & mark partial"
          onApprove={async () => {
            const res = await markSignaturePartial({ signatureId: runner.sig.id });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.sig.document} — partial`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'chase' && (
        <ActionRunner
          title={`Chase — ${runner.sig.document}`}
          steps={[
            'Draft the reminder',
            'Address the outstanding signers',
            'Prepare for your approval'
          ]}
          draftTitle={`Reminder · ${runner.sig.document}`}
          draft={`Earn drafted a reminder for the outstanding signers on "${runner.sig.document}" (${runner.sig.signer}). The reminder travels outside FundExecs OS until e-sign connects — approving records the chase on the ledger.`}
          approveLabel="Approve & chase"
          onApprove={async () => {
            const res = await chaseSignature({ signatureId: runner.sig.id });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`Chase recorded — ${runner.sig.document}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'stage-wire' && (
        <ActionRunner
          title={`Stage the wire — ${compactMoney(runner.amount)} ${runner.direction === 'in' ? 'in' : 'out'}`}
          steps={[
            'Draft the instruction',
            'Verify amount and counterparty',
            'Stage on the ledger',
            'Prepare for your approval'
          ]}
          draftTitle={`Wire record · ${runner.counterparty}`}
          draft={`${runner.direction === 'in' ? 'Inbound' : 'Outbound'} wire of ${compactMoney(runner.amount)} ${
            runner.direction === 'in' ? 'from' : 'to'
          } ${runner.counterparty}${runner.reference ? ` (ref: ${runner.reference})` : ''}. Approving records it as ${
            runner.direction === 'in'
              ? 'expected — it clears when you confirm receipt against your bank'
              : 'staged — it clears when you release it under dual control'
          }. This records the wire; no money moves through FundExecs OS.`}
          approveLabel="Approve & stage"
          onApprove={async () => {
            const res = await stageWire({
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

      {runner?.type === 'clear-wire' &&
        (() => {
          const out = runner.wire.direction === 'out';
          const amt = compactMoney(runner.wire.amount);
          return (
            <ActionRunner
              title={`${out ? 'Release' : 'Confirm receipt'} — ${amt} ${runner.wire.counterparty}`}
              steps={[
                'Verify account & amount',
                'Dual-control approval',
                out ? 'Release the wire' : 'Match the inbound funds',
                'Log to Chain of Trust'
              ]}
              draftTitle={`${amt} · ${runner.wire.counterparty}`}
              draft={`${out ? 'Outbound' : 'Inbound'} wire of ${amt} — ${
                out ? 'to' : 'from'
              } ${runner.wire.counterparty}. Approve to ${
                out ? 'release' : 'confirm'
              } under dual control. This RECORDS the wire on your ledger and logs it to the Chain of Trust — no money moves through FundExecs OS; you attest against your bank.`}
              approveLabel={out ? 'Approve & release' : 'Approve & confirm'}
              onApprove={async () => {
                const res = await clearWire({ wireId: runner.wire.id });
                return res.ok ? { ok: true } : { ok: false, error: res.error };
              }}
              onClose={() => setRunner(null)}
              onApplied={() => {
                setToast(`${amt} ${runner.wire.counterparty} — cleared`);
                router.refresh();
              }}
            />
          );
        })()}

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
