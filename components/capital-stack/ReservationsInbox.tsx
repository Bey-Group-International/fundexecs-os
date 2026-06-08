'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, ShieldCheck, Mail } from 'lucide-react';
import { Card, Badge, SectionTitle, type BadgeTone } from '@/components/ui';
import { setReservationVerification } from '@/lib/actions/raise-verification';
import type { RaiseLeadsData, RaiseLead, VerificationStatus } from '@/lib/queries/raise-leads';

/* ReservationsInbox — owner/admin review of inbound raise leads & reservations,
 * including accredited-investor verification for 506(c) reservations. Verify /
 * reject decisions run through setReservationVerification (RLS owner/admin). */

const METHOD_LABEL: Record<string, string> = {
  income: 'Income',
  net_worth: 'Net worth',
  professional_license: 'Licensed professional',
  third_party_letter: 'Third-party letter',
  other: 'Other'
};

const V_TONE: Record<VerificationStatus, BadgeTone> = {
  unverified: 'neutral',
  pending: 'warning',
  verified: 'success',
  rejected: 'danger'
};

function money(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(n);
}

export function ReservationsInbox({ data }: { data: RaiseLeadsData }) {
  const { leads, counts } = data;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total leads" value={counts.total} />
        <Stat label="Reservations" value={counts.reserved} />
        <Stat label="Pending review" value={counts.pendingVerification} tone="warning" />
        <Stat label="Verified" value={counts.verified} tone="success" />
      </div>

      <Card className="p-5">
        <SectionTitle eyebrow="Capital · reservations" title="Leads & accreditation review" />
        {leads.length === 0 ? (
          <p className="mt-3 text-[13px] text-fg-3">
            No inbound leads yet. Share your public raise page and reservations will land here for
            review.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {leads.map((lead) => (
              <LeadRow key={lead.id} lead={lead} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function LeadRow({ lead }: { lead: RaiseLead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isReserved = lead.kind === 'reserved';
  const amount = lead.reservationAmount ?? lead.indicativeAmount;
  const canReview = isReserved && lead.verificationStatus !== 'verified';

  function decide(decision: 'verified' | 'rejected') {
    setError(null);
    startTransition(async () => {
      const res = await setReservationVerification(lead.id, decision, note || null);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <li className="rounded-xl border border-hairline bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-fg-1">{lead.name}</span>
            <Badge tone={isReserved ? 'azure' : 'neutral'}>
              {isReserved ? 'Reserved' : 'Interest'}
            </Badge>
            {isReserved ? (
              <Badge tone={V_TONE[lead.verificationStatus]}>
                {lead.verificationStatus === 'unverified'
                  ? 'Self-attested'
                  : `Verification ${lead.verificationStatus}`}
              </Badge>
            ) : null}
          </div>
          <a
            href={`mailto:${lead.email}`}
            className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-azure-1 hover:underline"
          >
            <Mail size={12} strokeWidth={2} aria-hidden />
            {lead.email}
          </a>
          {lead.note ? <p className="mt-1.5 text-[12.5px] text-fg-3">{lead.note}</p> : null}
        </div>
        {amount != null ? (
          <span className="shrink-0 text-[14px] font-semibold text-fg-1">{money(amount)}</span>
        ) : null}
      </div>

      {isReserved ? (
        <div className="mt-3 grid gap-1.5 rounded-lg border border-hairline bg-bg-2 px-3 py-2.5 text-[12px] text-fg-3">
          <Row k="Payment" v={lead.reservationStatus} />
          <Row
            k="Method"
            v={
              lead.verificationMethod
                ? (METHOD_LABEL[lead.verificationMethod] ?? lead.verificationMethod)
                : '—'
            }
          />
          {lead.verificationEvidence ? <Row k="Evidence" v={lead.verificationEvidence} /> : null}
          {lead.reviewerNote ? <Row k="Reviewer note" v={lead.reviewerNote} /> : null}
        </div>
      ) : null}

      {canReview ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Reviewer note (optional)"
            className="w-full rounded-lg border border-hairline bg-surface-1 px-3 py-1.5 text-[12.5px] text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-accent-line"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => decide('verified')}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-1.5 text-[12px] font-semibold text-success transition hover:brightness-110 disabled:opacity-60"
            >
              <ShieldCheck size={13} strokeWidth={2.2} aria-hidden />
              Mark verified
            </button>
            <button
              type="button"
              onClick={() => decide('rejected')}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-[12px] font-medium text-fg-3 transition hover:border-danger-line hover:text-danger disabled:opacity-60"
            >
              <X size={13} strokeWidth={2.2} aria-hidden />
              Reject
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : isReserved && lead.verificationStatus === 'verified' ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-success">
          <Check size={13} strokeWidth={2.4} aria-hidden />
          Accreditation verified
        </p>
      ) : null}
    </li>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex gap-2">
      <span className="w-24 shrink-0 text-fg-4">{k}</span>
      <span className="min-w-0 break-words text-fg-2">{v}</span>
    </p>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: BadgeTone }) {
  const text =
    tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-fg-1';
  return (
    <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tracking-[-0.01em] ${text}`}>{value}</p>
    </div>
  );
}
