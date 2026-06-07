'use client';

import { useState, useTransition } from 'react';
import {
  Inbox,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Clock,
  Sparkles,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import { act_on_match, type MatchAction, type ActOnMatchResult } from '@/lib/actions/matches';
import type { MatchInboxData, MatchItem } from '@/lib/queries/match-inbox';

/* ---- Helpers ------------------------------------------------------------ */

function scoreTone(score: number): BadgeTone {
  if (score >= 80) return 'success';
  if (score >= 60) return 'azure';
  if (score >= 40) return 'warning';
  return 'neutral';
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function getRationale(rationale: Record<string, unknown>): {
  summary: string | null;
  reasons: string[];
} {
  return {
    summary:
      typeof rationale.summary === 'string'
        ? rationale.summary
        : typeof rationale.text === 'string'
          ? rationale.text
          : null,
    reasons: Array.isArray(rationale.reasons)
      ? (rationale.reasons as string[]).filter((r) => typeof r === 'string')
      : []
  };
}

/* ---- Match card --------------------------------------------------------- */

function MatchCard({
  match,
  onAct
}: {
  match: MatchItem;
  onAct: (id: string, action: MatchAction) => Promise<ActOnMatchResult>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState<MatchAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { summary, reasons } = getRationale(match.rationale);
  const hasDetail = Boolean(summary) || reasons.length > 0;

  function handleAct(action: MatchAction) {
    setOptimisticStatus(action);
    setError(null);
    startTransition(async () => {
      const result = await onAct(match.id, action);
      if (!result.ok) {
        setOptimisticStatus(null);
        setError(result.error ?? 'Action failed. Please try again.');
      }
    });
  }

  const isActioned = optimisticStatus !== null;

  return (
    <Card className={cn('transition-opacity', isActioned && 'opacity-50')}>
      <div className="flex items-start gap-3">
        {/* Score badge */}
        <div className="flex flex-none flex-col items-center gap-1">
          <span
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-bold tabular-nums',
              match.score >= 80 &&
                'border border-[var(--success-line)] bg-[var(--success-soft)] text-success',
              match.score >= 60 &&
                match.score < 80 &&
                'border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1',
              match.score < 60 && 'border border-hairline bg-surface-1 text-fg-3'
            )}
          >
            {match.score}
          </span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={scoreTone(match.score)} className="text-[10px]">
              {humanize(match.kind)}
            </Badge>
            <span className="text-[11px] text-fg-5">
              <Clock size={11} strokeWidth={1.9} className="mr-0.5 inline" aria-hidden />
              {formatTs(match.createdAt)}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-fg-3 font-mono">{match.subjectId.slice(0, 8)}…</p>
          {summary ? <p className="mt-1 text-[13px] text-fg-2">{summary}</p> : null}

          {error ? <p className="mt-1 text-[12px] text-danger">{error}</p> : null}

          {/* Actions */}
          {!isActioned ? (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAct('accepted')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] px-3 py-1.5 text-[12px] font-medium text-success transition hover:brightness-105 disabled:opacity-50"
              >
                <Check size={13} strokeWidth={2} aria-hidden />
                Accept
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleAct('dismissed')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-1.5 text-[12px] font-medium text-danger transition hover:brightness-105 disabled:opacity-50"
              >
                <X size={13} strokeWidth={2} aria-hidden />
                Dismiss
              </button>
              {hasDetail ? (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-fg-4 transition hover:text-fg-1"
                >
                  {open ? (
                    <ChevronUp size={13} strokeWidth={1.9} aria-hidden />
                  ) : (
                    <ChevronDown size={13} strokeWidth={1.9} aria-hidden />
                  )}
                  {open ? 'Less' : 'Details'}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5 text-[12px]">
              {optimisticStatus === 'accepted' ? (
                <>
                  <CheckCircle2 size={14} className="text-success" aria-hidden />
                  <span className="text-success">Accepted</span>
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-fg-4" aria-hidden />
                  <span className="text-fg-4">Dismissed</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expanded rationale */}
      {open && hasDetail ? (
        <div className="mt-3 border-t border-hairline pt-3">
          {reasons.length > 0 ? (
            <ul className="space-y-1.5">
              {reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] text-fg-3">
                  <Sparkles
                    size={12}
                    strokeWidth={1.9}
                    className="mt-0.5 flex-none text-gold-1"
                    aria-hidden
                  />
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/* ---- Actioned row (compact) --------------------------------------------- */

function ActionedRow({ match }: { match: MatchItem }) {
  const accepted = match.status === 'accepted';
  return (
    <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-0">
      <span
        className={cn(
          'flex h-6 w-6 flex-none items-center justify-center rounded-lg',
          accepted ? 'bg-[var(--success-soft)] text-success' : 'bg-surface-1 text-fg-4'
        )}
      >
        {accepted ? (
          <CheckCircle2 size={13} strokeWidth={1.9} aria-hidden />
        ) : (
          <XCircle size={13} strokeWidth={1.9} aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-[12.5px] text-fg-2">{humanize(match.kind)}</span>
        <span className="ml-2 text-[11px] text-fg-5">{match.subjectId.slice(0, 8)}…</span>
      </div>
      <Badge tone={accepted ? 'success' : 'neutral'} className="text-[10px]">
        {humanize(match.status)}
      </Badge>
      <span className="text-[11px] text-fg-5">
        {match.actedAt ? formatTs(match.actedAt) : formatTs(match.createdAt)}
      </span>
    </div>
  );
}

/* ---- Main view ---------------------------------------------------------- */

export interface MatchInboxViewProps {
  data: MatchInboxData;
}

export function MatchInboxView({ data }: MatchInboxViewProps) {
  const [localPending, setLocalPending] = useState<MatchItem[]>(data.pending);
  const [localActioned, setLocalActioned] = useState<MatchItem[]>(data.actioned);

  async function handleAct(id: string, action: MatchAction) {
    const result = await act_on_match(id, action);
    if (result.ok) {
      setLocalPending((prev) => prev.filter((m) => m.id !== id));
      const match = localPending.find((m) => m.id === id);
      if (match) {
        setLocalActioned((prev) => [
          { ...match, status: action, actedAt: new Date().toISOString() },
          ...prev
        ]);
      }
    }
    return result;
  }

  if (data.empty) {
    return (
      <EmptyState
        icon={Inbox}
        title="No matches yet"
        body="AI-generated matches will appear here for triage once your organization has active deals, connections, or capital providers in the system."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Pending triage */}
      <section aria-label="Pending matches">
        <SectionTitle
          eyebrow="Match Inbox"
          title="Pending Triage"
          action={
            localPending.length > 0 ? (
              <Badge tone="warning" dot pulse className="text-[10.5px]">
                {localPending.length} pending
              </Badge>
            ) : (
              <Badge tone="success" className="text-[10.5px]">
                All clear
              </Badge>
            )
          }
        />
        {localPending.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Inbox zero"
            body="All matches have been triaged. New matches will appear here as they are generated."
          />
        ) : (
          <div className="space-y-3">
            {localPending.map((m) => (
              <MatchCard key={m.id} match={m} onAct={handleAct} />
            ))}
          </div>
        )}
      </section>

      {/* Actioned history */}
      {localActioned.length > 0 ? (
        <section aria-label="Actioned matches">
          <SectionTitle
            eyebrow="Match Inbox"
            title="History"
            action={
              <Badge tone="neutral" className="text-[10.5px]">
                {localActioned.length}
              </Badge>
            }
          />
          <Card className="overflow-hidden p-0">
            {localActioned.slice(0, 20).map((m) => (
              <ActionedRow key={m.id} match={m} />
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}
