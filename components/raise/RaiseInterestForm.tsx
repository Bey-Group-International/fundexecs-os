'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { submitRaiseInterest } from '@/lib/actions/raise-interest';

/* RaiseInterestForm — the "express interest" capture on the public raise page.
 * Lead-gen only (no payment). On success it swaps to a calm confirmation so the
 * prospect knows the owner will follow up. Token comes from the page route. */

export function RaiseInterestForm({
  token,
  minCheck,
  gated = false
}: {
  token: string;
  minCheck: number | null;
  /** 506(b) private placement: frame the form as "request access". */
  gated?: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="rounded-2xl border border-success-line bg-success-soft p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 text-success" size={26} strokeWidth={2} aria-hidden />
        <h3 className="text-[15px] font-semibold text-fg-1">
          {gated ? 'Access requested' : 'Interest registered'}
        </h3>
        <p className="mx-auto mt-1 max-w-[42ch] text-[13px] text-fg-3">
          Thanks — the team has been notified and will reach out to you directly. No commitment is
          made by submitting this.
        </p>
      </div>
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await submitRaiseInterest({
          token,
          name,
          email,
          amount: amount ? Number(amount.replace(/[^0-9.]/g, '')) : null,
          note
        });
        if (res.ok) setDone(true);
        else setError(res.error);
      } catch {
        setError('Could not submit your interest. Please try again.');
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
        label="Indicative amount"
        hint={minCheck ? `Minimum check ${formatMoney(minCheck)}` : 'Optional'}
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
            placeholder="50,000"
          />
        </div>
      </Field>

      <Field label="Note" hint="Optional">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={1000}
          className={`${inputCls} resize-none`}
          placeholder="A line on why you're interested or how to reach you."
        />
      </Field>

      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[var(--shadow-md)] transition hover:bg-accent-2 disabled:opacity-60"
      >
        {pending ? 'Sending…' : gated ? 'Request access' : 'Express interest'}
        {!pending ? <ArrowRight size={15} strokeWidth={2.2} aria-hidden /> : null}
      </button>
      <p className="text-center text-[11px] text-fg-4">
        {gated
          ? 'Requesting access is not a commitment to invest.'
          : 'Expressing interest is not a commitment to invest.'}
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
