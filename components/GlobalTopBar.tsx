"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActiveSession } from "@/components/session/active-session";
import { dockHiddenOn } from "@/lib/copilot";
import { SessionCommandBar } from "@/components/session/SessionCommandBar";
import { TopNavAlerts } from "@/components/TopNavAlerts";
import { MobileNavToggle } from "@/components/nav/MobileNavToggle";
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
  const pathname = usePathname() || "/";

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
      <MobileNavToggle />
      <span className="font-display text-sm font-semibold tracking-tight text-fg-secondary">FundExecs OS</span>
      <div className="ml-auto flex items-center gap-1">
        {/* Ask Earn. ⌘K and the floating pill both already opened the dock, but
            neither is discoverable — a shortcut you have to know and a pill that
            sits in the corner. This is the one entry point that is simply
            visible. Hidden exactly where the dock is: on the session/workspace
            surfaces a button that opens nothing would be worse than no button,
            and on mobile Earn is a primary tab already. */}
        {!dockHiddenOn(pathname) ? (
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("earn:open-with-context", { detail: {} }))
            }
            title="Ask Earn (⌘K)"
            className="hidden items-center gap-1.5 rounded-md border border-neural-400/40 px-2 py-1 text-xs font-medium text-neural-300 transition hover:bg-neural-400/10 hover:text-neural-200 md:flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-neural-400" aria-hidden />
            Ask Earn
            <kbd className="hidden rounded border border-neural-400/35 px-1 py-0.5 font-mono text-[10px] text-fg-muted lg:inline">
              ⌘K
            </kbd>
          </button>
        ) : null}
        <TopNavAlerts initialMessages={messagesUnread} initialDeals={dealsUnread} />
        <Link
          href="/wallet"
          title="Wallet — credit balance"
          aria-label="Wallet"
          className="hidden items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary sm:flex"
        >
          <span className="text-gold-300">◇</span>
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
