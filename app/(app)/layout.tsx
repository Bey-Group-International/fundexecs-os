import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";
import { GuidedTour } from "@/components/GuidedTour";
import { startSession } from "@/app/(app)/sessions/actions";
import { getWalletBalance } from "@/lib/wallet";
import { ActiveSessionProvider } from "@/components/session/active-session";
import { GlobalTopBar } from "@/components/GlobalTopBar";

// The four hubs, in operating order, as shown in the side rail.
const HUB_ORDER: Hub[] = ["build", "run", "source", "execute"];

// Authed shell. Side rail: Earn (the copilot) + Workflows + Command Center, then
// the four operational hubs (Build / Run / Source / Execute) whose modules
// reveal on hover. Each hub has its own page with a top module switcher.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const balance = await getWalletBalance(ctx.orgId);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0 text-fg-primary">
      <aside className="flex w-[224px] shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex h-12 items-center gap-2 border-b border-line px-4">
          <Link href="/workspace" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gold-400 font-display text-sm font-bold text-surface-0">
              E
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-gold-400">
              FundExecs OS
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 text-sm">
          <form action={startSession}>
            <button className="flex w-full items-center justify-center gap-2 rounded-md bg-gold-400 px-2 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
              <span className="text-base leading-none">+</span>
              New Session
            </button>
          </form>

          <div className="mt-3 flex flex-col gap-0.5">
            <Link
              href="/automations"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              <span className="font-mono text-base leading-none text-gold-400">↻</span>
              Workflows
            </Link>
            <Link
              href="/workspace"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              <span className="font-mono text-base leading-none text-gold-400">⌘</span>
              Earn
            </Link>
            <Link
              href="/earn"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              <span className="font-mono text-base leading-none text-gold-400">❖</span>
              Brains
            </Link>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              <span className="font-mono text-base leading-none text-gold-400">◧</span>
              Command Center
            </Link>
            <Link
              href="/capital-map"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              <span className="font-mono text-base leading-none text-gold-400">◈</span>
              Capital Map
            </Link>
            <Link
              href="/graph"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              <span className="font-mono text-base leading-none text-gold-400">⟁</span>
              Graphs
            </Link>
            <Link
              href="/marketplace"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              <span className="font-mono text-base leading-none text-gold-400">◇</span>
              Marketplace
            </Link>
          </div>

          <p className="mb-1 mt-5 px-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            Hubs
          </p>
          {HUB_ORDER.map((key) => {
            const hub = HUB_BY_KEY[key];
            return (
              <div key={hub.key} className="group">
                <Link
                  href={`/${hub.key}`}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                >
                  {hub.label}
                  <span className="font-mono text-[10px] text-fg-muted transition group-hover:text-gold-400">
                    {hub.modules.length}
                  </span>
                </Link>
                {/* Modules reveal on hover. */}
                <div className="hidden flex-col group-hover:flex">
                  {hub.modules.map((mod) => (
                    <Link
                      key={mod.key}
                      href={`/${hub.key}/${mod.key}`}
                      className="rounded-md px-2 py-1 pl-7 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                    >
                      {mod.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <form action={signOut}>
            <p className="mb-1.5 truncate px-1 text-xs text-fg-muted">{ctx.email}</p>
            <button className="w-full rounded-md border border-line px-2 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <ActiveSessionProvider>
        <div className="flex flex-1 flex-col overflow-hidden">
          <GlobalTopBar balance={balance} />
          <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
        </div>
      </ActiveSessionProvider>

      <GuidedTour />
    </div>
  );
}
