import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { hasSupabaseServerEnv } from "@/lib/supabase/server";
import { OfficeShell } from "@/components/office/OfficeShell";
import { loadOfficeLayout } from "./actions";
import { loadMyAvatar } from "./avatar-actions";
import { loadMyPortrait } from "./portrait-actions";
import { fetchAgentActivity } from "@/lib/office/activityServer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Virtual Office",
  description:
    "A spatial workspace where your executive agents and teammates gather in real time.",
};

export default async function OfficePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const displayName = ctx.email ? ctx.email.split("@")[0] : "You";

  // Layout (persisted per-org, default fallback) and the agents' current
  // activity are fetched server-side so the office renders populated on load.
  const [layout, activity, myAvatar, myPortraitUrl] = await Promise.all([
    loadOfficeLayout(ctx.orgId),
    fetchAgentActivity(ctx.orgId),
    loadMyAvatar(ctx.orgId),
    loadMyPortrait(ctx.orgId),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <OfficeShell
        userId={ctx.userId}
        displayName={displayName}
        orgId={ctx.orgId}
        hasRealtime={hasSupabaseServerEnv()}
        layout={layout}
        initialActivity={activity}
        myAvatar={myAvatar}
        myPortraitUrl={myPortraitUrl}
      />
    </div>
  );
}
