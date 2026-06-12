'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Check,
  FileSignature,
  Landmark,
  Lock,
  PenLine,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles
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
import {
  canChaseSignature,
  canResolveSignature,
  initialWireStatus,
  signatureSummary,
  SIGNATURE_STATUS_LABEL,
  WIRE_STATUS_LABEL,
  wireSummary,
  type SignatureStatus,
  type WireDirection,
  type WireStatus
} from '@/lib/wires/vocabulary';
import {
  chaseSignature,
  clearWire,
  resolveSignature,
  sendSignature,
  stageWire
} from '@/lib/wires/actions';
import { cn } from '@/lib/utils';

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

/** The prototype's left-border accent per badge tone. */
const TONE_LINE: Record<BadgeTone, string> = {
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  neutral: 'var(--border)'
};

type View = 'signatures' | 'wires' | 'accounts';

type RunnerState =
  | {
      type: 'send-signature';
      document: string;
      signer: string;
      signerRole: string;
      drives: string;
      amountLabel: string;
      closingId: string;
    }
  | { type: 'resolve-signature'; sig: SignatureView; outcome: 'partial' | 'signed' | 'declined' }
  | { type: 'chase-signature'; sig: SignatureView }
  | {
      type: 'stage-wire';
      direction: WireDirection;
      amount: number;
      counterparty: string;
      label: string;
      drives: string;
      closingId: string;
    }
  | { type: 'clear-wire'; wire: WireView };

function sigResolved(status: string): boolean {
  return status === 'signed' || status === 'declined';
}

function wireToLine(w: { direction: string; counterparty: string }): string {
  return `${w.direction === 'out' ? 'To' : 'From'} ${w.counterparty}`;
}

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
  const [view, setView] = useState<View>('signatures');
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Send-a-document form
  const [sigDoc, setSigDoc] = useState('');
  const [sigSigner, setSigSigner] = useState('');
  const [sigRole, setSigRole] = useState('');
  const [sigDrives, setSigDrives] = useState('');
  const [sigAmt, setSigAmt] = useState('');
  const [sigClosing, setSigClosing] = useState('');

  // Stage-a-wire form
  const [wDirection, setWDirection] = useState<WireDirection>('in');
  const [wAmount, setWAmount] = useState('');
  const [wCounterparty, setWCounterparty] = useState('');
  const [wLabel, setWLabel] = useState('');
  const [wDrives, setWDrives] = useState('');
  const [wClosing, setWClosing] = useState('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const closingOptions = [
    { value: '', label: 'No closing — standalone' },
    // Suffix a short id so same-counterparty (or null-counterparty) closings stay distinct.
    ...openClosings.map((c) => ({
      value: c.id,
      label: `${c.counterparty ?? 'Open closing'} · ${c.id.slice(0, 8)}`
    }))
  ];

  const sigSummary = signatureSummary(signatures);
  const board = wireSummary(wires);
  const wAmountNum = Number(wAmount);
  const wireFormReady =
    Number.isFinite(wAmountNum) && wAmountNum > 0 && wCounterparty.trim().length > 0;

  const sortedSigs = [...signatures].sort(
    (a, b) => Number(sigResolved(a.status)) - Number(sigResolved(b.status))
  );
  const sortedWires = [...wires].sort(
    (a, b) => Number(a.status === 'cleared') - Number(b.status === 'cleared')
  );

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
              The signature room and money movement — attestations and wire records behind every
              close. Banking and e-sign rails attach later; the record starts now.
            </p>
          </div>
        </div>
      </Card>

      {/* the room: summary tiles → inner tabs → active board */}
      <Card className="p-[18px]">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-3">
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
          </div>
          <div className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-3">
            <div className="text-[10.5px] text-fg-4">Outbound staged</div>
            <div className="mt-1 text-[19px] font-semibold tabular-nums text-gold-1">
              {board.outStagedCount}
            </div>
            <div className="text-[10px] text-fg-5">{compactMoney(board.outTotal)} total out</div>
          </div>
          <div className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-3">
            <div className="text-[10.5px] text-fg-4">Inbound expected</div>
            <div className="mt-1 text-[19px] font-semibold tabular-nums text-azure-1">
              {compactMoney(board.inExpected)}
            </div>
            <div className="text-[10px] text-fg-5">capital incoming</div>
          </div>
        </div>

        <SegTabs
          className="mt-3.5"
          active={view}
          onChange={(id) => setView(id as View)}
          tabs={[
            { id: 'signatures', label: 'Signatures', icon: PenLine },
            { id: 'wires', label: 'Wire transfers', icon: Banknote },
            { id: 'accounts', label: 'Accounts', icon: Landmark }
          ]}
        />

        {view === 'signatures' && (
          <div className="mt-3">
            {sortedSigs.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-fg-4">
                Nothing out for signature yet — the closing docs you send land here.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {sortedSigs.map((s) => {
                  const tone = SIG_TONE[s.status as SignatureStatus] ?? 'neutral';
                  const label = SIGNATURE_STATUS_LABEL[s.status as SignatureStatus] ?? s.status;
                  const done = s.status === 'signed';
                  const meta = [s.signer, s.signerRole, s.drives].filter(Boolean).join(' · ');
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'flex flex-wrap items-center gap-3 rounded-[12px] border border-hairline border-l-2 bg-surface-1 px-3.5 py-3',
                        sigResolved(s.status) && 'opacity-70'
                      )}
                      style={{ borderLeftColor: TONE_LINE[tone] }}
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
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-fg-1">
                            {s.document}
                          </span>
                          {s.amountLabel && (
                            <span className="flex-none font-mono text-[11px] text-gold-1">
                              {s.amountLabel}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[10.5px] text-fg-5">{meta}</div>
                      </div>
                      <Badge tone={tone} className="flex-none px-2 py-0.5 text-[9.5px]">
                        {label}
                      </Badge>
                      {canResolveSignature(s.status) && (
                        <div className="flex flex-none items-center gap-1.5">
                          {canChaseSignature(s.status) && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={Send}
                              onClick={() => setRunner({ type: 'chase-signature', sig: s })}
                            >
                              Chase
                            </Button>
                          )}
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
                          {s.status === 'out_for_signature' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setRunner({ type: 'resolve-signature', sig: s, outcome: 'partial' })
                              }
                            >
                              Partial
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setRunner({ type: 'resolve-signature', sig: s, outcome: 'declined' })
                            }
                          >
                            Decline
                          </Button>
                        </div>
                      )}
                      {done && <Lock size={14} className="flex-none text-success" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            )}

            {/* the honest entry point — docs go out by hand until e-sign connects */}
            <div className="mt-4 border-t border-hairline pt-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Send a document out
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[1fr_1fr_150px_auto] sm:items-end">
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
                <Input
                  label="Role"
                  value={sigRole}
                  onChange={(e) => setSigRole(e.target.value)}
                  placeholder="GP / LP / Agent"
                  maxLength={200}
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
                      signerRole: sigRole.trim(),
                      drives: sigDrives.trim(),
                      amountLabel: sigAmt.trim(),
                      closingId: sigClosing
                    })
                  }
                >
                  Send out
                </Button>
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[1fr_140px_200px]">
                <Input
                  label="What it drives (optional)"
                  value={sigDrives}
                  onChange={(e) => setSigDrives(e.target.value)}
                  placeholder="e.g. Your countersignature closes it"
                  maxLength={200}
                />
                <Input
                  label="Amount (optional)"
                  value={sigAmt}
                  onChange={(e) => setSigAmt(e.target.value)}
                  placeholder="$10M"
                  maxLength={40}
                />
                <Select
                  label="Closing"
                  options={closingOptions}
                  value={sigClosing}
                  onChange={(e) => setSigClosing(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {view === 'wires' && (
          <div className="mt-3">
            {sortedWires.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-fg-4">
                No wires on the board yet — staged outbound releases and expected inbound confirms
                track here once you record one.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {sortedWires.map((w) => {
                  const tone = WIRE_TONE[w.status as WireStatus] ?? 'neutral';
                  const done = w.status === 'cleared';
                  const out = w.direction === 'out';
                  const meta = [wireToLine(w), w.drives, w.reference].filter(Boolean).join(' · ');
                  return (
                    <div
                      key={w.id}
                      className={cn(
                        'flex flex-wrap items-center gap-3 rounded-[12px] border border-hairline border-l-2 bg-surface-1 px-3.5 py-3',
                        done && 'opacity-70'
                      )}
                      style={{ borderLeftColor: TONE_LINE[tone] }}
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
                            {w.label ?? w.counterparty}
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
                        <div className="truncate text-[10.5px] text-fg-5">{meta}</div>
                      </div>
                      <Badge tone={tone} className="flex-none px-2 py-0.5 text-[9.5px]">
                        {WIRE_STATUS_LABEL[w.status as WireStatus] ?? w.status}
                      </Badge>
                      {w.status === 'staged' && (
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
                      {w.status === 'expected' && (
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
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 text-[11px] text-fg-5">
              <ShieldCheck size={13} className="flex-none text-success" aria-hidden />
              Every wire moves under dual-control approval and logs to your Chain of Trust — this
              records the wire; no money moves through FundExecs OS.
            </div>

            {/* the honest entry point — the record is real, the rails attach later */}
            <div className="mt-4 border-t border-hairline pt-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Stage a wire
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[130px_1fr_1fr_auto] sm:items-end">
                <Select
                  label="Direction"
                  options={[
                    { value: 'in', label: 'Inbound' },
                    { value: 'out', label: 'Outbound' }
                  ]}
                  value={wDirection}
                  onChange={(e) => setWDirection(e.target.value as WireDirection)}
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
                      label: wLabel.trim(),
                      drives: wDrives.trim(),
                      closingId: wClosing
                    })
                  }
                >
                  Stage wire
                </Button>
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[1fr_1fr_200px]">
                <Input
                  label="Label (optional)"
                  value={wLabel}
                  onChange={(e) => setWLabel(e.target.value)}
                  placeholder="e.g. Helios purchase price"
                  maxLength={200}
                />
                <Input
                  label="What it drives (optional)"
                  value={wDrives}
                  onChange={(e) => setWDrives(e.target.value)}
                  placeholder="e.g. Funds the acquisition"
                  maxLength={200}
                />
                <Select
                  label="Closing"
                  options={closingOptions}
                  value={wClosing}
                  onChange={(e) => setWClosing(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {view === 'accounts' && (
          /* Banking hook point: when the banking integration lands, total
             fund cash and per-account balances render here from connected
             data — never seeds. Until then this stays an honest empty state. */
          <div className="mt-3 flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between rounded-[12px] border border-hairline bg-surface-1 px-4 py-3.5">
              <div>
                <div className="text-[11px] text-fg-4">Total fund cash</div>
                <div className="mt-0.5 text-[24px] font-semibold tabular-nums text-fg-3">—</div>
              </div>
              <span className="text-[11px] text-fg-5">no connected accounts</span>
            </div>
            <div className="rounded-[12px] border border-hairline bg-surface-1 px-6 py-8 text-center">
              <Landmark size={22} className="mx-auto text-fg-4" aria-hidden />
              <h2 className="mt-3 text-[15px] font-semibold text-fg-1">
                No bank accounts connected
              </h2>
              <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
                Balances render only from real connected banking — never placeholders. Once your
                accounts link, total fund cash and every per-account balance sync into this strip.
                Until then, the wires you record next door are the ledger of record.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-fg-5">
              <RefreshCw size={13} className="flex-none text-fg-4" aria-hidden />
              Balances sync from your banks once connected. Earn flags when a call or wire is
              needed.
            </div>
          </div>
        )}
      </Card>

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Money moves on instructions, and instructions get
          lost in inboxes. Everything here is on the record — signatures attested, wires released or
          confirmed under dual control, each one logged to your Chain of Trust.
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
            runner.signerRole ? ` (${runner.signerRole})` : ''
          }${
            runner.closingId ? ' under its closing' : ''
          }. Approving puts it on the ledger as awaiting; the document itself goes out through your own channels until e-sign connects.`}
          approveLabel="Approve & send"
          onApprove={async () => {
            const res = await sendSignature({
              document: runner.document,
              signer: runner.signer,
              signerRole: runner.signerRole || null,
              drives: runner.drives || null,
              amountLabel: runner.amountLabel || null,
              closingId: runner.closingId || null
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setSigDoc('');
            setSigSigner('');
            setSigRole('');
            setSigDrives('');
            setSigAmt('');
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
          draftTitle={
            runner.sig.amountLabel
              ? `${runner.sig.amountLabel} · ${runner.sig.document}`
              : runner.sig.document
          }
          draft={`Your signature on ${runner.sig.document}${
            runner.sig.signerRole ? ` (${runner.sig.signerRole})` : ''
          }${
            runner.sig.drives ? ` — ${runner.sig.drives.toLowerCase()}` : ''
          }. Approving records your attestation — the document was executed outside FundExecs OS — timestamped and logged to your Chain of Trust.`}
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

      {runner?.type === 'resolve-signature' && runner.outcome === 'partial' && (
        <ActionRunner
          title={`Mark partial — ${runner.sig.document}`}
          steps={[
            'Pull the signature request',
            'Record who has signed',
            'Prepare for your approval'
          ]}
          draftTitle={`${runner.sig.document} · partial`}
          draft={`Record "${runner.sig.document}" as partially signed — some signers are in, the rest outstanding. You can chase the holdouts from the board.`}
          approveLabel="Approve & record"
          onApprove={async () => {
            const res = await resolveSignature({ signatureId: runner.sig.id, outcome: 'partial' });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.sig.document} — partial`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'resolve-signature' && runner.outcome === 'declined' && (
        <ActionRunner
          title={`Mark declined — ${runner.sig.document}`}
          steps={['Pull the signature request', 'Verify the outcome', 'Prepare for your approval']}
          draftTitle={`${runner.sig.document} · declined`}
          draft={`Record ${runner.sig.signer}'s outcome on "${runner.sig.document}" as declined. Declined is final on the ledger.`}
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

      {runner?.type === 'chase-signature' && (
        <ActionRunner
          title={`Chase — ${runner.sig.document}`}
          steps={[
            'Pull the outstanding signers',
            'Draft the reminder',
            'Prepare for your approval'
          ]}
          draftTitle={`Reminder · ${runner.sig.document}`}
          draft={`"${runner.sig.document}" is partially signed${
            runner.sig.drives ? ` — ${runner.sig.drives.toLowerCase()}` : ''
          }. Approving records the chase on the ledger; the reminder goes out through your own channels until e-sign connects.`}
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
          draftTitle={`Wire record · ${runner.label || runner.counterparty}`}
          draft={`${runner.direction === 'out' ? 'Outbound' : 'Inbound'} wire of ${compactMoney(
            runner.amount
          )} — ${runner.direction === 'out' ? 'to' : 'from'} ${runner.counterparty}${
            runner.drives ? `. ${runner.drives}` : ''
          }. Approving records it as ${WIRE_STATUS_LABEL[initialWireStatus(runner.direction)].toLowerCase()}; it clears only on your further approval under dual control. This records the wire — no money moves through FundExecs OS.`}
          approveLabel="Approve & stage"
          onApprove={async () => {
            const res = await stageWire({
              direction: runner.direction,
              amount: runner.amount,
              counterparty: runner.counterparty,
              label: runner.label || null,
              drives: runner.drives || null,
              closingId: runner.closingId || null
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setWAmount('');
            setWCounterparty('');
            setWLabel('');
            setWDrives('');
            setWClosing('');
            setToast(`Wire staged — ${compactMoney(runner.amount)} ${runner.counterparty}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'clear-wire' && (
        <ActionRunner
          title={`${runner.wire.direction === 'out' ? 'Send wire' : 'Confirm receipt'} — ${
            runner.wire.label ?? runner.wire.counterparty
          }`}
          steps={[
            'Verify account & amount',
            'Dual-control approval',
            runner.wire.direction === 'out' ? 'Release the wire' : 'Match the inbound funds',
            'Log to Chain of Trust'
          ]}
          draftTitle={`${compactMoney(runner.wire.amount)} · ${runner.wire.label ?? runner.wire.counterparty}`}
          draft={`${runner.wire.direction === 'out' ? 'Outbound' : 'Inbound'} wire of ${compactMoney(
            runner.wire.amount
          )} — ${runner.wire.direction === 'out' ? 'to' : 'from'} ${runner.wire.counterparty}${
            runner.wire.drives ? `. ${runner.wire.drives}` : ''
          }. Approve to ${
            runner.wire.direction === 'out' ? 'release' : 'confirm'
          } under dual control. This records the wire against your bank — no money moves through FundExecs OS.`}
          approveLabel={runner.wire.direction === 'out' ? 'Approve & release' : 'Approve & confirm'}
          onApprove={async () => {
            const res = await clearWire({ wireId: runner.wire.id });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${compactMoney(runner.wire.amount)} ${runner.wire.counterparty} — cleared`);
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
