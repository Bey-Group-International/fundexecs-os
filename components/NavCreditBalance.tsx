"use client";

// components/NavCreditBalance.tsx
// The credit balance in the top nav, kept live.
//
// The balance is resolved server-side in app/(app)/layout.tsx and handed down as
// a prop. A layout renders once and is then reused across every client-side
// navigation, so that prop is a snapshot of the balance at the moment the tab
// was loaded — it does not change again for the life of the session. Spending
// credits moved the number on /wallet (its own page re-renders) while the nav
// went on showing the pre-spend figure indefinitely, which reads as the debit
// having not happened.
//
// Liveness matches TopNavAlerts: a ~30s poll plus a refresh when the tab regains
// focus, seeded with the server value so first paint is correct and never
// flashes a zero. On top of that it listens for a `credits:changed` event, so
// anything that knows the new balance (clearing the paywall, buying credits) can
// update the nav immediately rather than waiting for the next poll.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCredits } from "@/lib/billing";
import { getCreditBalance } from "@/app/(app)/nav-actions";

const POLL_MS = 30_000;

/** Fired by anything that changes the balance: `detail.balance` when the new
 *  figure is already known, otherwise omitted to force a re-read. */
export const CREDITS_CHANGED_EVENT = "credits:changed";

export function NavCreditBalance({
  initialBalance,
  className,
  title = "Wallet — credit balance",
}: {
  initialBalance: number;
  className?: string;
  title?: string;
}) {
  const [balance, setBalance] = useState(initialBalance);

  const refresh = useCallback(async () => {
    try {
      setBalance(await getCreditBalance());
    } catch {
      // Ignore transient failures — the balance holds its last known value
      // rather than flashing a wrong one.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onChanged = (e: Event) => {
      const next = (e as CustomEvent<{ balance?: number }>).detail?.balance;
      if (typeof next === "number") setBalance(next);
      else refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(CREDITS_CHANGED_EVENT, onChanged);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(CREDITS_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  return (
    <Link
      href="/wallet"
      title={title}
      aria-label="Wallet"
      className={
        className ??
        "hidden items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary sm:flex"
      }
    >
      <span className="text-gold-300">◇</span>
      {formatCredits(balance)}
    </Link>
  );
}
