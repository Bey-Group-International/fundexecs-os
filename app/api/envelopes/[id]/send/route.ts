import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { inviteSigners } from "@/lib/envelope-invite.server";
import { recipientsWithoutSignature } from "@/lib/envelope-fields";

export const runtime = "nodejs";

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const envelopeId = params.id;
  const supabase = await createServerClient();

  // Authenticate
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Resolve org: the one the person is working in, not just their first.
  const ctx = await getSessionContext();
  if (!ctx?.orgId) {
    return NextResponse.json({ error: "No organization found" }, { status: 403 });
  }
  const orgId = ctx.orgId;

  // Update envelope status to 'sent'
  // Nothing goes out until every signer, and the owner, has a signature block to sign on.
  const [{ data: pre }, { data: placed }, { data: current }] = await Promise.all([
    supabase.from("envelope_recipients").select("id, name, role").eq("envelope_id", envelopeId),
    supabase.from("envelope_fields").select("recipient_id, field_type").eq("envelope_id", envelopeId),
    supabase.from("envelopes").select("status, pdf_storage_key, lp_session_id").eq("id", envelopeId).eq("organization_id", orgId).maybeSingle(),
  ]);
  const cur = current as { status: string; pdf_storage_key: string | null; lp_session_id: string | null } | null;
  if (!cur) return NextResponse.json({ error: "Envelope not found" }, { status: 404 });
  if (cur.status !== "draft") return NextResponse.json({ error: "This document has already been sent." }, { status: 409 });
  if (cur.pdf_storage_key) {
    const missing = recipientsWithoutSignature(
      ((pre ?? []) as { id: string; name: string; role: string }[]).map((r) => ({ id: r.id, name: r.role === "owner" ? "You (countersignature)" : r.name })),
      (placed ?? []) as { recipient_id: string; field_type: string }[],
    );
    if (missing.length) {
      return NextResponse.json({ error: `Place a signature block for: ${missing.join(", ")}` }, { status: 400 });
    }
  }

  const { data: envelope, error: updateErr } = await supabase
    .from("envelopes")
    .update({ status: "sent" })
    .eq("id", envelopeId)
    .eq("organization_id", orgId)
    .select("id, title, organization_id")
    .maybeSingle();

  if (updateErr) {
    console.error("[/api/envelopes/[id]/send] update error", updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 });
  }

  const invite = await inviteSigners(supabase, {
    envelopeId,
    title: (envelope as { title?: string }).title ?? "Document",
    orgId,
    lpSessionId: cur.lp_session_id,
  });
  if (!invite.ok) return NextResponse.json({ error: invite.error }, { status: 500 });
  const signingUrls = invite.signingUrls;

  // Log 'sent' audit event
  await supabase.from("envelope_events").insert({
    envelope_id: envelopeId,
    event_type: "sent",
  });

  return NextResponse.json({ ok: true, signingUrls });
}
