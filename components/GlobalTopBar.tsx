"use client";

import Link from "next/link";
import { useActiveSession } from "@/components/session/active-session";
import { SessionCommandBar } from "@/components/session/SessionCommandBar";
import { TopNavAlerts } from "@/components/TopNavAlerts";
import { ThemeToggle } from "@/components/ThemeToggle";
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
    <div className="flex min-h-12 items-center gap-2 border-b border-line bg-surface-0/82 px-3 py-2 backdrop-blur-xl sm:h-12 sm:px-4">
      <span className="font-mono text-xs uppercase tracking-wider text-fg-muted">Workspace</span>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle compact />
        <TopNavAlerts initialMessages={messagesUnread} initialDeals={dealsUnread} />
        <Link
          href="/wallet"
          title="Credit balance — open wallet"
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
