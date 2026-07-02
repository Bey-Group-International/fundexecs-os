"use client";

import { useRef, useState, useTransition } from "react";
import { redeemCouponAction } from "./actions";
import { formatCredits } from "@/lib/billing";

export function CouponRedemption() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await redeemCouponAction(formData);
      if (result.ok) {
        setMessage({
          ok: true,
          text: `${formatCredits(result.credits ?? 0)} credits added to your wallet.`,
        });
        formRef.current?.reset();
      } else {
        setMessage({ ok: false, text: result.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <div className="rounded-2xl border border-neural-400/20 bg-black/45 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
        Redeem coupon
      </p>
      <p className="mt-1 text-xs text-fg-secondary">
        Have a promo code? Enter it below to add credits to your wallet.
      </p>
      <form ref={formRef} onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          name="code"
          type="text"
          placeholder="Enter code"
          autoComplete="off"
          spellCheck={false}
          className="h-9 flex-1 rounded-lg border border-neural-400/30 bg-surface-2/40 px-3 font-mono text-sm uppercase tracking-wider text-fg-primary placeholder:normal-case placeholder:tracking-normal placeholder:text-fg-muted focus:border-neural-400/60 focus:outline-none"
          disabled={isPending}
        />
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg border border-neural-400/40 bg-neural-400/10 px-4 font-mono text-xs uppercase tracking-[0.18em] text-neural-300 transition hover:bg-neural-400/20 disabled:opacity-50"
        >
          {isPending ? "…" : "Apply"}
        </button>
      </form>
      {message && (
        <p
          className={`mt-3 text-xs ${message.ok ? "text-emerald-400" : "text-rose-400"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
