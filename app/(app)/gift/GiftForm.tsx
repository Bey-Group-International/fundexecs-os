"use client";

import { useRef, useState, useTransition } from "react";
import { CREDIT_PACKS, formatCredits, formatUsd } from "@/lib/billing";
import { purchaseGiftAction } from "./actions";

// Buy a credit pack as a gift for a colleague. Mirrors the mandate form's
// inline-validation pattern: a transition runs the server action and we surface
// the error or reset on success. Payment is mocked until a provider is wired.
export function GiftForm({ live = false }: { live?: boolean }) {
  const [packKey, setPackKey] = useState(CREDIT_PACKS[1]?.key ?? CREDIT_PACKS[0].key);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          setDone(false);
          const res = await purchaseGiftAction(formData);
          if (res?.url) {
            window.location.href = res.url; // off to Stripe Checkout
            return;
          }
          if (res?.error) setError(res.error);
          else {
            formRef.current?.reset();
            setDone(true);
            setTimeout(() => setDone(false), 4000);
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {CREDIT_PACKS.map((pack) => {
          const active = pack.key === packKey;
          return (
            <button
              type="button"
              key={pack.key}
              onClick={() => setPackKey(pack.key)}
              aria-pressed={active}
              className={`rounded-xl border p-3 text-left transition ${
                active
                  ? "border-gold-500/60 bg-gold-500/10"
                  : "border-line bg-surface-0 hover:border-line/80 hover:bg-surface-2"
              }`}
            >
              <p className="font-display text-lg font-semibold text-fg-primary">
                {formatCredits(pack.credits)}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                credits · {formatUsd(pack.price)}
              </p>
            </button>
          );
        })}
      </div>
      <input type="hidden" name="pack_key" value={packKey} />

      <input
        name="recipient_email"
        type="email"
        required
        placeholder="Recipient email"
        className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
      />
      <input
        name="message"
        maxLength={140}
        placeholder="Add a note (optional)"
        className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
      />

      <button
        type="submit"
        disabled={pending}
        className="ml-auto rounded-md bg-gold-400 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
      >
        {pending ? "Creating gift…" : "Send gift"}
      </button>

      {error ? <p className="text-xs text-status-danger">{error}</p> : null}
      {done ? (
        <p className="text-xs text-status-success">
          Gift created — copy its redeem code from “Gifts you’ve sent” below and share it.
        </p>
      ) : null}
      <p className="text-[11px] leading-snug text-fg-muted">
        {live
          ? "Secure checkout by Stripe. After payment the gift is created and becomes a redeemable code you can share; credits move to the recipient when they redeem it."
          : "Stripe isn’t configured here, so no card is charged — the gift is created immediately as a redeemable code. Credits move to the recipient when they redeem it."}
      </p>
    </form>
  );
}
