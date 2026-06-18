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
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-900 px-4 py-6">
        <Link href="/workspace" className="mb-8 block">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
            FundExecs OS
          </span>
        </Link>
        <nav className="flex flex-col gap-1 text-sm">
          <Link
            href="/workspace"
            className="rounded-md px-2 py-1.5 text-neutral-300 hover:bg-neutral-900"
          >
            Workspace
          </Link>
          <p className="mt-4 px-2 text-xs uppercase tracking-wider text-neutral-600">
            Build
          </p>
          <Link
            href="/build/profile"
            className="rounded-md px-2 py-1.5 text-neutral-300 hover:bg-neutral-900"
          >
            Profile
          </Link>
        </nav>
        <form action={signOut} className="mt-auto pt-6">
          <p className="mb-2 truncate px-2 text-xs text-neutral-500">{ctx.email}</p>
          <button className="w-full rounded-md border border-neutral-800 px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900">
            Sign out
          </button>
        </form>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
