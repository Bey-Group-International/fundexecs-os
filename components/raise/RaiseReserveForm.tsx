'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { submitRaiseReservation } from '@/lib/actions/raise-reservation';

/* RaiseReserveForm — opt-in reservation form on a 506(c) public raise page.
 *
 * When the owner has enabled accept_reservations=true the page renders this form
 * alongside (or instead of) the "express interest" form. On success either:
 *   - redirects the browser to the Stripe Checkout URL (Stripe configured), or
 *   - swaps to a calm "intent recorded" confirmation (Stripe unconfigured / degraded).
 *
 * The accredited-investor attestation is always required here (506(c)-only). */

export function RaiseReserveForm({ token, minCheck }: { token: string; minCheck: number | null }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [accredited, setAccredited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intentOnly, setIntentOnly] = useState(false);
  const [pending, startTransition] = useTransition();

  if (intentOnly) {
    return (
      <div className="rounded-2xl border border-success-line bg-success-soft p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 text-success" size={26} strokeWidth={2} aria-hidden />
        <h3 className="text-[15px] font-semibold text-fg-1">Reservation recorded</h3>
        <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-fg-3">
          Your reservation intent has been recorded and the team has been notified. They will follow
          up with next steps directly. This is not a binding investment commitment.
        </p>
      </div>
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await submitRaiseReservation({
          token,
          name,
          email,
          amount: Number(amount.replace(/[^0-9.]/g, '')) || 0,
          note,
          accredited
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (res.url) {
          // Redirect to Stripe Checkout.
          window.location.href = res.url;
        } else {
          // Stripe not configured — show intent confirmation.
          setIntentOnly(true);
        }
      } catch {
        setError('Could not submit your reservation. Please try again.');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={120}
            className={inputCls}
            placeholder="Jane Investor"
          />
        </Field>
        <Field label="Email" required>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            maxLength={254}
            className={inputCls}
            placeholder="jane@firm.com"
          />
        </Field>
      </div>

      <Field
        label="Reservation amount"
        hint={minCheck ? `Min. ${formatMoney(minCheck)}` : 'Required'}
        required
      >
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-4">
            $
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            maxLength={16}
            className={`${inputCls} pl-7`}
            placeholder="100,000"
          />
        </div>
      </Field>

      <Field label="Note" hint="Optional">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          className={`${inputCls} resize-none`}
          placeholder="Any questions or context for the team."
        />
      </Field>

      {/* Accreditation attestation — always required on the reserve path */}
      <label className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
        <input
          type="checkbox"
          checked={accredited}
          onChange={(e) => setAccredited(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          aria-required="true"
        />
        <span className="text-[12.5px] text-fg-2">
          I am an accredited investor as defined under SEC Rule 501(a). I understand this raise is
          limited to accredited investors under Reg D 506(c).
        </span>
      </label>

      <div className="flex items-start gap-1.5 rounded-xl border border-azure-line bg-azure-soft px-3 py-2.5">
        <Info size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-azure-1" aria-hidden />
        <p className="text-[12px] text-fg-3">
          Submitting a reservation is not a binding investment commitment. Payment will be collected
          via Stripe Checkout; you may cancel any time before closing.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !accredited}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[var(--shadow-md)] transition hover:bg-accent-2 disabled:opacity-60"
      >
        {pending ? 'Processing…' : 'Reserve my spot'}
        {!pending ? <ArrowRight size={15} strokeWidth={2.2} aria-hidden /> : null}
      </button>
      <p className="text-center text-[11px] text-fg-4">
        Reserving is not a commitment to invest. You may withdraw at any time.
      </p>
    </form>
  );
}

const inputCls =
  'w-full rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[13.5px] text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-accent-line focus:bg-surface-2';

function Field({
  label,
  hint,
  required,
  children
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[11.5px] font-medium text-fg-2">
        <span>
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </span>
        {hint ? <span className="font-normal text-fg-4">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}
