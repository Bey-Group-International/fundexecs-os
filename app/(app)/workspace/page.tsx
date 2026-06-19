import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import Copilot from "@/components/Copilot";
import type { Session } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

// The launcher — Claude Code's home screen. A fresh composer with the
// operator's recent sessions above it for one-click resume. There's no
// workflow list here: sending a prompt opens a session and the work continues
// at /session/<id>, which is where a session's workflows and history live.
export default async function WorkspacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  const { data: recentSessions } = await supabase
    .from("sessions")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(6);

  const sessions = (recentSessions ?? []) as Session[];

  return (
    <Copilot
      orgId={ctx.orgId}
      live={copilotLive()}
      bundles={[]}
      recentSessions={sessions}
    />
  );
}
