// lib/email.ts
// Outbound email, sent natively from the organization's own Google mailbox.
//
// There is one send path: the Gmail API, authorized per organization through
// the OAuth flow in lib/google-oauth.ts. No third-party email service sits in
// between — a message leaves the org's real mailbox, under its own domain's
// SPF/DKIM, and a reply lands back in a mailbox a human actually reads.
//
// Credential resolution, most explicit first:
//
//   1. `credentials.gmailAccessToken` — a token the caller already minted
//      (the dispatch layer does this, since it resolves the whole secret set
//      for an action in one pass).
//   2. `orgId` — a fresh access token minted from the org's vaulted refresh
//      token, else a static GMAIL_ACCESS_TOKEN stored for that org.
//   3. `GMAIL_ACCESS_TOKEN` in the deploy env — a development convenience
//      only. Google issues these with a ~1-hour life, so it is never a
//      production answer.
//
// Note the order within step 2: the minted token wins over a stored static
// one. Static Gmail tokens expire after about an hour, so preferring one would
// let a long-dead paste permanently shadow the durable OAuth credential — and
// reconnecting Google could not rescue it, since the callback writes only the
// refresh token and never clears the stale paste.
//
// With none of those, sending degrades to "in-app": the result reports
// `channel: "in-app"` and `ok: false`, and callers carry on. That is
// deliberate — an org that has not connected a mailbox yet must still be able
// to save a meeting, cancel a booking, or issue an invoice. Nothing in this
// module throws.
import { getGoogleAccessToken, googleOAuthConfigured } from "@/lib/google-oauth";
import { getOrgSecretBounded } from "@/lib/org-secrets";

export interface SendEmailCredentials {
  gmailAccessToken?: string;
  fromEmail?: string;
}

export interface SendEmailArgs {
  to: { name: string; email: string };
  subject: string;
  htmlBody: string;
  fromName?: string;
  /**
   * The organization whose mailbox sends this. Supply it wherever an org
   * context exists — without it the send can only fall back to the deploy env,
   * which in production means no send at all.
   */
  orgId?: string;
  /**
   * Explicit sender address. Gmail accepts this only when it is the connected
   * account or one of its verified send-as aliases; otherwise Gmail rewrites
   * it. Leave it unset (the normal case) and the message simply comes from the
   * connected mailbox.
   */
  fromEmail?: string;
  /** Pre-resolved credentials — wins over `orgId` lookup and the env. */
  credentials?: SendEmailCredentials;
}

export interface SendEmailResult {
  ok: boolean;
  channel: "gmail" | "in-app";
  detail: string;
}

function buildRfc2822(args: SendEmailArgs, from: string | null): string {
  const lines = [
    // No From header by default: Gmail stamps the connected account's own
    // address. Forcing one that isn't a verified alias only gets it rewritten.
    ...(from ? [`From: ${args.fromName ?? "FundExecs"} <${from}>`] : []),
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

/**
 * The access token this send should use, or null when no mailbox is connected.
 * Never throws and never hangs: a vault miss, a slow read, or a refused refresh
 * all mean "not connected", which is a normal state rather than an error.
 */
export async function resolveGmailToken(args: {
  orgId?: string;
  credentials?: SendEmailCredentials;
}): Promise<string | null> {
  if (args.credentials?.gmailAccessToken) return args.credentials.gmailAccessToken;

  if (args.orgId) {
    try {
      // The minted token first: it is always fresh, where a stored static one
      // is perishable and would otherwise shadow the OAuth credential forever.
      const minted = await getGoogleAccessToken(args.orgId);
      if (minted) return minted;
      const stored = await getOrgSecretBounded(args.orgId, "GMAIL_ACCESS_TOKEN");
      if (stored) return stored;
    } catch (err) {
      console.warn("[email] org mailbox lookup failed:", err);
    }
  }

  return process.env.GMAIL_ACCESS_TOKEN ?? null;
}

/**
 * The From address for this send, or null to let Gmail stamp the connected
 * mailbox's own. An org may store FUNDEXECS_FROM_EMAIL in the vault, so this
 * has to be resolved per-org rather than read from the deploy env alone.
 */
async function resolveFromAddress(args: SendEmailArgs): Promise<string | null> {
  if (args.fromEmail) return args.fromEmail;
  if (args.credentials?.fromEmail) return args.credentials.fromEmail;
  if (args.orgId) {
    const stored = await getOrgSecretBounded(args.orgId, "FUNDEXECS_FROM_EMAIL");
    if (stored) return stored;
  }
  return process.env.FUNDEXECS_FROM_EMAIL ?? null;
}

async function sendViaGmail(
  args: SendEmailArgs,
  token: string,
  from: string | null,
): Promise<SendEmailResult> {
  const raw = base64url(buildRfc2822(args, from));
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

export interface EmailConfigStatus {
  /** True when this org can send right now — a mailbox is connected. */
  mailboxConnected: boolean;
  /** How the credential was found, for an operator reading the self-check. */
  source: "org-oauth" | "org-token" | "deploy-env" | "none";
  /** True when the deployment can run the OAuth connect flow at all. */
  oauthConfigured: boolean;
  /** Explicit sender override, when one is set. Null means "the mailbox itself". */
  fromEmail: string | null;
  willAttemptSend: boolean;
  notes: string[];
}

/**
 * Report whether an org can actually send, WITHOUT exposing any secret value —
 * booleans, an enum, and the non-secret sender override only. Powers the email
 * self-check so an operator can confirm invites will deliver before relying on
 * them.
 */
export async function getEmailConfigStatus(orgId?: string): Promise<EmailConfigStatus> {
  const oauthConfigured = googleOAuthConfigured();
  const fromEmail = orgId ? await resolveFromAddress({ orgId } as SendEmailArgs) : process.env.FUNDEXECS_FROM_EMAIL ?? null;

  let source: EmailConfigStatus["source"] = "none";
  if (orgId) {
    try {
      // Same order the sender uses, so the self-check reports the credential a
      // real send would actually pick.
      if (await getGoogleAccessToken(orgId)) source = "org-oauth";
      else if (await getOrgSecretBounded(orgId, "GMAIL_ACCESS_TOKEN")) source = "org-token";
    } catch {
      // A vault miss is "not connected", not a failure worth surfacing here.
    }
  }
  if (source === "none" && process.env.GMAIL_ACCESS_TOKEN) source = "deploy-env";

  const notes: string[] = [];
  if (source === "none") {
    notes.push(
      oauthConfigured
        ? "No mailbox connected — email is saved in-app but not sent. Connect Google in Settings → Integrations."
        : "Google OAuth is not configured on this deployment, so no org can connect a mailbox. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and FUNDEXECS_VAULT_KEY.",
    );
  }
  if (source === "org-oauth") {
    notes.push("Sending from this organization's connected Google mailbox. Access tokens are minted per send from its vaulted refresh token.");
  }
  if (source === "org-token") {
    notes.push("Using a static GMAIL_ACCESS_TOKEN stored for this organization. Google expires these after about an hour — connect Google via OAuth for a durable credential.");
  }
  if (source === "deploy-env") {
    notes.push("Falling back to the deploy-wide GMAIL_ACCESS_TOKEN. That expires after about an hour and is shared by every org — connect Google per organization instead.");
  }
  if (fromEmail) {
    notes.push(`Messages set From: "${fromEmail}". Gmail honours this only if it is the connected account or one of its verified send-as aliases.`);
  }

  return {
    mailboxConnected: source !== "none",
    source,
    oauthConfigured,
    fromEmail,
    willAttemptSend: source !== "none",
    notes,
  };
}

/**
 * Send one message from the org's connected mailbox. Returns rather than
 * throws: `ok: false` with `channel: "in-app"` means nothing was sent, and the
 * caller's own work still stands.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const token = await resolveGmailToken(args);
  if (!token) {
    return { ok: false, channel: "in-app", detail: "no mailbox connected" };
  }

  try {
    const result = await sendViaGmail(args, token, await resolveFromAddress(args));
    if (!result.ok) console.warn("[email] Gmail send failed:", result.detail);
    return result;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "gmail request failed";
    console.warn("[email] Gmail send threw:", detail);
    return { ok: false, channel: "gmail", detail };
  }
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


export function invoiceReceiptEmail(args: {
  merchantName: string;
  invoiceTitle: string;
  invoiceNumber: string | null;
  amountFormatted: string; // e.g. "$25.00"
  paidOn: string; // human date, e.g. "Jul 6, 2026"
  lineItems: { description: string; quantity: number; unitFormatted: string; subtotalFormatted: string }[];
}): EmailTemplate {
  const merchant = escapeHtml(args.merchantName);
  const title = escapeHtml(args.invoiceTitle);
  const number = args.invoiceNumber ? escapeHtml(args.invoiceNumber) : null;
  const amount = escapeHtml(args.amountFormatted);
  const paidOn = escapeHtml(args.paidOn);
  const heading = number ? `${number} — ${title}` : title;
  const rows = args.lineItems
    .map(
      (li) =>
        `<tr><td style="padding: 6px 0; font-size: 14px; color: #AAAAAA;">${escapeHtml(li.description)} · ${escapeHtml(String(li.quantity))} × ${escapeHtml(li.unitFormatted)}</td><td style="padding: 6px 0; font-size: 14px; color: #F5F5F5; text-align: right; white-space: nowrap;">${escapeHtml(li.subtotalFormatted)}</td></tr>`,
    )
    .join("");
  const body = `
    <h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">Payment received</h1>
    <p style="margin: 0 0 4px; font-size: 15px; color: #AAAAAA;">Thanks — your payment to <strong style="color: #F5F5F5;">${merchant}</strong> has been received.</p>
    <p style="margin: 0 0 20px; font-size: 14px; color: #888888;">${escapeHtml(heading)}</p>
    <table style="width: 100%; border-collapse: collapse; border-top: 1px solid #222222;">
      ${rows}
      <tr><td style="padding: 12px 0 0; border-top: 1px solid #222222; font-size: 15px; color: #F5F5F5; font-weight: 700;">Total</td><td style="padding: 12px 0 0; border-top: 1px solid #222222; font-size: 15px; color: #F59E0B; font-weight: 700; text-align: right;">${amount}</td></tr>
    </table>
    <p style="margin: 20px 0 0; font-size: 13px; color: #888888;">Paid on ${paidOn}.</p>`;
  return {
    subject: `Receipt: ${args.invoiceNumber ?? args.invoiceTitle} — ${args.merchantName}`,
    html: lpBaseHtml(body),
  };
}

export function invoiceCreatedEmail(args: {
  merchantName: string;
  invoiceTitle: string;
  invoiceNumber: string | null;
  amountFormatted: string;
  payUrl: string;
}): EmailTemplate {
  const merchant = escapeHtml(args.merchantName);
  const title = escapeHtml(args.invoiceTitle);
  const number = args.invoiceNumber ? escapeHtml(args.invoiceNumber) : null;
  const amount = escapeHtml(args.amountFormatted);
  const heading = number ? `${number} — ${title}` : title;
  // payUrl must be a valid https URL; only surface the button/link when it is.
  const isHttps = /^https:\/\//i.test(args.payUrl);
  const button = isHttps ? goldButton(args.payUrl, "Pay invoice") : "";
  const linkLine = isHttps
    ? `<p style="margin: 20px 0 0; font-size: 12px; color: #555555;">Or copy this link: <a href="${escapeHtml(args.payUrl)}" style="color: #F59E0B;">${escapeHtml(args.payUrl)}</a></p>`
    : "";
  const body = `
    <h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">You have an invoice from ${merchant}</h1>
    <p style="margin: 0; font-size: 15px; color: #AAAAAA;"><strong style="color: #F5F5F5;">${escapeHtml(heading)}</strong> for <strong style="color: #F5F5F5;">${amount}</strong>.</p>
    ${button}
    ${linkLine}`;
  return {
    subject: `Invoice ${args.invoiceNumber ?? args.invoiceTitle} — ${args.merchantName}`,
    html: lpBaseHtml(body),
  };
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
