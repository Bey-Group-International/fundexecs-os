"use client";

import Link from "next/link";
import { useActiveSession } from "@/components/session/active-session";
import { SessionCommandBar } from "@/components/session/SessionCommandBar";
import { TopNavAlerts } from "@/components/TopNavAlerts";
import { formatCredits } from "@/lib/billing";

// The global top bar. Inside a session it renders the full command surface
// (session name + Share + ⋮ Session Actions); elsewhere it shows the app-level
// items: the live mailbox + lightbulb alerts, balance, and settings.
export function GlobalTopBar({
  balance,
  messagesUnread = 0,
  dealsUnread = 0,
}: {
  balance: number;
  messagesUnread?: number;
  dealsUnread?: number;
}) {
  const { session, tasks } = useActiveSession();

  if (session) {
    return (
      <SessionCommandBar
        sessionId={session.id}
        name={session.name}
        color={session.color}
        balance={balance}
        tasks={tasks}
      />
    );
  }

  return (
    <div className="relative flex min-h-12 items-center gap-2 border-b border-line bg-surface-0/82 px-3 py-2 backdrop-blur-xl sm:h-12 sm:px-4">
      {/* Gradient top accent stripe */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/40 to-transparent"
      />
      <span className="font-display text-sm font-semibold tracking-tight text-fg-secondary">FundExecs OS</span>
      <div className="ml-auto flex items-center gap-1">
        <TopNavAlerts initialMessages={messagesUnread} initialDeals={dealsUnread} />
        <Link
          href="/wallet"
          title="Wallet — credit balance"
          aria-label="Wallet"
          className="hidden items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary sm:flex"
        >
          <span className="text-gold-400">◇</span>
          {formatCredits(balance)}
        </Link>
        <Link
          href="/settings"
          title="Settings"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
        >
          ⚙
        </Link>
      </div>
    </div>
  );
}
