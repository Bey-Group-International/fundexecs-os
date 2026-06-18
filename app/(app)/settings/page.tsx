import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">Settings</span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Account
        </h1>
      </header>

      <div className="flex flex-col gap-2">
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Signed in as</p>
          <p className="mt-1 text-sm text-fg-primary">{ctx.email}</p>
        </div>
        <Link
          href="/build/profile"
          className="rounded-xl border border-line bg-surface-1 p-4 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
        >
          Organization profile →
        </Link>
        <Link
          href="/wallet"
          className="rounded-xl border border-line bg-surface-1 p-4 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
        >
          Wallet & credits →
        </Link>
      </div>

      <form action={signOut} className="mt-6">
        <button className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
          Sign out
        </button>
      </form>
    </div>
  );
}
