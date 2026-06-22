"use client";

import { useRef, useState, useTransition } from "react";
import { redeemGiftAction, redeemReferralAction } from "./actions";

type Action = (formData: FormData) => Promise<{ error?: string; ok?: boolean }>;

// A single-input redeem form (used for both referral codes and gift tokens).
function RedeemField({
  name,
  placeholder,
  cta,
  action,
  success,
}: {
  name: string;
  placeholder: string;
  cta: string;
  action: Action;
  success: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          setOk(false);
          const res = await action(formData);
          if (res?.error) setError(res.error);
          else {
            formRef.current?.reset();
            setOk(true);
          }
        })
      }
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <input
          name={name}
          required
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 font-mono text-xs uppercase tracking-widest text-fg-primary placeholder:normal-case placeholder:tracking-normal placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-md border border-line px-3 py-2 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary disabled:opacity-60"
        >
          {pending ? "…" : cta}
        </button>
      </div>
      {error ? <p className="text-xs text-status-danger">{error}</p> : null}
      {ok ? <p className="text-xs text-status-success">{success}</p> : null}
    </form>
  );
}

// Two redeem fields: a referral code (one-time per org) and a gift token.
export function RedeemBox() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-sm font-medium text-fg-primary">Have a referral code?</p>
        <RedeemField
          name="code"
          placeholder="Enter referral code"
          cta="Redeem"
          action={redeemReferralAction}
          success="Referral applied — welcome bonus credited to your wallet."
        />
        <p className="mt-1 text-[11px] text-fg-muted">
          Redeemable once per organization. Your referrer (and theirs) earn credits too.
        </p>
      </div>
      <div className="border-t border-line pt-4">
        <p className="mb-1.5 text-sm font-medium text-fg-primary">Received a gift?</p>
        <RedeemField
          name="token"
          placeholder="Enter gift code"
          cta="Redeem"
          action={redeemGiftAction}
          success="Gift redeemed — credits added to your wallet."
        />
      </div>
    </div>
  );
}
