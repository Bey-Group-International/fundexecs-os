'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Gift, Loader2 } from 'lucide-react';
import { redeemGift } from '@/lib/actions/gift';

/** Signed-in redeem control: claims the gift into the active workspace. */
export function RedeemPanel({ code, credits }: { code: string; credits: number }) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function redeem() {
    setState('working');
    setError(null);
    try {
      const res = await redeemGift(code);
      if (res.ok) {
        setBalance(res.balance);
        setState('done');
      } else {
        setError(res.error);
        setState('error');
      }
    } catch {
      setError('Could not redeem the gift. Please try again.');
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="rounded-2xl border border-[var(--success-line)] bg-[var(--success-soft)] p-5">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-success">
          <Check size={17} strokeWidth={2.2} aria-hidden />
          {credits.toLocaleString()} credits added
        </p>
        {balance != null ? (
          <p className="mt-1 text-[12.5px] text-fg-3">
            Your wallet balance is now{' '}
            <span className="font-semibold text-fg-1">{balance.toLocaleString()}</span> credits.
          </p>
        ) : null}
        <Link
          href="/command-center"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2 text-[12.5px] font-semibold text-white transition hover:brightness-110"
        >
          Go to your desk
          <ArrowRight size={14} strokeWidth={2} aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={redeem}
        disabled={state === 'working'}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#F7C948,#E5A823)] px-5 py-2.5 text-[13px] font-semibold text-[#070b14] transition hover:brightness-110 disabled:opacity-60"
      >
        {state === 'working' ? (
          <Loader2 size={15} strokeWidth={2.2} className="animate-spin" aria-hidden />
        ) : (
          <Gift size={15} strokeWidth={2} aria-hidden />
        )}
        {state === 'working' ? 'Redeeming…' : `Redeem ${credits.toLocaleString()} credits`}
      </button>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default RedeemPanel;
