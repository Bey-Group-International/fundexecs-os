import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { hasSupabaseServerEnv } from "@/lib/supabase/server";
import { OfficeShell } from "@/components/office/OfficeShell";

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

  return (
    <div className="mx-auto max-w-6xl">
      <OfficeShell
        userId={ctx.userId}
        displayName={displayName}
        orgId={ctx.orgId}
        hasRealtime={hasSupabaseServerEnv()}
      />
    </div>
  );
}
