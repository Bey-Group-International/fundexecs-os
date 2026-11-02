"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The fund counter-signs a file someone signed in a data room. Owners and
 * admins only. The counter-signer's email is the signed-in member's confirmed
 * email, never a form field, and the signature must belong to their own org.
 */
export async function countersignRoomDocumentAction(
  signatureId: string,
  signerName: string,
  signaturePng: string,
  agreed: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const generic = { ok: false as const, error: "We couldn't record your counter-signature. Please try again." };
  if (typeof signatureId !== "string" || !UUID.test(signatureId)) return generic;
  // Applies the same MFA gate the pages do; a server action is its own endpoint.
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not signed in." };
  const ctx = auth.ctx;
  if (!canAdminOrg(ctx.role)) return { ok: false, error: "Only an owner or admin can counter-sign." };
  if (!ctx.emailConfirmed || !ctx.email) return { ok: false, error: "Confirm your email address before counter-signing." };
  if (!hasSupabaseServiceEnv()) return generic;

  // The org check goes through the member's own client (row-level security).
  const mine = await createServerClient();
  const { data: owned } = await mine
    .from("data_room_document_signatures")
    .select("id")
    .eq("id", signatureId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!owned) return generic;

  const service = createServiceClient();
  const { countersignDocument, afterDocumentCountersigned } = await import("@/lib/document-signing.server");
  const result = await countersignDocument(service, {
    orgId: ctx.orgId,
    signatureId,
    signerName,
    signaturePng,
    signerEmail: ctx.email,
    userId: ctx.userId,
    agreed: agreed === true,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const { after } = await import("next/server");
  after(() => afterDocumentCountersigned(service, signatureId).then(() => undefined, () => undefined));
  revalidatePath("/build/data_room");
  return { ok: true };
}
