import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { signOut } from "@/app/login/actions";

export const dynamic = "force-dynamic";

// Standalone chrome for the internal admin console — deliberately NOT the app
// shell (no hubs, no sessions rail). The gate is the whole point: a signed-out
// visitor is sent to /login; a signed-in NON-admin gets a 404 so the route's
// existence stays hidden from ordinary users.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    if (gate.status === 401) redirect("/login?next=/admin");
    notFound();
  }

  return (
    <div className="min-h-screen bg-surface-0 text-fg-primary">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line/70 bg-surface-0/85 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="font-display text-sm font-bold tracking-tight text-fg-primary"
          >
            FundExecs
            <span className="ml-2 rounded-md bg-gold-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-gold-300">
              Admin
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-[11px] text-fg-muted sm:inline">
            {gate.ctx.email}
          </span>
          <Link
            href="/workspace"
            className="font-mono text-[11px] text-fg-secondary transition hover:text-fg-primary"
          >
            ← App
          </Link>
          <form action={signOut}>
            <button className="rounded-md border border-line/60 px-2 py-1 font-mono text-[11px] text-fg-muted transition hover:border-line hover:text-fg-secondary">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
