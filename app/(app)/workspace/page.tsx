import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import { getActiveIntegrations } from "@/lib/integrations/active";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import Copilot from "@/components/Copilot";

export const dynamic = "force-dynamic";

// The launcher — a fresh Earn conversation. Recent sessions live in the left
// sidebar (the conversation list), so this is just an empty chat: sending a
// prompt opens a session and the conversation continues at /session/<id>.
export default async function WorkspacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const connected = await orgConnectedChannels(createServerClient(), ctx.orgId);

  return (
    <Copilot
      orgId={ctx.orgId}
      live={copilotLive()}
      bundles={[]}
      integrations={getActiveIntegrations(connected)}
    />
  );
}
