'use client';

import { useEffect, useState, useTransition, useCallback, useRef } from 'react';
import {
  ShieldCheck,
  CircleCheck,
  Circle,
  Loader,
  Lock,
  Sparkles,
  UserCheck,
  Paperclip,
  X,
  FileText,
  Check,
  XCircle,
  ChevronRight,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import { FX_SPRING, FX_EASE } from '@/components/dashboard/command/motion';
import { TRUST_LAYERS, trustLayerMeta, type TrustLayerMeta } from './trust-layers';
import {
  loadTrustRecord,
  startChainOfTrust,
  approveEvidence,
  revokeEvidence,
  advanceProofLayer,
  type LoadTrustResult,
  type StartChainInput
} from '@/lib/actions/trust';
import type { TrustRecord, TrustLayer, TrustEvidence } from '@/lib/queries/trust';
import { EvidenceUploadForm } from '@/components/drawers/EvidenceUploadForm';

/** The entity a Chain-of-Trust drawer is currently inspecting (legacy presentational mode). */
export interface TrustDrawerSubject {
  entity: string;
  stage: string;
  /** Rolled-up weighted verification percentage. */
  pct: number;
  summary: string;
}

const DEFAULT_SUBJECT: TrustDrawerSubject = {
  entity: 'No record selected',
  stage: 'Chain of Trust',
  pct: 0,
  summary:
    'Open a Chain of Trust from a deal, profile, or objective to see real verification evidence here.'
};

type StarterContext = StartChainInput;

export interface TrustDrawerProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the drawer fetches a real Chain-of-Trust record. */
  recordId?: string | null;
  /** When the entity has no record yet, render a starter CTA + auto-create on click. */
  starterContext?: StarterContext | null;
  /** Legacy presentational subject (used by TrustToaster). */
  subject?: TrustDrawerSubject;
}

function layerStateIcon(pct: number, status: string): { Icon: LucideIcon; spin?: boolean } {
  if (status === 'approved' || pct >= 100) return { Icon: CircleCheck };
  if (status === 'in_progress' || (pct > 0 && pct < 100)) return { Icon: Loader, spin: true };
  if (pct <= 0 && status === 'pending') return { Icon: Lock };
  return { Icon: Circle };
}

/* ============================================================
 * DB-DRIVEN MODE
 * ============================================================ */

function LayerCard({
  layer,
  meta,
  index,
  isCurrent
}: {
  layer: TrustLayer;
  meta: TrustLayerMeta;
  index: number;
  isCurrent: boolean;
}) {
  const { Icon: StateIcon, spin } = layerStateIcon(layer.completionPct, layer.status);
  const LayerIcon = meta.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={FX_SPRING}
      className={cn(
        'relative flex min-w-[150px] flex-1 flex-col gap-2 rounded-2xl border bg-surface-1 p-3.5',
        isCurrent && 'ring-1'
      )}
      style={{
        borderColor: meta.line,
        // current-layer accent ring
        ['--tw-ring-color' as string]: meta.color
      }}
      data-testid={`trust-layer-${layer.layerKey}`}
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl"
          style={{ background: meta.soft, color: meta.color }}
        >
          <LayerIcon size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-fg-5">0{index + 1}</span>
      </div>
      <div className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg-1">{meta.name}</div>
      <div className="text-[11px] leading-snug text-fg-4">{meta.desc}</div>
      <div className="mt-1 flex items-center justify-between">
        <span
          className="text-[17px] font-semibold tabular-nums tracking-[-0.01em]"
          style={{ color: meta.color }}
        >
          {Math.round(layer.completionPct)}%
        </span>
        <StateIcon
          size={15}
          strokeWidth={1.9}
          className={cn('text-fg-4', spin && 'animate-spin')}
          style={layer.status === 'approved' ? { color: meta.color } : undefined}
          aria-hidden
        />
      </div>
    </motion.div>
  );
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function EvidenceRow({
  ev,
  canApprove,
  viewerId,
  onAction
}: {
  ev: TrustEvidence;
  canApprove: boolean;
  viewerId: string;
  onAction: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isUploader = ev.uploaded_by === viewerId;
  const isPending = ev.approval_status === 'pending';
  const canRevoke = isUploader && ev.approval_status !== 'approved';

  function decide(decision: 'approved' | 'rejected') {
    setError(null);
    startTransition(async () => {
      const r = await approveEvidence({
        evidenceId: ev.id,
        decision,
        rejectionReason: decision === 'rejected' ? rejectReason : undefined
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setShowReject(false);
      setRejectReason('');
      onAction();
    });
  }

  function revoke() {
    setError(null);
    startTransition(async () => {
      const r = await revokeEvidence(ev.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onAction();
    });
  }

  const statusTone =
    ev.approval_status === 'approved'
      ? 'success'
      : ev.approval_status === 'rejected'
        ? 'danger'
        : 'warning';

  return (
    <li
      className="flex flex-col gap-2 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5"
      data-testid={`evidence-row-${ev.id}`}
    >
      <div className="flex items-start gap-2.5">
        <FileText size={14} strokeWidth={1.9} className="mt-0.5 text-fg-4" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-fg-1">
            {ev.file_name ?? 'Evidence file'}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10.5px] text-fg-4">
            <span>{fmtSize(ev.size_bytes)}</span>
            <span aria-hidden>·</span>
            <span>{ev.mime_type ?? 'unknown'}</span>
            {ev.uploader_name ? (
              <>
                <span aria-hidden>·</span>
                <span>by {ev.uploader_name}</span>
              </>
            ) : null}
            {ev.uploaded_at ? (
              <>
                <span aria-hidden>·</span>
                <span>{fmtTime(ev.uploaded_at)}</span>
              </>
            ) : null}
          </div>
        </div>
        <Badge tone={statusTone} className="text-[10px] uppercase">
          {ev.approval_status}
        </Badge>
      </div>

      {ev.ai_validation_notes ? (
        <div
          className="rounded-lg border p-2 text-[11px] leading-snug text-fg-2"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}
        >
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
            <Sparkles size={11} strokeWidth={2} aria-hidden />
            AI validation
          </div>
          <p>{ev.ai_validation_notes}</p>
        </div>
      ) : null}

      {ev.rejection_reason && ev.approval_status === 'rejected' ? (
        <p className="rounded-lg border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2 py-1.5 text-[11px] text-danger">
          {ev.rejection_reason}
        </p>
      ) : null}

      {canApprove && isPending ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={Check}
            onClick={() => decide('approved')}
            disabled={pending}
            data-testid={`evidence-approve-${ev.id}`}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={XCircle}
            onClick={() => setShowReject((v) => !v)}
            disabled={pending}
            data-testid={`evidence-reject-${ev.id}`}
          >
            Reject
          </Button>
        </div>
      ) : null}

      {showReject ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            placeholder="Reason for rejection (optional)"
            className="rounded-md border border-hairline bg-surface-1 px-2.5 py-1.5 text-[12px] text-fg-1 placeholder:text-fg-5 focus:outline-none focus:ring-1 focus:ring-azure-1"
            data-testid={`evidence-reject-reason-${ev.id}`}
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => decide('rejected')}
              disabled={pending}
              data-testid={`evidence-reject-submit-${ev.id}`}
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

      {canRevoke && !showReject ? (
        <button
          type="button"
          onClick={revoke}
          disabled={pending}
          className="self-start text-[11px] font-medium text-fg-4 underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
          data-testid={`evidence-revoke-${ev.id}`}
        >
          Revoke
        </button>
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

function LayerSection({
  layer,
  recordId,
  canApprove,
  viewerId,
  onRefresh
}: {
  layer: TrustLayer;
  recordId: string;
  canApprove: boolean;
  viewerId: string;
  onRefresh: () => void;
}) {
  const meta = trustLayerMeta(layer.layerKey);
  const [advancePending, startAdvance] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const approvedCount = layer.evidence.filter((e) => e.approval_status === 'approved').length;
  const pendingCount = layer.evidence.filter((e) => e.approval_status === 'pending').length;

  function startLayer() {
    setError(null);
    startAdvance(async () => {
      const r = await advanceProofLayer(recordId, layer.layerKey);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onRefresh();
    });
  }

  return (
    <section
      className="rounded-2xl border bg-surface-1 p-3.5"
      style={{ borderColor: meta.line }}
      data-testid={`trust-layer-section-${layer.layerKey}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: meta.soft, color: meta.color }}
          >
            <meta.icon size={14} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg-1">
              {meta.name}
            </div>
            <div className="text-[10.5px] text-fg-4">
              {approvedCount} approved · {pendingCount} pending
            </div>
          </div>
        </div>
        <Badge
          tone={
            layer.status === 'approved'
              ? 'success'
              : layer.status === 'in_progress'
                ? 'azure'
                : 'neutral'
          }
          className="text-[10px] uppercase"
        >
          {layer.status.replace('_', ' ')}
        </Badge>
      </div>

      {layer.evidence.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-2">
          {layer.evidence.map((ev) => (
            <EvidenceRow
              key={ev.id}
              ev={ev}
              canApprove={canApprove}
              viewerId={viewerId}
              onAction={onRefresh}
            />
          ))}
        </ul>
      ) : (
        <p className="mb-3 rounded-lg border border-dashed border-hairline bg-bg-1 px-3 py-2.5 text-[11.5px] text-fg-4">
          No evidence uploaded yet for this layer.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <EvidenceUploadForm recordId={recordId} layer={layer.layerKey} onUploaded={onRefresh} />
        {layer.status === 'pending' && canApprove ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={startLayer}
            disabled={advancePending}
            data-testid={`trust-advance-${layer.layerKey}`}
          >
            Mark in progress
          </Button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2 py-1.5 text-[11px] text-danger"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ActivityList({ events }: { events: TrustRecord['events'] }) {
  if (events.length === 0) {
    return (
      <p className="text-[11.5px] text-fg-4">
        No activity yet — uploads and approvals appear here.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="trust-activity-list">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-azure-1" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] text-fg-2">
              <span className="font-medium text-fg-1">{e.actorName ?? 'System'}</span>{' '}
              <span className="text-fg-3">{e.action.replace(/_/g, ' ')}</span>
            </div>
            <div className="font-mono text-[10.5px] tabular-nums text-fg-5">
              {fmtTime(e.occurredAt)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DbRecordView({
  record,
  onClose,
  onRefresh
}: {
  record: TrustRecord;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-fg-2">
          <ShieldCheck size={19} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Chain of Trust
          </div>
          <div className="flex items-center gap-2">
            <span
              className="truncate text-lg font-semibold tracking-[-0.015em] text-fg-1"
              data-testid="trust-record-title"
            >
              {record.title}
            </span>
            <Badge tone="azure" className="px-2 py-0.5 text-[10.5px]">
              {record.currentLayer}
            </Badge>
          </div>
        </div>
        <div className="flex flex-none flex-col items-end">
          <span
            className="text-xl font-semibold tabular-nums tracking-[-0.02em] text-fg-1"
            data-testid="trust-record-pct"
          >
            {Math.round(record.completionPercentage)}%
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            {record.status}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
          data-testid="trust-drawer-close"
        >
          <X size={16} strokeWidth={1.9} aria-hidden />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* Pipeline progress strip */}
        <div className="flex gap-1.5">
          {TRUST_LAYERS.map((meta) => {
            const layer = record.layers.find((l) => l.layerKey === meta.layer);
            const pct = layer ? layer.completionPct : 0;
            return (
              <div
                key={meta.layer}
                className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]"
              >
                <motion.div
                  className="h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: FX_EASE }}
                  style={{ background: meta.color }}
                />
              </div>
            );
          })}
        </div>

        {/* 4-layer pipeline summary */}
        <div className="flex flex-wrap gap-2.5">
          {TRUST_LAYERS.map((meta, i) => {
            const layer = record.layers.find((l) => l.layerKey === meta.layer);
            if (!layer) return null;
            return (
              <LayerCard
                key={meta.layer}
                layer={layer}
                meta={meta}
                index={i}
                isCurrent={record.currentLayerKey === meta.layer}
              />
            );
          })}
        </div>

        {/* Per-layer evidence sections */}
        <div className="flex flex-col gap-3">
          {record.layers.map((layer) => (
            <LayerSection
              key={layer.id}
              layer={layer}
              recordId={record.id}
              canApprove={record.viewerCanApprove}
              viewerId={record.viewerId}
              onRefresh={onRefresh}
            />
          ))}
        </div>

        {/* Activity */}
        <section className="rounded-2xl border border-hairline bg-surface-1 p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-fg-1">
            <UserCheck size={16} strokeWidth={1.9} className="text-fg-3" aria-hidden />
            The record · audit trail
          </div>
          <ActivityList events={record.events} />
        </section>
      </div>
    </>
  );
}

/* ============================================================
 * STARTER MODE (no record yet)
 * ============================================================ */

function StarterView({
  starter,
  onClose,
  onStarted
}: {
  starter: StarterContext;
  onClose: () => void;
  onStarted: (recordId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    startTransition(async () => {
      const r = await startChainOfTrust({
        subjectEntityType: starter.subjectEntityType,
        subjectEntityId: starter.subjectEntityId,
        title: starter.title
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onStarted(r.recordId);
    });
  }

  return (
    <>
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-fg-2">
          <ShieldCheck size={19} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Chain of Trust
          </div>
          <div className="truncate text-lg font-semibold tracking-[-0.015em] text-fg-1">
            {starter.title}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
        >
          <X size={16} strokeWidth={1.9} aria-hidden />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <div
          className="rounded-2xl border p-4"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}
        >
          <p className="text-[13px] font-semibold text-fg-1">Put your work on the record</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">
            Truth · Concept · Execution · Work. Stack evidence on each layer, let Earn pre-validate
            it, and require human sign-off before the chain advances — so every claim compounds into
            proof a counterparty can&rsquo;t argue with. Members in your org can read it; owners and
            admins approve.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {TRUST_LAYERS.map((meta, i) => (
            <div
              key={meta.layer}
              className="flex min-w-[140px] flex-1 flex-col gap-2 rounded-2xl border bg-surface-1 p-3"
              style={{ borderColor: meta.line }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ background: meta.soft, color: meta.color }}
                >
                  <meta.icon size={14} strokeWidth={1.9} aria-hidden />
                </span>
                <span className="font-mono text-[10px] tabular-nums text-fg-5">0{i + 1}</span>
              </div>
              <div className="text-[12.5px] font-semibold text-fg-1">{meta.name}</div>
              <div className="text-[10.5px] leading-snug text-fg-4">{meta.desc}</div>
            </div>
          ))}
        </div>

        <Button
          variant="primary"
          size="md"
          icon={ShieldCheck}
          iconRight={ChevronRight}
          onClick={start}
          disabled={pending}
          data-testid="trust-start-chain"
          className="w-full justify-center"
        >
          {pending ? 'Starting…' : 'Start Chain of Trust'}
        </Button>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2.5 py-1.5 text-[11.5px] text-danger"
          >
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

/* ============================================================
 * LEGACY PRESENTATIONAL MODE (TrustToaster fallback)
 * ============================================================ */

function LegacyView({ subject, onClose }: { subject: TrustDrawerSubject; onClose: () => void }) {
  return (
    <>
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-fg-2">
          <ShieldCheck size={19} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Chain of Trust
          </div>
          <div className="flex items-center gap-2">
            <span className="truncate text-lg font-semibold tracking-[-0.015em] text-fg-1">
              {subject.entity}
            </span>
            <Badge tone="success" className="px-2 py-0.5 text-[10.5px]">
              {subject.stage}
            </Badge>
          </div>
        </div>
        <div className="flex flex-none flex-col items-end">
          <span className="text-xl font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
            {subject.pct}%
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-success">
            Verified
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
        >
          <X size={16} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <p className="text-[12px] text-fg-4">{subject.summary}</p>
        <div className="flex gap-1.5">
          {TRUST_LAYERS.map((meta) => (
            <div
              key={meta.layer}
              className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]"
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${meta.pct}%`, background: meta.color }}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2.5">
          {TRUST_LAYERS.map((meta, i) => {
            const { Icon: StateIcon, spin } = layerStateIcon(meta.pct, 'pending');
            return (
              <div
                key={meta.layer}
                className="relative flex min-w-[150px] flex-1 flex-col gap-2 rounded-2xl border bg-surface-1 p-3.5"
                style={{ borderColor: meta.line }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl"
                    style={{ background: meta.soft, color: meta.color }}
                  >
                    <meta.icon size={16} strokeWidth={1.9} aria-hidden />
                  </span>
                  <span className="font-mono text-[10.5px] tabular-nums text-fg-5">0{i + 1}</span>
                </div>
                <div className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg-1">
                  {meta.name}
                </div>
                <div className="text-[11px] leading-snug text-fg-4">{meta.desc}</div>
                <div className="mt-1 flex items-center justify-between">
                  <span
                    className="text-[17px] font-semibold tabular-nums tracking-[-0.01em]"
                    style={{ color: meta.color }}
                  >
                    {meta.pct}%
                  </span>
                  <StateIcon
                    size={15}
                    strokeWidth={1.9}
                    className={cn('text-fg-4', spin && 'animate-spin')}
                    style={meta.pct >= 100 ? { color: meta.color } : undefined}
                    aria-hidden
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="rounded-xl border border-dashed border-hairline bg-surface-1 p-4 text-[11.5px] text-fg-4">
          Open this trust toast from a specific deal, profile, or objective to manage evidence and
          approvals.
        </p>
      </div>
    </>
  );
}

/* ============================================================
 * TOP-LEVEL DRAWER SHELL
 * ============================================================ */

/**
 * TrustDrawer — right slide-over for a Chain of Trust.
 *
 * Three render modes, in priority order:
 *   1. `recordId` set → live DB-driven view (load + show layers, evidence,
 *      uploads, approvals, activity).
 *   2. `starterContext` set → starter CTA that creates the record on demand.
 *   3. `subject` set (legacy) → presentational summary, used by TrustToaster
 *      until those toasts gain real record ids.
 */
export function TrustDrawer({
  open,
  onClose,
  recordId,
  starterContext,
  subject
}: TrustDrawerProps) {
  const [loaded, setLoaded] = useState<{ id: string; record: TrustRecord } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // local override so the starter view can swap to db-driven view once a
  // record is created without forcing the parent to update its props.
  // Tracked alongside its source starter key so a new starter context
  // automatically discards a stale created id by derivation (no effect).
  const [created, setCreated] = useState<{ starterKey: string; id: string } | null>(null);

  const starterKey = starterContext
    ? `${starterContext.subjectEntityType}:${starterContext.subjectEntityId}`
    : null;
  const createdRecordId =
    created && starterKey && created.starterKey === starterKey ? created.id : null;

  const effectiveRecordId = createdRecordId ?? recordId ?? null;
  // Derived: only show the cached record when it matches the active id —
  // avoids resetting state inside an effect on id change.
  const record =
    loaded && effectiveRecordId && loaded.id === effectiveRecordId ? loaded.record : null;

  const refresh = useCallback(async () => {
    if (!effectiveRecordId) return;
    setLoading(true);
    setLoadError(null);
    const r: LoadTrustResult = await loadTrustRecord(effectiveRecordId);
    if (r.ok) setLoaded({ id: effectiveRecordId, record: r.record });
    else setLoadError(r.error);
    setLoading(false);
  }, [effectiveRecordId]);
  // Hold the latest refresh in a ref so the load effect can call it without
  // synchronously invoking setState in the effect body (which trips the
  // react-hooks/set-state-in-effect rule). The ref is updated in an effect
  // so we never mutate it during render.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Load whenever the drawer opens with a record id, or the id changes.
  useEffect(() => {
    if (!open) return;
    if (!effectiveRecordId) return;
    void refreshRef.current();
  }, [open, effectiveRecordId]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const mode: 'db' | 'starter' | 'legacy' = effectiveRecordId
    ? 'db'
    : starterContext
      ? 'starter'
      : 'legacy';

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[70] bg-black/50 backdrop-blur-[1px] transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Chain of Trust detail"
        data-testid="trust-drawer"
        aria-hidden={!open}
        className={cn(
          'fixed right-0 top-0 z-[80] flex h-full w-full max-w-[640px] flex-col border-l border-hairline bg-bg-1 shadow-[var(--shadow-lg)] transition-transform duration-300 ease-[cubic-bezier(.22,.61,.36,1)] will-change-transform',
          open ? 'translate-x-0' : 'pointer-events-none invisible translate-x-full'
        )}
      >
        {mode === 'db' && effectiveRecordId && record ? (
          <DbRecordView record={record} onClose={onClose} onRefresh={refresh} />
        ) : mode === 'db' && loading ? (
          <DrawerSkeleton onClose={onClose} />
        ) : mode === 'db' && loadError ? (
          <DrawerError onClose={onClose} error={loadError} />
        ) : mode === 'starter' && starterContext ? (
          <StarterView
            starter={starterContext}
            onClose={onClose}
            onStarted={(id) => setCreated(starterKey ? { starterKey, id } : null)}
          />
        ) : (
          <LegacyView subject={subject ?? DEFAULT_SUBJECT} onClose={onClose} />
        )}
      </aside>
    </>
  );
}

function DrawerSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <div className="h-10 w-10 flex-none animate-pulse rounded-xl bg-surface-2" />
        <div className="min-w-0 flex-1">
          <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
          <div className="mt-2 h-5 w-48 animate-pulse rounded bg-surface-2" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
        >
          <X size={16} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div className="h-1 w-full animate-pulse rounded bg-surface-2" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
        <div className="h-32 animate-pulse rounded-2xl bg-surface-2" />
        <div className="h-32 animate-pulse rounded-2xl bg-surface-2" />
      </div>
    </>
  );
}

function DrawerError({ onClose, error }: { onClose: () => void; error: string }) {
  return (
    <>
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-warning">
          <ShieldCheck size={19} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-warning">
            Chain of Trust · error
          </div>
          <div className="truncate text-lg font-semibold tracking-[-0.015em] text-fg-1">
            Could not load record
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
        >
          <X size={16} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <p className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2.5 py-1.5 text-[12px] text-danger">
          {error}
        </p>
      </div>
    </>
  );
}
