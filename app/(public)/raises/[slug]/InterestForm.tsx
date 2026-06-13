'use client';

import { useActionState } from 'react';
import { expressInterest, type InterestResult } from '@/lib/public/actions';

const initial: InterestResult | null = null;

export function InterestForm({ dealId }: { dealId: string }) {
  const [result, action, pending] = useActionState(
    async (_prev: InterestResult | null, formData: FormData) => {
      formData.set('deal_id', dealId);
      return expressInterest(formData);
    },
    initial
  );

  if (result?.ok) {
    return (
      <div className="rounded-2xl border border-[rgba(52,211,153,0.25)] bg-[rgba(52,211,153,0.07)] p-6 text-center">
        <p className="text-sm font-medium text-[#34d399]">Interest noted!</p>
        <p className="mt-1 text-xs text-[#94a3b8]">
          The GP team will be in touch if there&apos;s a fit.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {result && !result.ok && (
        <div className="rounded-xl border border-[rgba(251,113,133,0.25)] bg-[rgba(251,113,133,0.08)] px-4 py-3 text-sm text-[#fb7185]">
          {result.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <InlineField label="Your name *" name="name" id="interest-name" placeholder="Alex Chen" />
        <InlineField
          label="Email *"
          name="email"
          id="interest-email"
          type="email"
          placeholder="alex@fund.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="interest-note" className="text-[12.5px] font-medium text-[#94a3b8]">
          Note (optional)
        </label>
        <textarea
          id="interest-note"
          name="note"
          maxLength={500}
          rows={3}
          placeholder="Brief note to the GP team — check size, timeline, etc."
          className="w-full resize-none rounded-xl border border-white/[0.085] bg-white/[0.055] px-3 py-2.5 text-sm text-[#cbd5e1] placeholder:text-[#7a899e] outline-none focus:border-[rgba(37,99,235,0.4)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-[linear-gradient(135deg,#F7C948,#E5A823)] py-3 text-sm font-semibold text-[#070b14] shadow-[0_8px_20px_-8px_rgba(247,201,72,0.45)] transition hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Submitting…' : 'Express interest'}
      </button>
    </form>
  );
}

function InlineField({
  label,
  name,
  id,
  type = 'text',
  placeholder
}: {
  label: string;
  name: string;
  id: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-[#94a3b8]">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        required={label.endsWith('*')}
        className="w-full rounded-xl border border-white/[0.085] bg-white/[0.055] px-3 py-2.5 text-sm text-[#cbd5e1] placeholder:text-[#7a899e] outline-none focus:border-[rgba(37,99,235,0.4)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]"
      />
    </div>
  );
}
