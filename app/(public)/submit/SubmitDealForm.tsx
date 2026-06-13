'use client';

import { useActionState, useRef } from 'react';
import { submitDeal, type SubmissionResult } from '@/lib/public/actions';

const STAGES = [
  { value: 'pre-seed', label: 'Pre-seed' },
  { value: 'seed', label: 'Seed' },
  { value: 'series-a', label: 'Series A' },
  { value: 'series-b+', label: 'Series B+' }
];

const initial: SubmissionResult | null = null;

export function SubmitDealForm() {
  const [result, action, pending] = useActionState(
    async (_prev: SubmissionResult | null, formData: FormData) => submitDeal(formData),
    initial
  );
  const formRef = useRef<HTMLFormElement>(null);

  if (result?.ok) {
    return (
      <div className="rounded-2xl border border-[rgba(52,211,153,0.25)] bg-[rgba(52,211,153,0.07)] p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(52,211,153,0.15)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-6 w-6 text-[#34d399]"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-white">Submission received</h2>
        <p className="mt-1.5 text-sm text-[#94a3b8]">
          A GP will review your raise and follow up via email within 5 business days.
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      {result && !result.ok && (
        <div className="rounded-xl border border-[rgba(251,113,133,0.25)] bg-[rgba(251,113,133,0.08)] px-4 py-3 text-sm text-[#fb7185]">
          {result.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Company name *" name="company_name" placeholder="Acme Inc." />
        <Field label="Website" name="website" type="url" placeholder="https://acme.io" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[12.5px] font-medium text-[#94a3b8]">Stage *</label>
          <select
            name="stage"
            required
            defaultValue=""
            className="w-full rounded-xl border border-white/[0.085] bg-white/[0.055] px-3 py-2.5 text-sm text-[#cbd5e1] outline-none focus:border-[rgba(37,99,235,0.4)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]"
          >
            <option value="" disabled className="bg-[#0d1424]">
              Select stage
            </option>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value} className="bg-[#0d1424]">
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <Field label="Raise amount (USD)" name="raise_amount" type="number" placeholder="1000000" />
      </div>

      <Field label="Deck URL" name="deck_url" type="url" placeholder="https://docsend.com/..." />

      <div className="flex flex-col gap-1.5">
        <label className="text-[12.5px] font-medium text-[#94a3b8]">
          What does your company do? <span className="text-[#7a899e]">(max 1000 chars)</span>
        </label>
        <textarea
          name="description"
          maxLength={1000}
          rows={4}
          placeholder="One paragraph pitch — problem, solution, traction, why now."
          className="w-full resize-none rounded-xl border border-white/[0.085] bg-white/[0.055] px-3 py-2.5 text-sm text-[#cbd5e1] placeholder:text-[#7a899e] outline-none focus:border-[rgba(37,99,235,0.4)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Founder name *" name="founder_name" placeholder="Jane Smith" />
        <Field
          label="Founder email *"
          name="founder_email"
          type="email"
          placeholder="jane@acme.io"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Submitting…' : 'Submit raise'}
      </button>

      <p className="text-center text-[11.5px] text-[#7a899e]">
        By submitting you agree to our{' '}
        <a href="/terms" className="underline hover:text-[#94a3b8]">
          Terms
        </a>{' '}
        and{' '}
        <a href="/privacy" className="underline hover:text-[#94a3b8]">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  required
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12.5px] font-medium text-[#94a3b8]">{label}</label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required ?? label.endsWith('*')}
        className="w-full rounded-xl border border-white/[0.085] bg-white/[0.055] px-3 py-2.5 text-sm text-[#cbd5e1] placeholder:text-[#7a899e] outline-none focus:border-[rgba(37,99,235,0.4)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]"
      />
    </div>
  );
}
