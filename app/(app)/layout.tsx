import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { HUBS } from "@/lib/hubs";
import { AGENTS } from "@/lib/agents";

const HUB_ICONS: Record<string, string> = {
  build: "◈",
  source: "◎",
  run: "◉",
  execute: "◆",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0a] text-white">
      {/* Side rail */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/5">
        {/* Brand */}
        <div className="flex h-12 items-center border-b border-white/5 px-4">
          <Link href="/workspace">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
              FundExecs OS
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <Link
            href="/workspace"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-white"
          >
            <span className="font-mono text-base leading-none">⌂</span>
            Workspace
          </Link>

          <div className="mt-4 flex flex-col gap-0.5">
            {HUBS.map((hub) => (
              <div key={hub.key} className="mb-3">
                <p className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                  <span className="text-xs text-neutral-700">{HUB_ICONS[hub.key]}</span>
                  {hub.label}
                </p>
                {hub.modules.slice(0, 3).map((mod) => (
                  <Link
                    key={mod.key}
                    href={`/${hub.key}/${mod.key}`}
                    className="block rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-white/5 hover:text-neutral-300"
                  >
                    {mod.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </nav>

        {/* User footer */}
        <div className="border-t border-white/5 p-3">
          <form action={signOut}>
            <p className="mb-1.5 truncate px-1 text-xs text-neutral-600">{ctx.email}</p>
            <button className="w-full rounded-md border border-white/10 px-2 py-1.5 text-xs text-neutral-500 transition hover:bg-white/5 hover:text-neutral-300">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/5 px-5">
          {/* Org name */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{ctx.email?.split("@")[0] ?? "Workspace"}</span>
            <span className="font-mono text-xs text-neutral-700">·</span>
            <span className="font-mono text-xs text-neutral-600">Pre-Alpha</span>
          </div>

          {/* Agent status dots */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-600">Agents</span>
            <div className="flex items-center gap-1.5">
              {AGENTS.map((agent) => (
                <span
                  key={agent.key}
                  title={agent.name}
                  className="h-2 w-2 rounded-full opacity-40"
                  style={{ backgroundColor: agent.color }}
                  aria-label={agent.name}
                />
              ))}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
