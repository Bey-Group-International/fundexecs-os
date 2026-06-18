"use client";

import Link from "next/link";
import { useActiveSession } from "@/components/session/active-session";
import { SessionCommandBar } from "@/components/session/SessionCommandBar";
import { formatCredits } from "@/lib/billing";

// The global top bar. Inside a session it renders the full command surface
// (session name + Share + ⋮ Session Actions); elsewhere it shows the app-level
// items only (Notifications · Balance · Profile→Settings).
export function GlobalTopBar({ balance }: { balance: number }) {
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
    <div className="flex h-12 items-center gap-2 border-b border-line px-4">
      <span className="font-mono text-xs uppercase tracking-wider text-fg-muted">Workspace</span>
      <div className="ml-auto flex items-center gap-1">
        <span
          title="Notifications"
          className="rounded-md px-2 py-1.5 text-fg-secondary"
          aria-label="Notifications"
        >
          💡
        </span>
        <Link
          href="/wallet"
          title="Credit balance — open wallet"
          className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
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
