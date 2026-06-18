import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { describeSchedule } from "@/lib/cron";
import type { Automation } from "@/lib/supabase/database.types";
import { NewAutomationForm } from "./NewAutomationForm";
import { toggleAutomation, deleteAutomation, runAutomationNow } from "./actions";

export const dynamic = "force-dynamic";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function untilTime(iso: string | null): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

export default async function AutomationsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("automations")
    .select("*")
    .order("created_at", { ascending: false });
  const automations = (data ?? []) as Automation[];

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Workflows
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Automated sessions
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          A workflow is an automated session: save an instruction once and it runs on a schedule,
          plans itself with the Associate, and — when you trust it — executes end-to-end without
          you. Approval-gated by default.
        </p>
      </header>

      <NewAutomationForm />

      <section className="mt-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
          Your workflows
        </h2>

        {automations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
            No workflows yet. Create one above — try{" "}
            <span className="text-fg-secondary">
              &ldquo;Every Monday, summarize what moved in our deal pipeline&rdquo;
            </span>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {automations.map((a) => (
              <div
                key={a.id}
                className="rounded-xl border border-line bg-surface-1 p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      a.enabled ? "bg-emerald-400" : "bg-fg-muted/40"
                    }`}
                    aria-label={a.enabled ? "enabled" : "paused"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg-primary">{a.name}</span>
                      {a.auto_approve ? (
                        <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                          Auto
                        </span>
                      ) : (
                        <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                          Approval
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">
                      {a.prompt}
                    </p>
                    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {describeSchedule(a.schedule)}
                      {a.enabled && untilTime(a.next_run_at) ? ` · next ${untilTime(a.next_run_at)}` : ""}
                      {" · "}
                      {a.run_count} run{a.run_count === 1 ? "" : "s"} · last {relativeTime(a.last_run_at)}
                      {a.last_run_status ? ` · ${a.last_run_status}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <form action={runAutomationNow}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="rounded-md bg-gold-500 px-2.5 py-1 text-xs font-medium text-surface-0 transition hover:bg-gold-400">
                        Run now
                      </button>
                    </form>
                    <form action={toggleAutomation}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="enabled" value={String(a.enabled)} />
                      <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                        {a.enabled ? "Pause" : "Resume"}
                      </button>
                    </form>
                    <form action={deleteAutomation}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:border-red-500/40 hover:text-red-400">
                        ✕
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-fg-muted">
        Runs appear in the{" "}
        <Link href="/workspace" className="text-gold-400 hover:underline">
          Copilot
        </Link>{" "}
        and{" "}
        <Link href="/dashboard" className="text-gold-400 hover:underline">
          Command Center
        </Link>{" "}
        as they execute.
      </p>
    </div>
  );
}
