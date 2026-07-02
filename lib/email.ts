// Unified email sender: Gmail API → Resend → in-app only.
// Priority: Gmail (when GMAIL_ACCESS_TOKEN is set) → Resend (when RESEND_API_KEY is set) → silent fallback.

export interface SendEmailArgs {
  to: { name: string; email: string };
  subject: string;
  htmlBody: string;
  fromName?: string;
  fromEmail?: string;
}

export interface SendEmailResult {
  ok: boolean;
  channel: "gmail" | "resend" | "in-app";
  detail: string;
}

function buildRfc2822(args: SendEmailArgs): string {
  const from = `${args.fromName ?? "FundExecs"} <${args.fromEmail ?? (process.env.RESEND_FROM_EMAIL ?? "noreply@fundexecs.com")}>`;
  const lines = [
    `From: ${from}`,
    `To: ${args.to.name} <${args.to.email}>`,
    `Subject: ${args.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    args.htmlBody,
  ];
  return lines.join("\r\n");
}

function base64url(str: string): string {
  const b64 = Buffer.from(str).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function sendViaGmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const token = process.env.GMAIL_ACCESS_TOKEN;
  if (!token) return { ok: false, channel: "gmail", detail: "no token" };

  const raw = base64url(buildRfc2822(args));
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    return { ok: false, channel: "gmail", detail: text };
  }
  return { ok: true, channel: "gmail", detail: "sent" };
}

async function sendViaResend(args: SendEmailArgs): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, channel: "resend", detail: "no key" };

  const from = `${args.fromName ?? "FundExecs"} <${args.fromEmail ?? (process.env.RESEND_FROM_EMAIL ?? "noreply@fundexecs.com")}>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to.email,
      subject: args.subject,
      html: args.htmlBody,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    return { ok: false, channel: "resend", detail: text };
  }
  return { ok: true, channel: "resend", detail: "sent" };
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  if (process.env.GMAIL_ACCESS_TOKEN) {
    const result = await sendViaGmail(args);
    if (result.ok) return result;
    console.warn("[email] Gmail send failed, falling back to Resend:", result.detail);
  }

  if (process.env.RESEND_API_KEY) {
    const result = await sendViaResend(args);
    if (result.ok) return result;
    console.warn("[email] Resend send failed:", result.detail);
  }

  return { ok: false, channel: "in-app", detail: "no email provider configured" };
}


// ---------------------------------------------------------------------------
// LP email template helpers
// ---------------------------------------------------------------------------

export interface EmailTemplate {
  subject: string;
  html: string;
}

function lpBaseHtml(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #111111; border: 1px solid #222222; border-radius: 12px; overflow: hidden;">
    <div style="padding: 6px 24px; background: #F59E0B;">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #0a0a0a; text-transform: uppercase;">FundExecs OS</span>
    </div>
    <div style="padding: 32px 24px;">
      ${body}
    </div>
    <div style="padding: 16px 24px; border-top: 1px solid #222222;">
      <p style="margin: 0; font-size: 11px; color: #555555;">You received this message because you were granted access to a data room on FundExecs OS. If this was unexpected, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}

function goldButton(href: string, text: string): string {
  const safe = /^https?:\/\//i.test(href) ? href : "#";
  return `<a href="${escapeHtml(safe)}" style="display: inline-block; background: #F59E0B; color: #0a0a0a; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; margin-top: 24px;">${escapeHtml(text)}</a>`;
}

export function shareGrantedEmail(
  orgName: string,
  shareLabel: string | null,
  shareUrl: string,
  expiresAt: string | null,
): EmailTemplate {
  const org = escapeHtml(orgName);
  const label = escapeHtml(shareLabel ?? "Data Room");
  const expiry = expiresAt
    ? `<p style="font-size: 13px; color: #888888; margin: 16px 0 0;">This link expires on ${escapeHtml(new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}.</p>`
    : "";
  const body = `
    <h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">${org} shared a data room with you</h1>
    <p style="margin: 0; font-size: 15px; color: #AAAAAA;">You've been granted access to <strong style="color: #F5F5F5;">${label}</strong>. Click below to view documents, financials, and fund materials.</p>
    ${goldButton(shareUrl, "Open Data Room")}
    ${expiry}
    <p style="margin: 20px 0 0; font-size: 12px; color: #555555;">Or copy this link: <a href="${escapeHtml(shareUrl)}" style="color: #F59E0B;">${escapeHtml(shareUrl)}</a></p>`;
  return { subject: `${orgName} shared their data room with you`, html: lpBaseHtml(body) };
}

export function documentUpdatedEmail(
  orgName: string,
  docName: string,
  shareUrl: string,
): EmailTemplate {
  const org = escapeHtml(orgName);
  const doc = escapeHtml(docName);
  const body = `
    <h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">Document updated</h1>
    <p style="margin: 0; font-size: 15px; color: #AAAAAA;"><strong style="color: #F5F5F5;">${org}</strong> has updated <strong style="color: #F5F5F5;">${doc}</strong> in your shared data room.</p>
    ${goldButton(shareUrl, "View Data Room")}`;
  return { subject: `${orgName} updated a document — ${docName}`, html: lpBaseHtml(body) };
}

export function fundUpdateEmail(
  orgName: string,
  updateTitle: string,
  previewText: string,
  shareUrl: string,
): EmailTemplate {
  const org = escapeHtml(orgName);
  const title = escapeHtml(updateTitle);
  const preview = escapeHtml(previewText);
  const body = `
    <h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">Fund update from ${org}</h1>
    <h2 style="margin: 0 0 12px; font-size: 16px; color: #F59E0B; font-weight: 600;">${title}</h2>
    <p style="margin: 0; font-size: 15px; color: #AAAAAA; line-height: 1.6;">${preview}</p>
    ${goldButton(shareUrl, "Read Full Update")}`;
  return { subject: `Fund update: ${updateTitle} — ${orgName}`, html: lpBaseHtml(body) };
}

export function documentReadyEmail(
  orgName: string,
  docName: string,
  shareUrl: string,
): EmailTemplate {
  const org = escapeHtml(orgName);
  const doc = escapeHtml(docName);
  const body = `
    <h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">Your requested document is ready</h1>
    <p style="margin: 0; font-size: 15px; color: #AAAAAA;"><strong style="color: #F5F5F5;">${org}</strong> has fulfilled your document request: <strong style="color: #F5F5F5;">${doc}</strong> is now available in your data room.</p>
    ${goldButton(shareUrl, "View Document")}`;
  return { subject: `Document ready: ${docName} — ${orgName}`, html: lpBaseHtml(body) };
}


export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSigningInvitationHtml(args: {
  recipientName: string;
  documentTitle: string;
  message?: string | null;
  signingLink: string;
}): string {
  const name = escapeHtml(args.recipientName);
  const title = escapeHtml(args.documentTitle);
  const msg = args.message ? escapeHtml(args.message) : null;
  // signingLink must be a valid https URL; reject anything else to prevent javascript: injection.
  const safeLink = /^https:\/\//i.test(args.signingLink) ? args.signingLink : "#";
  const linkEscaped = escapeHtml(safeLink);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: sans-serif; background: #f9fafb; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="font-size: 20px; color: #111827; margin: 0 0 16px;">You have a document to sign</h1>
    <p style="color: #374151; font-size: 15px; margin: 0 0 8px;">Hi ${name},</p>
    <p style="color: #374151; font-size: 15px; margin: 0 0 24px;">
      You have been asked to review and sign: <strong>${title}</strong>.
    </p>
    ${msg ? `<p style="color: #6b7280; font-size: 14px; background: #f3f4f6; border-left: 3px solid #d1d5db; padding: 12px 16px; margin: 0 0 24px; border-radius: 4px;">${msg}</p>` : ""}
    <a href="${linkEscaped}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 15px; font-weight: 600;">
      Review &amp; Sign Document
    </a>
    <p style="color: #9ca3af; font-size: 12px; margin: 32px 0 0;">
      If the button doesn't work, copy and paste this link into your browser:<br />
      <a href="${linkEscaped}" style="color: #2563eb;">${linkEscaped}</a>
    </p>
  </div>
</body>
</html>`;
}
