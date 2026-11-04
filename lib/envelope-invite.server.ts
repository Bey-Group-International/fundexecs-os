// lib/envelope-invite.server.ts
//
// Emailing the people who have to sign: used when an envelope is first sent and when the
// owner sends the reminder again. An LP's agreement is signed inside their portal (behind its
// emailed-code check), so they are sent the portal link, never the bare signing link.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, buildSigningInvitationHtml } from "@/lib/email";

interface Row {
  id: string;
  name: string;
  email: string;
  signing_token: string;
  role: string;
  status: string;
}

export interface InviteResult {
  ok: boolean;
  error?: string;
  signingUrls: { recipientId: string; name: string; email: string; url: string }[];
}

/**
 * Emails each signer their link. The owner countersigns in the app, so is never emailed here.
 * `onlyWaiting` leaves out anyone who has already signed or declined (a reminder).
 */
export async function inviteSigners(
  supabase: SupabaseClient,
  input: { envelopeId: string; title: string; orgId: string; lpSessionId: string | null; onlyWaiting?: boolean },
): Promise<InviteResult> {
  const { data: recipients, error } = await supabase
    .from("envelope_recipients")
    .select("id, name, email, signing_token, role, status")
    .eq("envelope_id", input.envelopeId);
  if (error) {
    console.error("[envelope-invite] recipients error", error);
    return { ok: false, error: error.message, signingUrls: [] };
  }

  const rows = ((recipients ?? []) as Row[]).filter(
    (r) => r.role !== "owner" && (!input.onlyWaiting || (r.status !== "signed" && r.status !== "declined")),
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  let portalUrl: string | null = null;
  if (input.lpSessionId) {
    const { createServiceClient } = await import("@/lib/supabase/server");
    const { data: sess } = await createServiceClient().from("lp_onboarding_sessions").select("token").eq("id", input.lpSessionId).maybeSingle();
    const t = (sess as { token: string } | null)?.token;
    if (t) portalUrl = `${baseUrl}/lp/${t}`;
  }

  const signingUrls = rows.map((r) => ({
    recipientId: r.id,
    name: r.name,
    email: r.email,
    url: portalUrl ?? `${baseUrl}/sign/${r.signing_token}`,
  }));

  await Promise.allSettled(
    signingUrls.map(({ email, name, url }) =>
      sendEmail({
        orgId: input.orgId,
        to: { name, email },
        subject: portalUrl ? "Your subscription agreement is ready to sign" : `You have been invited to sign: ${input.title || "Document"}`,
        htmlBody: buildSigningInvitationHtml({ recipientName: name, documentTitle: input.title || "Document", signingLink: url }),
      }).then((result) => {
        if (!result.ok) {
          console.warn(`[envelope-invite] email to ${email} not sent externally (${result.detail}): link available in-app`);
        }
      }),
    ),
  );
  return { ok: true, signingUrls };
}
