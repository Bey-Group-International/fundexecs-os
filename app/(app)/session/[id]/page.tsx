import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import { loadWorkflowBundles } from "@/lib/workflows";
import { getActiveIntegrations } from "@/lib/integrations/active";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import { loadSessionMessages, toChatTurns } from "@/lib/session-messages";
import Copilot from "@/components/Copilot";
import BrainFeed from "@/components/session/BrainFeed";
import type { BrainRun } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

// A session IS the Earn conversation, scoped to this session. The transcript
// shows every prompt and Earn's response in order; replying adds to it, with
// the session's earlier turns carried into Earn's planning.
export default async function SessionHome(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  const supabase = await createServerClient();
  const bundles = await loadWorkflowBundles(supabase, { sessionId: params.id });
  const connected = await orgConnectedChannels(supabase, ctx.orgId);
  const chat = toChatTurns(await loadSessionMessages(supabase, params.id));

  // The session theater — every Brain activation logged for this session.
  // Best-effort: any read failure degrades to an empty feed.
  const { data: brainRuns } = await supabase
    .from("brain_runs")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("session_id", params.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <>
      <Copilot
        orgId={ctx.orgId}
        live={copilotLive()}
        bundles={bundles}
        sessionId={params.id}
        integrations={getActiveIntegrations(connected)}
        initialChat={chat}
      />
      <BrainFeed runs={(brainRuns ?? []) as BrainRun[]} />
    </>
  );
}
