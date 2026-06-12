'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  GitBranch,
  Hammer,
  Landmark,
  Lightbulb,
  Link2,
  Loader2,
  Lock,
  PenLine,
  ShieldCheck,
  Sparkles,
  X,
  XCircle
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { verifyChain } from '@/app/(shell)/execute/chain-of-trust/actions';
import { approveEvidence } from '@/lib/actions/trust';
import { compactMoney } from '@/lib/format';
import type {
  ApprovalQueueItem,
  TrustCenterData,
  TrustRecordSummary,
  TrustTierKey
} from '@/lib/queries/trust-center';
import type { TrustLayerKey } from '@/lib/queries/trust';
import {
  blockNumber,
  countByLayer,
  filterByLayer,
  LEDGER_LAYERS,
  ledgerLayerMeta,
  ledgerSource,
  shortRecordId,
  type LedgerFilter
} from '@/lib/trust-ledger/vocabulary';
import { cn } from '@/lib/utils';

const LAYERS: { key: TrustLayerKey; label: string }[] = [
  { key: 'truth', label: 'Proof of Truth' },
  { key: 'concept', label: 'Proof of Concept' },
  { key: 'execution', label: 'Proof of Execution' },
  { key: 'work', label: 'Proof of Work' }
];

const TIER_TONE: Record<TrustTierKey, BadgeTone> = {
  forming: 'neutral',
  building: 'warning',
  proven: 'azure',
  trusted: 'gold',
  institutional: 'success'
};

const LAYER_ICON: Record<TrustLayerKey, LucideIcon> = {
  truth: Fingerprint,
  concept: Lightbulb,
  execution: PenLine,
  work: Hammer
};

/** The prototype's tone chips for the COT_LAYERS strip, by layer tone. */
const LAYER_CHIP: Record<string, string> = {
  azure: 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1',
  info: 'border-[var(--info-line)] bg-[var(--info-soft)] text-info',
  warning: 'border-[var(--warning-line)] bg-[var(--warning-soft)] text-warning',
  success: 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
};

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
});

type RunnerState = { item: ApprovalQueueItem; decision: 'approved' | 'rejected' };

type VerifyState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; summary: string; intact: boolean };

export function ChainOfTrustFlow({ data }: { data: TrustCenterData }) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ phase: 'idle' });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // The ledger — newest first, like the prototype; blocks count from oldest.
  const ledger = data.records
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const layerCounts = countByLayer(ledger);
  const shown = filterByLayer(ledger, filter);
  const openRecord: TrustRecordSummary | null = openId
    ? (ledger.find((r) => r.id === openId) ?? null)
    : null;

  async function runVerify() {
    setVerify({ phase: 'running' });
    const res = await verifyChain();
    if (!res.ok) {
      setVerify({ phase: 'done', summary: res.error, intact: false });
      return;
    }
    setVerify({
      phase: 'done',
      intact: res.issues.length === 0,
      summary:
        res.issues.length === 0
          ? `Re-queried ${res.records} record${res.records === 1 ? '' : 's'} and ${res.layers} proof layer${res.layers === 1 ? '' : 's'} — counts and continuity check out.`
          : res.issues.join(' ')
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <GitBranch size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Chain of Trust
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              The four-layer proof ledger every module writes to — claims become evidence, evidence
              gets approved, and the record compounds into institutional readiness.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{data.iri}</div>
            <div className="text-[10.5px] text-fg-5">readiness index</div>
          </div>
          <Badge tone={TIER_TONE[data.tier.key]} className="flex-none">
            {data.tier.label}
          </Badge>
        </div>

        {/* layer rollup */}
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {LAYERS.map((layer) => (
            <div
              key={layer.key}
              className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.08em] text-fg-5">
                  {layer.label}
                </span>
                <span className="text-[12px] font-semibold tabular-nums text-fg-2">
                  {data.layerRollup[layer.key]}%
                </span>
              </div>
              <div className="mt-1.5">
                <ProgressBar
                  value={data.layerRollup[layer.key]}
                  height={4}
                  label={`${layer.label} completion`}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {data.empty ? (
        <Card className="p-8 text-center">
          <GitBranch size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">The ledger starts with work</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Nothing proven yet — and nothing faked. Close a deal, fund a call, finish a diligence
            run: every real close writes its first proof layer here automatically.
          </p>
        </Card>
      ) : (
        <>
          {/* the 4 proof layers — the prototype's COT_LAYERS strip, counting
              and filtering the REAL ledger */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {LEDGER_LAYERS.map((l) => {
              const Icon = LAYER_ICON[l.key];
              const on = filter === l.key;
              return (
                <button
                  key={l.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(on ? 'all' : l.key)}
                  className={cn(
                    'rounded-[13px] border p-[13px] text-left transition',
                    on ? LAYER_CHIP[l.tone] : 'border-hairline bg-surface-1 hover:bg-surface-2'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[8px] border',
                        LAYER_CHIP[l.tone]
                      )}
                    >
                      <Icon size={16} strokeWidth={1.9} aria-hidden />
                    </span>
                    <span className="rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-fg-2">
                      {layerCounts[l.key]}
                    </span>
                  </div>
                  <div className="mt-2.5 text-[12.5px] font-semibold text-fg-1">{l.name}</div>
                  <div className="mt-0.5 text-[10.5px] leading-[1.4] text-fg-5">{l.desc}</div>
                </button>
              );
            })}
          </div>

          {/* integrity banner — honest: records aren't cryptographically
              hashed yet, so Verify re-queries and cross-checks continuity */}
          <Card className="border-[var(--success-line)] bg-[var(--success-soft)] p-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <ShieldCheck size={18} className="flex-none text-success" aria-hidden />
              <div className="min-w-0 flex-1 basis-60 text-[12.5px] text-fg-2">
                <b className="text-success">Chain intact.</b> {data.recordCount} record
                {data.recordCount === 1 ? '' : 's'} on the ledger, each tied to its source entity
                and timestamped. Cryptographic sealing lands with hashing{' '}
                <Badge tone="neutral" className="px-1.5 py-0 text-[8.5px]">
                  Illustrative
                </Badge>{' '}
                — until then, Verify re-queries the ledger and cross-checks its continuity.
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={verify.phase === 'running' ? Loader2 : ShieldCheck}
                disabled={verify.phase === 'running'}
                onClick={runVerify}
              >
                {verify.phase === 'running' ? 'Verifying…' : 'Verify chain'}
              </Button>
            </div>
            {verify.phase === 'done' && (
              <div
                className={cn(
                  'mt-2 flex items-start gap-2 text-[11.5px]',
                  verify.intact ? 'text-fg-3' : 'text-warning'
                )}
              >
                {verify.intact ? (
                  <Check size={13} className="mt-0.5 flex-none text-success" aria-hidden />
                ) : (
                  <XCircle size={13} className="mt-0.5 flex-none" aria-hidden />
                )}
                {verify.summary}
              </div>
            )}
          </Card>

          {/* capital posture */}
          <Card className="p-[18px]">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                <Landmark size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  Capital posture
                </div>
                <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                  Proof, weighted by the money behind it
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['Under proof', data.capital.capitalUnderProof, 'text-success'],
                  ['Exposed', data.capital.capitalExposed, 'text-warning'],
                  ['Coverage', data.capital.proofCoveragePct, 'text-fg-1']
                ] as const
              ).map(([label, value, tone]) => (
                <div
                  key={label}
                  className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3 py-2.5"
                >
                  <div className={cn('text-[15px] font-semibold tabular-nums', tone)}>
                    {label === 'Coverage' ? `${value}%` : compactMoney(value)}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.08em] text-fg-5">{label}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* approval queue */}
          {data.viewer.canApprove && data.approvals.length > 0 && (
            <Card className="p-[18px]">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
                  <FileCheck2 size={16} strokeWidth={1.9} aria-hidden />
                </span>
                <div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                    {data.approvals.length} waiting on you
                  </div>
                  <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                    Evidence approval queue
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {data.approvals.map((a) => (
                  <div
                    key={a.evidenceId}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-[12px] border px-3.5 py-3',
                      a.stale
                        ? 'border-[var(--warning-line)] bg-[var(--warning-soft)]'
                        : 'border-hairline bg-surface-1'
                    )}
                  >
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="truncate text-[13px] font-semibold text-fg-1">
                        {a.fileName}
                      </div>
                      <div className="text-[10.5px] text-fg-5">
                        {a.recordTitle} · {a.layerName}
                        {a.capitalAtStake > 0
                          ? ` · ${compactMoney(a.capitalAtStake)} at stake`
                          : ''}
                        {a.stale ? ' · waiting 7+ days' : ''}
                      </div>
                    </div>
                    {a.aiValidated && (
                      <Badge tone="info" className="px-2 py-0.5 text-[9.5px]">
                        AI-checked
                      </Badge>
                    )}
                    <div className="flex flex-none items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={CheckCircle2}
                        onClick={() => setRunner({ item: a, decision: 'approved' })}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={XCircle}
                        onClick={() => setRunner({ item: a, decision: 'rejected' })}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* the record ledger — prototype rail, layer chips, real ids */}
          <Card className="p-[18px]">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                <GitBranch size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  Record ledger · {shown.length}
                  {filter !== 'all' ? ` · ${ledgerLayerMeta(filter).name}` : ''}
                </div>
                <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                  Proof records
                </div>
              </div>
              <a
                href="/execute/chain-of-trust/export"
                download
                className="inline-flex flex-none items-center gap-2 rounded-xl bg-transparent px-3 py-1.5 text-[12.5px] font-medium text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
              >
                <Download size={14} strokeWidth={1.9} aria-hidden />
                Export ledger
              </a>
            </div>
            {shown.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-fg-4">
                No records on {filter === 'all' ? 'the ledger' : ledgerLayerMeta(filter).name} yet —
                they land here the moment real work completes.
              </p>
            ) : (
              <div className="flex flex-col">
                {shown.map((r, i) => {
                  const lm = ledgerLayerMeta(r.currentLayerKey);
                  return (
                    <div key={r.id} className="flex items-stretch gap-3">
                      {/* rail */}
                      <div className="flex w-6 flex-none flex-col items-center">
                        <span
                          className={cn(
                            'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border',
                            LAYER_CHIP[lm.tone]
                          )}
                        >
                          <Check size={11} aria-hidden />
                        </span>
                        {i < shown.length - 1 && (
                          <span className="w-0.5 flex-1 bg-[var(--border-faint)]" aria-hidden />
                        )}
                      </div>
                      {/* record */}
                      <button
                        type="button"
                        onClick={() => setOpenId(r.id)}
                        className="mb-2 flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:bg-surface-2"
                      >
                        <div className="min-w-0 flex-1 basis-44">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] font-semibold text-fg-1">
                              {r.title}
                            </span>
                            <span
                              className={cn(
                                'flex-none rounded-[4px] border px-[5px] py-px text-[8.5px] font-bold',
                                LAYER_CHIP[lm.tone]
                              )}
                            >
                              {lm.name.replace('Proof of ', '')}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-fg-5">
                            {ledgerSource(r.entityType).label} ·{' '}
                            {DATE_FMT.format(new Date(r.createdAt))}
                            {r.capitalAtStake > 0 && r.entityType === 'deal'
                              ? ` · ${compactMoney(r.capitalAtStake)}`
                              : ''}
                            {r.pendingEvidence > 0 ? ` · ${r.pendingEvidence} pending` : ''}
                          </div>
                        </div>
                        <div className="flex flex-none items-center gap-1">
                          {LAYERS.map((layer) => (
                            <span
                              key={layer.key}
                              title={`${layer.label}: ${r.layers[layer.key]}%`}
                              className={cn(
                                'h-1.5 w-7 rounded-full',
                                r.layers[layer.key] >= 100
                                  ? 'bg-success'
                                  : r.layers[layer.key] > 0
                                    ? 'bg-gold-1'
                                    : 'bg-surface-3'
                              )}
                            />
                          ))}
                        </div>
                        <span className="flex-none font-mono text-[10.5px] text-fg-4">
                          {shortRecordId(r.id)}
                        </span>
                        <Badge
                          tone={TIER_TONE[r.tier.key]}
                          className="flex-none px-2 py-0.5 text-[9.5px]"
                        >
                          {r.tier.label}
                        </Badge>
                        <Lock size={13} className="flex-none text-success" aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* next actions */}
          {data.nextActions.length > 0 && (
            <Card className="p-[18px]">
              <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                What moves the index next
              </div>
              <div className="flex flex-col gap-1.5">
                {data.nextActions.map((a) => (
                  <div
                    key={a.key}
                    className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                  >
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                      <Sparkles size={15} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-fg-1">{a.title}</div>
                      <div className="text-[10.5px] text-fg-5">{a.detail}</div>
                    </div>
                    {a.capitalImpact > 0 && (
                      <span className="flex-none text-[11px] tabular-nums text-fg-4">
                        {compactMoney(a.capitalImpact)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Institutions don’t underwrite claims — they
          underwrite records. Every close, every approved document, every finished run writes a
          layer here. You never assemble proof; you accumulate it.
        </p>
      </Card>

      {runner && (
        <ActionRunner
          title={`${runner.decision === 'approved' ? 'Approve' : 'Reject'} evidence — ${runner.item.fileName}`}
          steps={[
            'Pull the evidence record',
            'Check the AI validation notes',
            'Prepare for your approval'
          ]}
          draftTitle={`${runner.item.fileName} · ${runner.decision}`}
          draft={`${runner.decision === 'approved' ? 'Approve' : 'Reject'} "${runner.item.fileName}" on ${runner.item.recordTitle} (${runner.item.layerName}).${
            runner.item.aiValidationNotes ? ` AI notes: ${runner.item.aiValidationNotes}` : ''
          }${
            runner.decision === 'approved'
              ? ' Approving advances the layer it sits on — this is the human sign-off the chain is built around.'
              : ' Rejecting sends it back for better evidence; the layer holds.'
          }`}
          approveLabel={runner.decision === 'approved' ? 'Approve evidence' : 'Confirm rejection'}
          onApprove={async () => {
            const res = await approveEvidence({
              evidenceId: runner.item.evidenceId,
              decision: runner.decision,
              rejectionReason:
                runner.decision === 'rejected'
                  ? 'Rejected from the Chain of Trust queue'
                  : undefined
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.item.fileName} — ${runner.decision}`);
            router.refresh();
          }}
        />
      )}

      {/* record drawer — Recorded via / Timestamp / Proof layer / Block #,
          the record's REAL id where the prototype showed a hash, and a live
          deep link to the originating surface */}
      {openRecord &&
        (() => {
          const lm = ledgerLayerMeta(openRecord.currentLayerKey);
          const Icon = LAYER_ICON[openRecord.currentLayerKey];
          const source = ledgerSource(openRecord.entityType);
          const idx = ledger.findIndex((r) => r.id === openRecord.id);
          return (
            <>
              <div
                onClick={() => setOpenId(null)}
                className="fixed inset-0 z-[60] bg-[rgba(3,6,12,0.64)] backdrop-blur-[3px]"
                aria-hidden
              />
              <div className="fixed bottom-0 right-0 top-0 z-[61] w-[440px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]">
                <div className="flex items-center gap-3 border-b border-hairline px-5 py-[18px]">
                  <span
                    className={cn(
                      'flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border',
                      LAYER_CHIP[lm.tone]
                    )}
                  >
                    <Icon size={20} strokeWidth={1.9} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-semibold text-fg-1">
                      {openRecord.title}
                    </div>
                    <div className="text-[11.5px] text-fg-4">{lm.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    aria-label="Close"
                    className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[8px] text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
                  >
                    <X size={17} aria-hidden />
                  </button>
                </div>
                <div className="flex flex-col gap-3.5 p-5">
                  <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] px-2.5 py-1 text-[12px] font-semibold text-success">
                    <ShieldCheck size={13} aria-hidden />
                    On the record
                  </span>
                  <div className="overflow-hidden rounded-[12px] border border-hairline">
                    {(
                      [
                        ['Recorded via', source.label],
                        ['Timestamp', DATE_FMT.format(new Date(openRecord.createdAt))],
                        ['Proof layer', lm.name],
                        ['Block #', blockNumber(idx, ledger.length)]
                      ] as const
                    ).map(([k, v], j) => (
                      <div
                        key={k}
                        className={cn(
                          'flex gap-3.5 px-3.5 py-2.5',
                          j % 2 === 0 && 'bg-surface-1',
                          j > 0 && 'border-t border-[var(--border-faint)]'
                        )}
                      >
                        <span className="w-[100px] flex-none text-[11.5px] text-fg-4">{k}</span>
                        <span className="text-[12.5px] font-medium text-fg-1">{v}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                      Record id
                    </div>
                    <div className="break-all rounded-[10px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3.5 py-2.5 font-mono text-[12px] text-[var(--accent)]">
                      {openRecord.id}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-fg-5">
                    <Link2 size={13} className="flex-none text-fg-4" aria-hidden />
                    This is the row’s real id — auditable in the database. Hash-linking arrives with
                    cryptographic sealing.
                  </div>
                  {source.href ? (
                    <Link
                      href={source.href}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
                    >
                      <ExternalLink size={14} strokeWidth={1.9} aria-hidden />
                      Open source surface
                    </Link>
                  ) : (
                    <p className="text-center text-[11px] text-fg-5">
                      This record’s originating surface has no deep link yet.
                    </p>
                  )}
                </div>
              </div>
            </>
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
