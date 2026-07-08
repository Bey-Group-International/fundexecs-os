// New-signup alert — emails the internal team when a new user is created.
//
// Two auth paths create users (email/password sign-up and OAuth first login),
// and both should trigger exactly one alert. We guarantee that with an atomic
// claim on principals.signup_alerted_at: the UPDATE only matches rows where the
// column is still null, so whichever path runs first wins and the other no-ops.
// Everything here is best-effort and swallows errors — an email hiccup must
// never block a user from signing in.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { sendEmail, escapeHtml } from "@/lib/email";
import { adminAlertRecipients } from "@/lib/platform-admin";

/**
 * Fire the new-signup alert for `userId`, at most once ever. Safe to call from
 * multiple auth paths; the DB claim dedupes. Resolves silently on any failure.
 */
export async function notifyNewSignupOnce(userId: string): Promise<void> {
  if (!userId || !hasSupabaseServiceEnv()) return;

  try {
    const supabase = createServiceClient();

    // Atomic claim: flip signup_alerted_at from null → now(), returning the row
    // only if THIS call won the race. No row back ⇒ already alerted (or the
    // principal isn't there yet) ⇒ nothing to do.
    const { data: claimed, error } = await supabase
      .from("principals")
      .update({ signup_alerted_at: new Date().toISOString() })
      .eq("id", userId)
      .is("signup_alerted_at", null)
      .select("id, email, full_name, title, created_at")
      .maybeSingle();

    if (error || !claimed) return;

    const recipients = adminAlertRecipients();
    if (recipients.length === 0) {
      // Claim already recorded; without a destination there's nothing to send.
      console.warn(
        "[signup-alert] new signup recorded but no ADMIN_ALERT_EMAIL/ADMIN_EMAILS configured — skipping email.",
      );
      return;
    }

    // Best-effort org context — email/OAuth signups usually have no org yet
    // (onboarding creates it), so this is often null.
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("principal_id", claimed.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let orgName: string | null = null;
    if (membership?.organization_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", membership.organization_id)
        .maybeSingle();
      orgName = org?.name ?? null;
    }

    const template = newSignupEmail({
      email: claimed.email,
      fullName: claimed.full_name,
      title: claimed.title,
      createdAt: claimed.created_at,
      orgName,
      role: (membership?.role as string | null) ?? null,
    });

    // Fan out to each recipient independently so one bad address doesn't drop
    // the rest.
    await Promise.allSettled(
      recipients.map((to) =>
        sendEmail({
          to: { name: "FundExecs Admin", email: to },
          subject: template.subject,
          htmlBody: template.html,
          fromName: "FundExecs OS",
        }),
      ),
    );
  } catch (err) {
    console.error("[signup-alert] notifyNewSignupOnce failed:", err);
  }
}

interface SignupEmailInput {
  email: string;
  fullName: string | null;
  title: string | null;
  createdAt: string;
  orgName: string | null;
  role: string | null;
}

/** Internal new-signup notification email (dark, matches lib/email templates). */
export function newSignupEmail(input: SignupEmailInput): {
  subject: string;
  html: string;
} {
  const name = input.fullName?.trim() || input.email;
  const when = new Date(input.createdAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const rows: [string, string][] = [
    ["Name", input.fullName || "—"],
    ["Email", input.email],
    ["Title", input.title || "—"],
    ["Organization", input.orgName || "No org yet"],
    ["Role", input.role || "—"],
    ["Signed up", `${when} UTC`],
  ];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#888888;white-space:nowrap;">${escapeHtml(
          k,
        )}</td><td style="padding:6px 0;font-size:14px;color:#F5F5F5;">${escapeHtml(
          v,
        )}</td></tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #111111; border: 1px solid #222222; border-radius: 12px; overflow: hidden;">
    <div style="padding: 6px 24px; background: #F59E0B;">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #0a0a0a; text-transform: uppercase;">FundExecs OS · Admin</span>
    </div>
    <div style="padding: 32px 24px;">
      <h1 style="margin: 0 0 8px; font-size: 20px; color: #F5F5F5; font-weight: 700;">New signup 🎉</h1>
      <p style="margin: 0 0 20px; font-size: 15px; color: #AAAAAA;"><strong style="color:#F5F5F5;">${escapeHtml(
        name,
      )}</strong> just created an account.</p>
      <table style="width:100%; border-collapse:collapse; border-top:1px solid #222222; padding-top:8px;">
        ${rowsHtml}
      </table>
    </div>
    <div style="padding: 16px 24px; border-top: 1px solid #222222;">
      <p style="margin: 0; font-size: 11px; color: #555555;">You're receiving this because you're a FundExecs platform admin. Manage traction and activity in the admin console.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject: `New signup: ${name}`, html };
}
