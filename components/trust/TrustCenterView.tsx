'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  Sparkles,
  Printer,
  ArrowUpRight,
  Check,
  XCircle,
  Gavel,
  Layers,
  Clock,
  type LucideIcon
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionTitle,
  SegTabs,
  type BadgeTone
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { useTrustDrawer } from '@/components/shell/trust/TrustDrawerHost';
import { TRUST_LAYERS, trustLayerMeta } from '@/components/shell/trust/trust-layers';
import { approveEvidence } from '@/lib/actions/trust';
import type { TrustLayerKey } from '@/lib/queries/trust';
import type {
  TrustCenterData,
  TrustRecordSummary,
  ApprovalQueueItem,
  NextAction,
  ChecklistItem,
  TrustTierKey
} from '@/lib/queries/trust-center';

/* ----------------------------------------------------------------------------
 * Trust Center — the standalone /trust surface.
 *
 * Reads the org-wide aggregation from `getTrustCenterData` and lays it out as
 * an executive posture desk: one capital-weighted Institutional Readiness
 * Index up top, the strategic-capital it secures, the highest-leverage moves,
 * a governance approval queue, a readiness checklist, and every chain in the
 * org. Records open the shared Chain-of-Trust drawer for layer-level detail.
 * --------------------------------------------------------------------------*/

// Reuse the canonical proof-layer design tokens (name/colour) rather than
// redefining them — single source of truth lives in trust-layers.ts.
const LAYER_ORDER: TrustLayerKey[] = TRUST_LAYERS.map((l) => l.layer);

const TIER_TONE: Record<TrustTierKey, BadgeTone> = {
  institutional: 'gold',
  trusted: 'success',
  proven: 'azure',
  building: 'warning',
  forming: 'neutral'
};

const PROOF_GRADIENT =
  'linear-gradient(90deg, var(--proof-truth), var(--proof-concept), var(--proof-execution), var(--proof-work))';

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

/* ---------------------------------- header --------------------------------- */

function PostureHero({ data }: { data: TrustCenterData }) {
  const tone = TIER_TONE[data.tier.key];
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Index */}
        <div className="flex flex-col gap-4 border-b border-hairline p-5 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              Institutional Readiness Index
            </span>
            <Badge tone={tone} dot>
              {data.tier.label}
            </Badge>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-[56px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-fg-1">
              {data.iri}
              <span className="text-[24px] text-fg-4">%</span>
            </span>
            <span className="mb-1.5 text-[11.5px] leading-snug text-fg-4">
              capital-weighted
              <br />
              proof posture
            </span>
          </div>
          <ProgressBar
            value={data.iri}
            gradient={PROOF_GRADIENT}
            height={8}
            ariaLabel="Institutional Readiness Index"
          />
          <p className="text-[11.5px] leading-relaxed text-fg-4">
            Weighted by the capital each chain secures and by how far through the four proof layers
            it has advanced. Unweighted average across all {data.recordCount} chains is{' '}
            <span className="font-semibold text-fg-2">{data.simpleMean}%</span>.
          </p>
        </div>
        {/* Capital coverage gauge — the synthesis; raw dollar figures live in
            the CapitalStrip below, so this panel stays qualitative. */}
        <div className="flex flex-col justify-center gap-3 bg-[linear-gradient(120deg,rgba(247,201,72,0.05),transparent_60%)] p-5">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            <TrendingUp size={13} strokeWidth={2} aria-hidden /> Capital under proof
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[40px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-fg-1">
              {data.capital.proofCoveragePct}
              <span className="text-[20px] text-fg-4">%</span>
            </span>
            <span className="mb-1 text-[11.5px] leading-snug text-fg-3">
              of active pipeline sits
              <br />
              behind a Proven-or-better chain
            </span>
          </div>
          <ProgressBar
            value={data.capital.proofCoveragePct}
            color="var(--gold-1)"
            height={6}
            ariaLabel="Capital under proof"
          />
          {data.capital.capitalExposed > 0 ? (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-fg-3">
              <AlertTriangle
                size={13}
                strokeWidth={2}
                className="mt-px flex-none text-[var(--proof-execution)]"
                aria-hidden
              />
              <span>
                {100 - data.capital.proofCoveragePct}% is exposed — deal value carrying no proof, or
                a chain below Proven grade. See the breakdown below.
              </span>
            </p>
          ) : data.capital.activeDeals > 0 ? (
            <p className="text-[11.5px] leading-relaxed text-success">
              Every active deal is backed by a Proven-or-better chain.
            </p>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-fg-4">
              No active deals in the pipeline yet.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------ capital strip ------------------------------ */

function CapitalStrip({ data }: { data: TrustCenterData }) {
  const items: { label: string; value: string; sub: string; tone?: string }[] = [
    {
      label: 'Active pipeline',
      value: fmtMoney(data.capital.pipelineValue),
      sub: `${data.capital.activeDeals} live deals`
    },
    {
      label: 'Capital deployed',
      value: fmtMoney(data.capital.capitalDeployed),
      sub: 'accepted + funded'
    },
    {
      label: 'Under proof',
      value: fmtMoney(data.capital.capitalUnderProof),
      sub: `${data.capital.coveredDeals} covered deals`,
      tone: 'var(--success)'
    },
    {
      label: 'Exposed',
      value: fmtMoney(data.capital.capitalExposed),
      sub: 'unproven value',
      tone: data.capital.capitalExposed > 0 ? 'var(--proof-execution)' : undefined
    }
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label} className="p-4">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            {it.label}
          </div>
          <div
            className="mt-1.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1"
            style={it.tone ? { color: it.tone } : undefined}
          >
            {it.value}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-4">{it.sub}</div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------ next actions ------------------------------- */

const ACTION_ICON: Record<NextAction['kind'], LucideIcon> = {
  advance: ArrowUpRight,
  approve: Gavel,
  cover: ShieldCheck,
  maintain: CircleCheck
};

function NextActions({ actions }: { actions: NextAction[] }) {
  const drawer = useTrustDrawer();
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={15} strokeWidth={2} className="text-gold-1" aria-hidden />
        <span className="text-[13px] font-semibold text-fg-1">Where to move next</span>
        <span className="text-[11px] text-fg-4">ranked by capital leverage</span>
      </div>
      <ol className="flex flex-col gap-2.5">
        {actions.map((a, i) => {
          const Icon = ACTION_ICON[a.kind];
          return (
            <li
              key={a.key}
              className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-1 p-3"
            >
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline bg-bg-1 font-mono text-[11px] tabular-nums text-fg-4">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg-1">
                  <Icon size={14} strokeWidth={2} className="flex-none text-gold-1" aria-hidden />
                  <span className="min-w-0">{a.title}</span>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-3">{a.detail}</p>
              </div>
              {a.kind === 'advance' && a.recordId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => drawer.open({ recordId: a.recordId })}
                >
                  Open
                </Button>
              ) : a.kind === 'approve' ? (
                <a
                  href="#approvals"
                  className="flex-none self-center rounded-lg border border-hairline bg-surface-1 px-2.5 py-1.5 text-[12px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
                >
                  Review
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ------------------------------ layer rollup ------------------------------- */

function LayerRollup({ rollup }: { rollup: TrustCenterData['layerRollup'] }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Layers size={15} strokeWidth={2} className="text-fg-3" aria-hidden />
        <span className="text-[13px] font-semibold text-fg-1">Proof depth across the org</span>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {LAYER_ORDER.map((k) => {
          const meta = trustLayerMeta(k);
          const pct = rollup[k];
          return (
            <div key={k} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                  aria-hidden
                />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                  {meta.short}
                </span>
              </div>
              <span
                className="text-[22px] font-semibold tabular-nums tracking-[-0.02em]"
                style={{ color: meta.color }}
              >
                {pct}%
              </span>
              <ProgressBar
                value={pct}
                color={meta.color}
                height={5}
                ariaLabel={`Org-wide ${meta.short} completion`}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ----------------------------- approvals queue ----------------------------- */

function ApprovalRow({
  item,
  canApprove,
  onDone
}: {
  item: ApprovalQueueItem;
  canApprove: boolean;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const meta = trustLayerMeta(item.layerKey);

  function decide(decision: 'approved' | 'rejected') {
    setError(null);
    startTransition(async () => {
      const r = await approveEvidence({
        evidenceId: item.evidenceId,
        decision,
        rejectionReason: decision === 'rejected' ? reason : undefined
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setShowReject(false);
      setReason('');
      onDone();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-1 p-3">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg"
          style={{ background: 'var(--surface-2)', color: meta.color }}
        >
          <ShieldCheck size={14} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-fg-1">{item.recordTitle}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-fg-4">
            <span style={{ color: meta.color }} className="font-medium">
              {meta.short}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{item.fileName}</span>
            {item.uploaderName ? (
              <>
                <span aria-hidden>·</span>
                <span>by {item.uploaderName}</span>
              </>
            ) : null}
            {item.uploadedAt ? (
              <>
                <span aria-hidden>·</span>
                <span>{fmtTime(item.uploadedAt)}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <span className="font-mono text-[11px] tabular-nums text-fg-3">
            {fmtMoney(item.capitalAtStake)}
          </span>
          {item.stale ? (
            <Badge tone="warning" className="text-[9px]">
              <Clock size={9} strokeWidth={2.5} className="mr-0.5 inline" aria-hidden /> stale
            </Badge>
          ) : item.aiValidated ? (
            <Badge tone="azure" className="text-[9px]">
              AI ✓
            </Badge>
          ) : null}
        </div>
      </div>

      {item.aiValidationNotes ? (
        <p className="rounded-lg border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2.5 py-1.5 text-[11px] leading-snug text-fg-2">
          <span className="font-semibold text-azure-1">AI:</span> {item.aiValidationNotes}
        </p>
      ) : null}

      {canApprove ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={Check}
            onClick={() => decide('approved')}
            disabled={pending}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={XCircle}
            onClick={() => setShowReject((v) => !v)}
            disabled={pending}
          >
            Reject
          </Button>
        </div>
      ) : (
        <p className="text-[10.5px] text-fg-5">Owners and admins approve evidence.</p>
      )}

      {showReject ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Reason for rejection (optional)"
            className="rounded-md border border-hairline bg-bg-1 px-2.5 py-1.5 text-[12px] text-fg-1 placeholder:text-fg-5 focus:outline-none focus:ring-1 focus:ring-azure-1"
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => decide('rejected')}
              disabled={pending}
            >
              Confirm reject
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowReject(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2 py-1.5 text-[11px] text-danger"
        >
          {error}
        </p>
      ) : null}
    </li>
  );
}

function ApprovalsQueue({
  approvals,
  canApprove,
  onDone
}: {
  approvals: ApprovalQueueItem[];
  canApprove: boolean;
  onDone: () => void;
}) {
  return (
    <Card id="approvals" className="scroll-mt-6 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gavel size={15} strokeWidth={2} className="text-fg-3" aria-hidden />
          <span className="text-[13px] font-semibold text-fg-1">Governance queue</span>
        </div>
        <Badge tone={approvals.length ? 'warning' : 'success'}>{approvals.length} pending</Badge>
      </div>
      {approvals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline bg-bg-1 px-3 py-4 text-center text-[12px] text-fg-4">
          Nothing awaiting sign-off. Every uploaded proof has been decided.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {approvals.map((item) => (
            <ApprovalRow
              key={item.evidenceId}
              item={item}
              canApprove={canApprove}
              onDone={onDone}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------- checklist --------------------------------- */

function Checklist({ items }: { items: ChecklistItem[] }) {
  const met = items.filter((i) => i.met).length;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CircleCheck size={15} strokeWidth={2} className="text-fg-3" aria-hidden />
          <span className="text-[13px] font-semibold text-fg-1">Institutional readiness</span>
        </div>
        <span className="text-[11px] tabular-nums text-fg-4">
          {met}/{items.length} met
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-2.5">
            {it.met ? (
              <CircleCheck
                size={16}
                strokeWidth={2}
                className="mt-px flex-none text-success"
                aria-hidden
              />
            ) : (
              <CircleDashed
                size={16}
                strokeWidth={2}
                className="mt-px flex-none text-fg-5"
                aria-hidden
              />
            )}
            <div className="min-w-0">
              <div className={cn('text-[12.5px] font-medium', it.met ? 'text-fg-2' : 'text-fg-1')}>
                {it.label}
              </div>
              <div className="text-[11px] text-fg-4">{it.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------ records grid ------------------------------- */

function RecordCard({ rec }: { rec: TrustRecordSummary }) {
  const drawer = useTrustDrawer();
  return (
    <button
      type="button"
      onClick={() => drawer.open({ recordId: rec.id })}
      className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-1 p-3.5 text-left transition hover:border-azure-1/40 hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-fg-1">{rec.title}</div>
          <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.08em] text-fg-5">
            {rec.entityType.replace('_', ' ')}
          </div>
        </div>
        <Badge tone={TIER_TONE[rec.tier.key]} className="flex-none text-[9px]">
          {rec.tier.label}
        </Badge>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
          {rec.score}%
        </span>
        <div className="text-right text-[10.5px] text-fg-4">
          <div className="font-mono tabular-nums text-fg-3">{fmtMoney(rec.capitalAtStake)}</div>
          <div>
            {rec.approvedEvidence} approved
            {rec.pendingEvidence > 0 ? ` · ${rec.pendingEvidence} pending` : ''}
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        {LAYER_ORDER.map((k) => {
          const meta = trustLayerMeta(k);
          return (
            <div
              key={k}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
              title={`${meta.short} ${rec.layers[k]}%`}
            >
              <span
                className="block h-full rounded-full"
                style={{ width: `${rec.layers[k]}%`, backgroundColor: meta.color }}
              />
            </div>
          );
        })}
      </div>
    </button>
  );
}

/* --------------------------------- shell ----------------------------------- */

type Filter = 'all' | 'deal' | 'member_profile' | 'objective';

export function TrustCenterView({ data }: { data: TrustCenterData }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');

  const refresh = () => router.refresh();

  const filtered = useMemo(() => {
    if (filter === 'all') return data.records;
    return data.records.filter((r) => r.entityType === filter);
  }, [data.records, filter]);

  const typeTabs = useMemo(() => {
    const present = new Set(data.records.map((r) => r.entityType));
    const tabs: { id: Filter; label: string }[] = [{ id: 'all', label: 'All chains' }];
    if (present.has('deal')) tabs.push({ id: 'deal', label: 'Deals' });
    if (present.has('member_profile')) tabs.push({ id: 'member_profile', label: 'Members' });
    if (present.has('objective')) tabs.push({ id: 'objective', label: 'Objectives' });
    return tabs;
  }, [data.records]);

  if (data.empty) {
    return (
      <div className="flex flex-col gap-5">
        <SectionTitle eyebrow="Institutional posture" title="Trust Center" className="mb-0" />
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-surface-1 text-gold-1">
            <ShieldCheck size={22} strokeWidth={1.8} aria-hidden />
          </span>
          <h3 className="text-[15px] font-semibold text-fg-1">No chains of trust yet</h3>
          <p className="max-w-md text-[12.5px] leading-relaxed text-fg-4">
            The Trust Center rolls every Chain of Trust in your org into one capital-weighted
            posture. Start a chain from a deal, your profile, or an objective — proof compounds here
            as evidence is approved.
          </p>
          <Button variant="primary" onClick={() => router.push('/command-center')}>
            Go to Command Center
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle eyebrow="Institutional posture" title="Trust Center" className="mb-0" />
        <div className="flex items-center gap-2.5 print:hidden">
          <Badge tone="neutral" className="text-[10px]">
            {data.recordCount} chains · {data.pendingCount} pending
          </Badge>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
            Export attestation
          </Button>
        </div>
      </div>

      {/* Print-only attestation header */}
      <div className="hidden print:block">
        <p className="text-[11px] uppercase tracking-[0.12em] text-fg-4">
          Chain-of-Trust Attestation
        </p>
        <p className="text-[11px] text-fg-3">
          Institutional Readiness Index {data.iri}% · {data.tier.label} · generated{' '}
          {new Date(data.generatedAt).toLocaleString()}
        </p>
      </div>

      <PostureHero data={data} />
      <CapitalStrip data={data} />

      <NextActions actions={data.nextActions} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ApprovalsQueue
          approvals={data.approvals}
          canApprove={data.viewer.canApprove}
          onDone={refresh}
        />
        <div className="flex flex-col gap-5">
          <Checklist items={data.checklist} />
          <LayerRollup rollup={data.layerRollup} />
        </div>
      </div>

      {/* Records */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle eyebrow="Every chain" title="Chains of Trust" className="mb-0" />
        {typeTabs.length > 1 ? (
          <SegTabs
            active={filter}
            onChange={(id) => setFilter(id as Filter)}
            tabs={typeTabs}
            className="print:hidden"
          />
        ) : null}
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((rec) => (
          <RecordCard key={rec.id} rec={rec} />
        ))}
      </div>
    </div>
  );
}
