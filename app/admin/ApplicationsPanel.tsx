'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, RotateCcw, Quote, Link2, Inbox, Clock, Ban, Building2 } from 'lucide-react';
import { Avatar, Badge, Button, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { setApplicationReview } from '@/lib/actions/beta-links';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import type { BetaApplication, ApplicationReview } from '@/lib/queries/beta-applications';

const REVIEW_TONE: Record<ApplicationReview, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'neutral'
};

const REVIEW_LABEL: Record<ApplicationReview, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected'
};

type Filter = 'all' | ApplicationReview;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' }
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function memberTypeLabel(t: MemberType | null): string | null {
  return t ? MEMBER_TYPE_LABELS[t] : null;
}

function ApplicationCard({
  app,
  busy,
  onReview
}: {
  app: BetaApplication;
  busy: boolean;
  onReview: (review: ApplicationReview) => void;
}) {
  const typeLabel = memberTypeLabel(app.memberType);
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={app.name || app.email} size={38} tone="azure" className="flex-none" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-fg-1">
                {app.name || 'Unnamed applicant'}
              </span>
              {typeLabel && (
                <Badge tone="azure" className="text-[10px]">
                  {typeLabel}
                </Badge>
              )}
            </div>
            <div className="truncate text-[12px] text-fg-4">{app.email}</div>
            {app.company && (
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-4">
                <Building2 size={12} strokeWidth={1.9} className="flex-none" aria-hidden />
                <span className="truncate">{app.company}</span>
              </div>
            )}
          </div>
        </div>
        <Badge tone={REVIEW_TONE[app.review]} dot className="flex-none text-[10px]">
          {REVIEW_LABEL[app.review]}
        </Badge>
      </div>

      {app.goal && (
        <div className="flex gap-2.5 rounded-xl border border-hairline bg-surface-2 px-3.5 py-3">
          <Quote size={14} strokeWidth={1.9} className="mt-0.5 flex-none text-gold-1" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-fg-2">{app.goal}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline-faint pt-3">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-fg-5">
          <span className="inline-flex items-center gap-1.5">
            <Link2 size={12} strokeWidth={1.9} aria-hidden />
            {app.linkLabel || 'Shareable link'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} strokeWidth={1.9} aria-hidden />
            Joined {relativeTime(app.claimedAt)}
          </span>
          {app.review === 'rejected' && (
            <span className="inline-flex items-center gap-1.5 text-danger">
              <Ban size={12} strokeWidth={1.9} aria-hidden />
              Sign-in suspended
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {app.review === 'pending' ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                disabled={busy}
                onClick={() => {
                  // Reject suspends their sign-in — make it a deliberate choice.
                  if (
                    window.confirm(
                      `Reject ${app.name || app.email}? They’ll be blocked from signing in (any active session ends within the hour) until you restore them.`
                    )
                  ) {
                    onReview('rejected');
                  }
                }}
                aria-label={`Reject ${app.name || app.email}`}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={Check}
                disabled={busy}
                onClick={() => onReview('approved')}
                aria-label={`Approve ${app.name || app.email}`}
              >
                Approve
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              disabled={busy}
              onClick={() => onReview('pending')}
              aria-label={
                app.review === 'rejected'
                  ? `Restore access for ${app.name || app.email}`
                  : `Reset ${app.name || app.email} to pending`
              }
            >
              {app.review === 'rejected' ? 'Restore' : 'Reset'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ApplicationsPanel({ applications }: { applications: BetaApplication[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(claimId: string, next: ApplicationReview) {
    if (busyId) return;
    setBusyId(claimId);
    setError(null);
    try {
      const result = await setApplicationReview(claimId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not update this application. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const counts = {
    pending: applications.filter((a) => a.review === 'pending').length,
    approved: applications.filter((a) => a.review === 'approved').length,
    rejected: applications.filter((a) => a.review === 'rejected').length
  };
  const visible = filter === 'all' ? applications : applications.filter((a) => a.review === filter);

  return (
    <div className="flex flex-col gap-[18px]">
      <Card>
        <SectionTitle
          eyebrow="Private beta"
          title="Applications"
          className="mb-3"
          action={
            <span className="text-[11px] text-fg-5">
              {counts.pending} pending · {counts.approved} approved
            </span>
          }
        />
        <p className="mb-4 max-w-prose text-[12.5px] leading-relaxed text-fg-3">
          Everyone who opened a shareable invite link and finished the welcome flow with Earn.
          Approving keeps them in; rejecting suspends their sign-in until you restore them. Reset
          returns an approved applicant to pending.
        </p>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const n = f.id === 'all' ? applications.length : counts[f.id as ApplicationReview];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition ${
                  active
                    ? 'border-gold-1/60 bg-[var(--gold-soft,var(--surface-2))] text-fg-1'
                    : 'border-hairline bg-surface-1 text-fg-4 hover:text-fg-2'
                }`}
              >
                {f.label}
                <span className="text-[11px] text-fg-5">{n}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </Card>

      {visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Inbox size={26} strokeWidth={1.6} className="text-fg-5" aria-hidden />
          <p className="text-[13px] text-fg-4">
            {applications.length === 0
              ? 'No applications yet. Share a beta link to start collecting them.'
              : `No ${filter} applications.`}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((app) => (
            <ApplicationCard
              key={app.claimId}
              app={app}
              busy={busyId !== null}
              onReview={(next) => review(app.claimId, next)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
