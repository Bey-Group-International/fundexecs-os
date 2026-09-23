import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { CallRecorder } from "./CallRecorder";

export const dynamic = "force-dynamic";

/**
 * Record a call.
 *
 * The name and organisation are resolved here rather than in the browser
 * because they go into the disclosure the person reads aloud — "Priya at Bey
 * Group is recording this call" — and a disclosure that said "undefined is
 * recording this call" would be worse than no script at all.
 */
export default async function RecordCallPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const [{ data: profile }, { data: org }] = await Promise.all([
    supabase.from("principals").select("full_name").eq("id", ctx.userId).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", ctx.orgId).maybeSingle(),
  ]);

  const fullName = (profile as { full_name?: string | null } | null)?.full_name?.trim();
  // The email's local part is a poor name and a good fallback: it is at least
  // the person, which is what the sentence needs.
  const userName = fullName || ctx.email?.split("@")[0] || "I";
  const orgName = (org as { name?: string | null } | null)?.name?.trim() || null;

  return <CallRecorder userId={ctx.userId} userName={userName} orgName={orgName} />;
}
