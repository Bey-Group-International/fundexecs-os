import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import Copilot from "@/components/Copilot";
import type { Session } from "@/lib/supabase/database.types";
import { loadWorkflowBundles } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  // Earn opens fresh — like Claude Code's home screen. The chat starts clean
  // and the operator's most recent sessions sit above it for one-click resume.
  const [bundles, { data: recentSessions }] = await Promise.all([
    loadWorkflowBundles(supabase),
    supabase
      .from("sessions")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const sessions = (recentSessions ?? []) as Session[];

  return (
    <Copilot
      orgId={ctx.orgId}
      live={copilotLive()}
      bundles={bundles}
      recentSessions={sessions}
    />
  );
}
