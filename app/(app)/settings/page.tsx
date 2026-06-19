import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import type { MandateRow } from "@/lib/supabase/database.types";
import { NewMandateForm } from "./NewMandateForm";
import { Connections } from "./Connections";
import { TIER_2_ACTIONS } from "./tier2-actions";
import { deactivateMandate } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("mandates")
    .select("*")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const activeMandate = (data as MandateRow | null) ?? null;

  const labelFor = (kind: string) =>
    TIER_2_ACTIONS.find((a) => a.kind === kind)?.label ?? kind;

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

      <section className="mt-8">
        <header className="mb-3">
          <h2 className="font-mono text-xs uppercase tracking-wider text-fg-muted">Mandates</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            A mandate is your standing job-description for Earn: pre-authorize specific external
            (Tier 2) actions to run unattended. Capital- and compliance-binding work (Tier 3) always
            stays with you.
          </p>
        </header>

        {activeMandate ? (
          <div className="mb-4 rounded-xl border border-line bg-surface-1 p-4">
            <div className="flex items-start gap-3">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-status-success"
                aria-label="active"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg-primary">{activeMandate.name}</span>
                  <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                    Active
                  </span>
                </div>
                {activeMandate.goal ? (
                  <p className="mt-1 text-xs leading-snug text-fg-secondary">{activeMandate.goal}</p>
                ) : null}
                {activeMandate.auto_approve.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeMandate.auto_approve.map((kind) => (
                      <span
                        key={kind}
                        className="rounded-full border border-line bg-surface-0 px-2 py-0.5 text-[10px] text-fg-secondary"
                      >
                        {labelFor(kind)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    No actions pre-authorized
                  </p>
                )}
              </div>

              <form action={deactivateMandate} className="shrink-0">
                <input type="hidden" name="id" value={activeMandate.id} />
                <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger">
                  Stand down
                </button>
              </form>
            </div>
          </div>
        ) : (
          <p className="mb-4 rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
            No active mandate. Every external action waits for your approval until you activate one.
          </p>
        )}

        <NewMandateForm tier2Actions={TIER_2_ACTIONS} />
      </section>

      <Connections />

      <form action={signOut} className="mt-6">
        <button className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
          Sign out
        </button>
      </form>
    </div>
  );
}
