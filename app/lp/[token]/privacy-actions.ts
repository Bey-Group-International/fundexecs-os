"use server";

// An LP asking for a copy of their data or for it to be erased, from their own link.
// Public and token-gated like the wizard: the link must be live and this browser must
// have passed the emailed-code check, so a forwarded link alone cannot ask for someone's
// data to be sent or deleted. Allowed in every review state: a rejected or approved LP
// has the same rights as one still filling in the form.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { getLinkSession, hasLpPass } from "@/lib/lp-access.server";
import { parsePrivacyKind, privacyConfirmation } from "@/lib/lp-privacy-request";
import { recordPrivacyRequest } from "@/lib/lp-privacy-request.server";

export type PrivacyRequestActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function requestPrivacyAction(token: string, kind: unknown): Promise<PrivacyRequestActionResult> {
  try {
    const parsed = parsePrivacyKind(kind);
    if (!parsed) return { ok: false, error: "Choose what you are asking for." };
    if (!hasSupabaseServiceEnv()) return { ok: false, error: "This link isn't available. Contact your fund manager." };
    const supabase = createServiceClient();
    const session = await getLinkSession(supabase, token);
    if (!session || !(await hasLpPass(session.id))) return { ok: false, error: "This link isn't available. Contact your fund manager." };

    const { data: org } = await supabase.from("organizations").select("name").eq("id", session.organization_id).maybeSingle();
    const orgName = (org as { name?: string } | null)?.name ?? "your fund manager";
    const res = await recordPrivacyRequest(supabase, { sessionId: session.id, orgId: session.organization_id, lpName: session.lp_name, kind: parsed });
    if (!res.ok) return { ok: false, error: "Couldn't send your request. Try again, or contact your fund manager directly." };
    return { ok: true, message: res.alreadyAsked ? "You've already asked for this today. Your fund manager has it and will contact you." : privacyConfirmation(parsed, orgName) };
  } catch (err) {
    console.error("[lp-privacy] request failed", err);
    return { ok: false, error: "Couldn't send your request. Try again, or contact your fund manager directly." };
  }
}
