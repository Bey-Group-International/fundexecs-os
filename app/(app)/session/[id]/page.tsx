import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import { loadWorkflowBundles } from "@/lib/workflows";
import Copilot from "@/components/Copilot";
import type { BrainRun } from "@/lib/supabase/database.types";
import BrainFeed from "@/components/session/BrainFeed";

export const dynamic = "force-dynamic";

// The session view IS the Earn chat — scoped to this session. Picking a recent
// session resumes work right here: prompts run inside the session, and the
// workflows it has produced render below the composer (Claude Code style).
export default async function SessionHome({ params }: { params: { id: string } }) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  const supabase = createServerClient();

  const [bundles, { data: brainData }] = await Promise.all([
    loadWorkflowBundles(supabase, { sessionId: params.id }),
    supabase
      .from("brain_runs")
      .select("*")
      .eq("session_id", params.id)
      .order("created_at", { ascending: true }),
  ]);
  const brainRuns = (brainData ?? []) as BrainRun[];

  return (
    <>
      <Copilot
        orgId={ctx.orgId}
        live={copilotLive()}
        bundles={bundles}
        sessionId={params.id}
      />
      {brainRuns.length > 0 ? (
        <div className="mx-auto mt-8 max-w-6xl">
          <BrainFeed runs={brainRuns} />
        </div>
      ) : null}
    </>
  );
}
