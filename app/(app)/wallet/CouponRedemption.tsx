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
    <div className="flex flex-col gap-4 rounded-2xl border border-line/60 bg-surface-1/30 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-fg-muted">
          Redeem a code
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          Have a promo or partner code? Apply it to credit your wallet instantly.
        </p>
        {message && (
          <p
            className={`mt-2 font-mono text-[11px] ${message.ok ? "text-emerald-400" : "text-rose-400"}`}
          >
            {message.text}
          </p>
        )}
      </div>
      <form ref={formRef} onSubmit={handleSubmit} className="flex shrink-0 gap-2 sm:w-80">
        <input
          name="code"
          type="text"
          placeholder="Enter code"
          autoComplete="off"
          spellCheck={false}
          className="h-9 flex-1 rounded-lg border border-line/70 bg-surface-2/40 px-3 font-mono text-sm uppercase tracking-wider text-fg-primary placeholder:normal-case placeholder:tracking-normal placeholder:text-fg-muted focus:border-gold-400/60 focus:outline-none"
          disabled={isPending}
        />
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg border border-gold-400/40 bg-gold-400/10 px-4 font-mono text-xs uppercase tracking-[0.18em] text-gold-300 transition hover:bg-gold-400/20 disabled:opacity-50"
        >
          {isPending ? "…" : "Apply"}
        </button>
      </form>
    </div>
  );
}
