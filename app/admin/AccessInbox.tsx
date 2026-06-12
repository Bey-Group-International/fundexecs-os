'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, RotateCcw, X } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { MEMBER_TYPE_LABELS } from '@/lib/member-types';
import { setMemberAccess, type AccessDecision } from '@/lib/actions/member-access';
import type { AccessApplicant, AccessStatus } from '@/lib/queries/admin-access';

const STATUS_TONE: Record<AccessStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'neutral'
};
const STATUS_LABEL: Record<AccessStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Declined'
};

/** A filter over the worklist. */
type Filter = 'pending' | 'approved' | 'rejected' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Declined' },
  { id: 'all', label: 'All' }
];

/**
 * The Applications inbox. Renders the platform-wide list of beta applicants and
 * lets a platform admin approve / decline / reset each one. Decisions call the
 * `setMemberAccess` server action (itself platform-admin gated), update the row
 * optimistically, then `router.refresh()` to re-pull the canonical order.
 */
export function AccessInbox({ applicants }: { applicants: AccessApplicant[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Local override of each row's status for optimistic feedback before refresh.
  const [overrides, setOverrides] = useState<Record<string, AccessStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const statusOf = (a: AccessApplicant): AccessStatus => overrides[a.userId] ?? a.access;

  function decide(userId: string, decision: AccessDecision) {
    setError(null);
    setBusyId(userId);
    const previous = overrides[userId];
    // Optimistic: reflect the decision immediately ('pending' clears any override).
    setOverrides((o) => ({ ...o, [userId]: decision }));
    startTransition(async () => {
      const result = await setMemberAccess(userId, decision);
      setBusyId(null);
      if (!result.ok) {
        setError(result.error);
        // Roll back the optimistic flip.
        setOverrides((o) => ({ ...o, [userId]: previous ?? statusFromServer(userId) }));
        return;
      }
      router.refresh();
    });
  }

  // Resolve the server-truth status for rollback when there was no prior override.
  function statusFromServer(userId: string): AccessStatus {
    return applicants.find((a) => a.userId === userId)?.access ?? 'pending';
  }

  const counts = applicants.reduce(
    (acc, a) => {
      acc[statusOf(a)] += 1;
      return acc;
    },
    { pending: 0, approved: 0, rejected: 0 } as Record<AccessStatus, number>
  );

  const visible = applicants.filter((a) => filter === 'all' || statusOf(a) === filter);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const count = f.id === 'all' ? applicants.length : counts[f.id as AccessStatus];
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={
                active
                  ? 'rounded-xl border border-azure-1 bg-[var(--azure-soft)] px-3 py-1.5 text-[12.5px] font-medium text-azure-1'
                  : 'rounded-xl border border-hairline bg-surface-1 px-3 py-1.5 text-[12.5px] text-fg-3 transition hover:bg-surface-2 hover:text-fg-1'
              }
              aria-pressed={active}
            >
              {f.label} <span className="text-fg-5">· {count}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-bg-1 px-6 py-12 text-center text-[13px] text-fg-4">
          {filter === 'pending'
            ? 'No applications waiting on a decision. You’re all caught up.'
            : 'Nothing here yet.'}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((a) => {
            const status = statusOf(a);
            const rowBusy = busyId === a.userId && pending;
            return (
              <li
                key={a.userId}
                className="rounded-2xl border border-hairline bg-bg-1 p-4 shadow-[var(--shadow-sm)] sm:flex sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-fg-1">
                      {a.name || a.email || 'Unnamed applicant'}
                    </span>
                    <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    {!a.onboardingComplete && <Badge tone="info">Brief in progress</Badge>}
                  </div>
                  <p className="mt-1 truncate text-[12.5px] text-fg-3">
                    {[a.email, a.company, a.memberType ? MEMBER_TYPE_LABELS[a.memberType] : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                  {(a.mandate || a.goal) && (
                    <p className="mt-1 truncate text-[12px] text-fg-4">
                      {a.mandate}
                      {a.mandate && a.goal ? ' — ' : ''}
                      {a.goal ? `“${a.goal}”` : ''}
                    </p>
                  )}
                </div>

                <div className="mt-3 flex shrink-0 items-center gap-2 sm:mt-0">
                  {status !== 'approved' && (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={Check}
                      disabled={rowBusy}
                      onClick={() => decide(a.userId, 'approved')}
                    >
                      Approve
                    </Button>
                  )}
                  {status !== 'rejected' && (
                    <Button
                      variant="danger"
                      size="sm"
                      icon={X}
                      disabled={rowBusy}
                      onClick={() => decide(a.userId, 'rejected')}
                    >
                      Decline
                    </Button>
                  )}
                  {status !== 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={RotateCcw}
                      disabled={rowBusy}
                      onClick={() => decide(a.userId, 'pending')}
                      aria-label="Reset to pending"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
