"use client";

// components/TopNavAlerts.tsx
// The two live alert icons in the top nav:
//   📬 mailbox  — unread messages (capital, partners, providers + comms). Shakes
//                 when the count rises; opens the inbox.
//   💡 lightbulb — unread shared-deal updates (botmemo-style). Pops when a new
//                 deal lands; opens "deals that fit you".
//
// Liveness today is a lightweight ~30s poll (plus a refresh when the tab regains
// focus), with the rise-detection that drives the shake kept separate from the
// fetch. To go fully live later, swap the body of `refresh` for a Supabase
// Realtime subscription on inbox_threads inserts for this org and call
// `apply(...)` from the event handler — everything below stays the same.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAlertCounts } from "@/app/(app)/nav-actions";

const POLL_MS = 30_000;

export function TopNavAlerts({
  initialMessages = 0,
  initialDeals = 0,
}: {
  initialMessages?: number;
  initialDeals?: number;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [deals, setDeals] = useState(initialDeals);
  const [shakeMsg, setShakeMsg] = useState(false);
  const [popDeal, setPopDeal] = useState(false);
  // Last-seen counts, so we animate only on a genuine rise (not on every poll).
  const prev = useRef({ messages: initialMessages, deals: initialDeals });

  const apply = useCallback((nextMessages: number, nextDeals: number) => {
    if (nextMessages > prev.current.messages) {
      setShakeMsg(true);
      setTimeout(() => setShakeMsg(false), 650);
    }
    if (nextDeals > prev.current.deals) {
      setPopDeal(true);
      setTimeout(() => setPopDeal(false), 550);
    }
    prev.current = { messages: nextMessages, deals: nextDeals };
    setMessages(nextMessages);
    setDeals(nextDeals);
  }, []);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const next = await getAlertCounts();
        if (alive) apply(next.messages, next.deals);
      } catch {
        // ignore transient poll failures — the badge just holds its last value
      }
    }
    const id = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [apply]);

  return (
    <>
      <Link
        href="/inbox"
        aria-label={messages > 0 ? `Match inbox — ${messages} match${messages === 1 ? "" : "es"} ready` : "Match inbox"}
        title={messages > 0 ? `${messages} match${messages === 1 ? "" : "es"} ready` : "Match inbox — capital, partners & providers"}
        className="relative rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
      >
        <span className={`inline-block ${shakeMsg ? "animate-shake" : ""}`}>📬</span>
        {messages > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-400 px-1 font-mono text-[9px] font-semibold text-surface-0">
            {messages > 9 ? "9+" : messages}
          </span>
        ) : null}
      </Link>

      <Link
        href="/deals/feed"
        aria-label={deals > 0 ? `${deals} deal${deals === 1 ? "" : "s"} on the table` : "Hot deals that fit you"}
        title={deals > 0 ? `${deals} deal${deals === 1 ? "" : "s"} on the table` : "Hot deals that fit you"}
        className="relative rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
      >
        <span className={`inline-block ${popDeal ? "animate-nudge" : ""}`}>💡</span>
        {deals > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-400 px-1 font-mono text-[9px] font-semibold text-surface-0">
            {deals > 9 ? "9+" : deals}
          </span>
        ) : null}
      </Link>
    </>
  );
}
