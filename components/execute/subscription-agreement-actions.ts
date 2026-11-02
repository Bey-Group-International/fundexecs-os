"use server";

import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { createEnvelope } from "@/lib/envelope-create.server";
import { AGREEMENT_SIGNATURE_PAGE, agreementText, loadAgreementFacts, readyForAgreement } from "@/lib/lp-agreement.server";

/**
 * Prepare an LP's subscription agreement: build it from their session (their name,
 * commitment and fund), and open it as a draft the owner places signature blocks on.
 * Owners and admins only. If the LP already has a live agreement, that one is returned.
 */
export async function prepareSubscriptionAgreement(
  sessionId: string,
): Promise<{ ok: true; envelopeId: string } | { ok: false; error: string }> {
  if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "Not found." };
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };
  if (!canAdminOrg(ctx.role)) return { ok: false, error: "Only an owner or admin can prepare the agreement." };
  if (!hasSupabaseServiceEnv()) return { ok: false, error: "Not available right now." };

  const supabase = await createServerClient();
  const service = createServiceClient();
  const facts = await loadAgreementFacts(service, sessionId, ctx.orgId);
  if (!facts) return { ok: false, error: "Not found." };

  const { data: existing } = await supabase
    .from("envelopes")
    .select("id")
    .eq("lp_session_id", sessionId)
    .neq("status", "voided")
    .maybeSingle();
  if (existing) return { ok: true, envelopeId: (existing as { id: string }).id };

  if (!readyForAgreement(facts)) {
    return { ok: false, error: "The LP must be approved, and not yet signed, before you send their agreement." };
  }

  const created = await createEnvelope(supabase as never, {
    orgId: ctx.orgId,
    creator: { id: ctx.userId, email: ctx.email || null, name: null },
    title: `Subscription Agreement - ${facts.fundName} - ${facts.lp_name}`,
    message: `Your subscription agreement for ${facts.fundName} is ready to sign.`,
    documentContent: agreementText(facts),
    signaturePage: AGREEMENT_SIGNATURE_PAGE,
    recipients: [{ name: facts.lp_name, email: facts.lp_email }],
    lpSessionId: sessionId,
  });
  if (!created.ok) return { ok: false, error: created.error };
  return { ok: true, envelopeId: created.envelopeId };
}
