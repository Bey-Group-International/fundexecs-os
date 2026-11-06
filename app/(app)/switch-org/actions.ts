"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { ACTIVE_ORG_COOKIE, ACTIVE_ORG_MAX_AGE } from "@/lib/active-org";

/**
 * Switch the organization the person is working in. The id comes from the
 * browser, so it is only saved after the database confirms this person is a
 * member of it; anything else is ignored. Lands on the dashboard rather than
 * the current page, because a detail URL (a deal, a thread) from one
 * organization does not exist in another.
 */
export async function switchOrganization(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const orgId = String(formData.get("orgId") ?? "").trim();
  if (orgId) {
    const supabase = await createServerClient();
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("principal_id", ctx.userId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (membership) {
      (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ACTIVE_ORG_MAX_AGE,
      });
    }
  }
  redirect("/dashboard");
}
