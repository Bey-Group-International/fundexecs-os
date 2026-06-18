import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { AGENTS } from "@/lib/agents";

// Authed shell. Gates every route in the (app) group: unauthenticated → login,
// authenticated-but-no-org → onboarding. Warm-black/gold Command Center vibe.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0 text-fg-primary">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex h-12 items-center border-b border-line px-4">
          <Link href="/workspace">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-gold-400">
              FundExecs OS
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 text-sm">
          <Link
            href="/workspace"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
          >
            <span className="font-mono text-base leading-none text-gold-400">⌘</span>
            Copilot
          </Link>
          <Link
            href="/dashboard"
            className="mt-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
          >
            <span className="font-mono text-base leading-none text-gold-400">◧</span>
            Command Center
          </Link>

          <p className="mb-1 mt-5 px-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Build
          </p>
          <Link
            href="/build/profile"
            className="block rounded-md px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
          >
            Profile
          </Link>
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

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg-primary">
              {ctx.email?.split("@")[0] ?? "Workspace"}
            </span>
            <span className="font-mono text-xs text-fg-muted">·</span>
            <span className="font-mono text-xs text-fg-muted">Private Markets</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">Agents</span>
            <div className="flex items-center gap-1.5">
              {AGENTS.map((agent) => (
                <span
                  key={agent.key}
                  title={agent.name}
                  className="h-2 w-2 rounded-full opacity-50"
                  style={{ backgroundColor: agent.color }}
                  aria-label={agent.name}
                />
              ))}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
