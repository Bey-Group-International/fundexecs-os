'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  GitBranch,
  Landmark,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { approveEvidence } from '@/lib/actions/trust';
import { compactMoney } from '@/lib/format';
import type { ApprovalQueueItem, TrustCenterData, TrustTierKey } from '@/lib/queries/trust-center';
import type { TrustLayerKey } from '@/lib/queries/trust';
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

type RunnerState = { item: ApprovalQueueItem; decision: 'approved' | 'rejected' };

export function ChainOfTrustFlow({ data }: { data: TrustCenterData }) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

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

          {/* the records */}
          <Card className="p-[18px]">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                <GitBranch size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  {data.recordCount} chain{data.recordCount === 1 ? '' : 's'}
                </div>
                <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                  Proof records
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {data.records.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1 basis-44">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{r.title}</div>
                    <div className="text-[10.5px] text-fg-5">
                      {r.entityType}
                      {r.capitalAtStake > 0 ? ` · ${compactMoney(r.capitalAtStake)}` : ''} ·{' '}
                      {r.currentLayer}
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
                  <span className="w-9 flex-none text-right text-[12.5px] font-semibold tabular-nums text-fg-2">
                    {r.score}
                  </span>
                  <Badge
                    tone={TIER_TONE[r.tier.key]}
                    className="flex-none px-2 py-0.5 text-[9.5px]"
                  >
                    {r.tier.label}
                  </Badge>
                </div>
              ))}
            </div>
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
