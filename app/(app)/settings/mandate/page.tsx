import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveMandate } from "@/lib/mandates";
import { MandateEditor } from "@/components/mandate/MandateEditor";

export const dynamic = "force-dynamic";

// The mandate editor — where the operator tunes what the Earn copilot may
// auto-run on their behalf. Seeds the editor with the org's current standing
// mandate so the toggles reflect what is live today.
export default async function MandatePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const mandate = await getActiveMandate(supabase, ctx.orgId);

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Earn mandate
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          What Earn can do
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
          Your standing job-description for the copilot. Pre-authorize the counterparty-facing work
          Earn may run on its own, and set how far it may go. Internal drafts always run;
          capital- and compliance-binding work always stays with you.
        </p>
      </header>

      <MandateEditor
        autoApprove={mandate?.autoApprove ?? []}
        autonomyCeiling={mandate?.autonomyCeiling ?? 1}
      />
    </div>
  );
}
