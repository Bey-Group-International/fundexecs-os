import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendEmail, buildSigningInvitationHtml } from "@/lib/email";
import { recipientsWithoutSignature } from "@/lib/envelope-fields";

export const runtime = "nodejs";

interface Recipient {
  id: string;
  name: string;
  email: string;
  signing_token: string;
  role: string;
}

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

  // Resolve org
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("principal_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id) {
    return NextResponse.json({ error: "No organization found" }, { status: 403 });
  }
  const orgId = membership.organization_id;

  // Update envelope status to 'sent'
  // Nothing goes out until every signer, and the owner, has a signature block to sign on.
  const [{ data: pre }, { data: placed }, { data: current }] = await Promise.all([
    supabase.from("envelope_recipients").select("id, name, role").eq("envelope_id", envelopeId),
    supabase.from("envelope_fields").select("recipient_id, field_type").eq("envelope_id", envelopeId),
    supabase.from("envelopes").select("status, pdf_storage_key").eq("id", envelopeId).eq("organization_id", orgId).maybeSingle(),
  ]);
  const cur = current as { status: string; pdf_storage_key: string | null } | null;
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

  // Fetch recipients with signing tokens
  const { data: recipients, error: recipientsErr } = await supabase
    .from("envelope_recipients")
    .select("id, name, email, signing_token, role")
    .eq("envelope_id", envelopeId);

  if (recipientsErr) {
    console.error("[/api/envelopes/[id]/send] recipients error", recipientsErr);
    return NextResponse.json({ error: recipientsErr.message }, { status: 500 });
  }

  // The owner countersigns in the app after the recipients; only signers are emailed.
  const rows = ((recipients ?? []) as Recipient[]).filter((r) => r.role !== "owner");

  // Build signing URLs
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

  const signingUrls = rows.map((r) => ({
    recipientId: r.id,
    name: r.name,
    email: r.email,
    url: `${baseUrl}/sign/${r.signing_token}`,
  }));

  // Send invitation emails from the org's own connected mailbox.
  if (rows.length > 0) {
    await Promise.allSettled(
      signingUrls.map(({ email, name, url }) =>
        sendEmail({
          orgId,
          to: { name, email },
          subject: `You have been invited to sign: ${envelope.title ?? "Document"}`,
          htmlBody: buildSigningInvitationHtml({
            recipientName: name,
            documentTitle: envelope.title ?? "Document",
            signingLink: url,
          }),
        }).then((result) => {
          if (!result.ok) {
            console.warn(`[envelopes/send] email to ${email} not sent externally (${result.detail}) — link available in-app`)
          }
        }),
      ),
    );
  }

  // Log 'sent' audit event
  await supabase.from("envelope_events").insert({
    envelope_id: envelopeId,
    event_type: "sent",
  });

  return NextResponse.json({ ok: true, signingUrls });
}
