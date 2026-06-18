import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

// Authed shell. Gates every route in the (app) group: unauthenticated → login,
// authenticated-but-no-org → onboarding.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface-1 px-4 py-6">
        <Link href="/workspace" className="mb-8 block">
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-gold-400">
            FundExecs OS
          </span>
        </Link>
        <nav className="flex flex-col gap-1 text-sm">
          <Link
            href="/workspace"
            className="rounded-md px-2 py-1.5 text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
          >
            Copilot
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md px-2 py-1.5 text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
          >
            Command Center
          </Link>
          <p className="mt-4 px-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Build
          </p>
          <Link
            href="/build/profile"
            className="rounded-md px-2 py-1.5 text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
          >
            Profile
          </Link>
        </nav>
        <form action={signOut} className="mt-auto pt-6">
          <p className="mb-2 truncate px-2 text-xs text-fg-muted">{ctx.email}</p>
          <button className="w-full rounded-md border border-line px-2 py-1.5 text-sm text-fg-secondary hover:bg-surface-2">
            Sign out
          </button>
        </form>
      </aside>
      <main className="flex-1 px-8 py-10">{children}</main>
    </div>
  );
}
