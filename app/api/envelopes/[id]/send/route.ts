import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendEmail, buildSigningInvitationHtml } from "@/lib/email";

export const runtime = "nodejs";

interface Recipient {
  id: string;
  name: string;
  email: string;
  signing_token: string;
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const envelopeId = params.id;
  const supabase = createServerClient();

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
    .select("id, name, email, signing_token")
    .eq("envelope_id", envelopeId);

  if (recipientsErr) {
    console.error("[/api/envelopes/[id]/send] recipients error", recipientsErr);
    return NextResponse.json({ error: recipientsErr.message }, { status: 500 });
  }

  const rows = (recipients ?? []) as Recipient[];

  // Build signing URLs
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

  const signingUrls = rows.map((r) => ({
    recipientId: r.id,
    name: r.name,
    email: r.email,
    url: `${baseUrl}/sign/${r.signing_token}`,
  }));

  // Send invitation emails via Gmail or Resend
  if (rows.length > 0) {
    await Promise.allSettled(
      signingUrls.map(({ email, name, url }) =>
        sendEmail({
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
