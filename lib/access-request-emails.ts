// Email bodies for the access-request queue.
//
// Split out of lib/access-requests.ts so the request lifecycle (validation, the
// sign-in gate, tokens, decisions) reads as logic rather than as markup. Both
// templates follow the dark house style used by lib/email and lib/admin/signup-alert.
import { escapeHtml } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import {
  APPLICANT_TYPE_LABEL,
  AUM_OPTIONS,
  STRATEGY_OPTIONS,
  labelForDetail,
  labelForDetailKey,
  type ApplicantType,
} from "@/lib/access-request-fields";

export interface AccessRequestEmailInput {
  email: string;
  fullName: string | null;
  applicantType: ApplicantType | null;
  organizationName: string | null;
  role: string | null;
  hqLocation: string | null;
  aumRange: string | null;
  fundCount: number | null;
  primaryStrategy: string | null;
  /** Type-specific answers, keyed by field name. */
  details: Record<string, string>;
  note: string | null;
  createdAt: string;
  /** One-click decision links. Omitted when a token could not be minted. */
  approveUrl?: string | null;
  declineUrl?: string | null;
}

/**
 * Internal "someone wants in" notification, with the Approve / Decline buttons.
 *
 * Both buttons open a confirmation page rather than acting on the click — see
 * the migration comment on why a GET must never grant access. The email says so
 * plainly too, so a reader knows the tap is safe and that the link is theirs
 * alone to use.
 */
export function accessRequestEmail(input: AccessRequestEmailInput): {
  subject: string;
  html: string;
} {
  const name = input.fullName?.trim() || input.email;
  const when = new Date(input.createdAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const optionLabel = (options: { value: string; label: string }[], value: string | null) =>
    value ? (options.find((o) => o.value === value)?.label ?? value) : null;

  // Built in review order: who, then their firm, then the answers their type
  // was actually asked for. A field they were never asked is omitted rather
  // than shown as a dash — an empty row reads like a gap in their answer.
  const rows: [string, string][] = [
    ["Name", input.fullName || "—"],
    ["Email", input.email],
    ["Type", input.applicantType ? APPLICANT_TYPE_LABEL[input.applicantType] : "—"],
    ["Firm", input.organizationName || "—"],
    ["Title", input.role || "—"],
  ];
  if (input.hqLocation) rows.push(["Location", input.hqLocation]);
  const aum = optionLabel(AUM_OPTIONS, input.aumRange);
  if (aum) rows.push(["AUM", aum]);
  if (input.fundCount != null) rows.push(["Funds raised", String(input.fundCount)]);
  const strategy = optionLabel(STRATEGY_OPTIONS, input.primaryStrategy);
  if (strategy) rows.push(["Strategy", strategy]);
  for (const [key, value] of Object.entries(input.details)) {
    rows.push([labelForDetailKey(key), labelForDetail(key, value)]);
  }
  rows.push(["Requested", `${when} UTC`]);
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

  const noteHtml = input.note
    ? `<p style="margin:20px 0 0;padding:12px;border-left:2px solid #F59E0B;background:#161616;font-size:14px;color:#DDDDDD;">${escapeHtml(
        input.note,
      )}</p>`
    : "";

  const actionsHtml =
    input.approveUrl && input.declineUrl
      ? `<table role="presentation" style="margin:26px 0 0;border-collapse:separate;border-spacing:0 0;">
        <tr>
          <td style="padding-right:10px;">
            <a href="${escapeHtml(input.approveUrl)}" style="display:inline-block;padding:11px 22px;border-radius:8px;background:#F59E0B;color:#0a0a0a;font-size:14px;font-weight:700;text-decoration:none;">Approve access</a>
          </td>
          <td>
            <a href="${escapeHtml(input.declineUrl)}" style="display:inline-block;padding:11px 22px;border-radius:8px;border:1px solid #333333;color:#AAAAAA;font-size:14px;font-weight:600;text-decoration:none;">Decline</a>
          </td>
        </tr>
      </table>
      <p style="margin:14px 0 0;font-size:12px;color:#666666;">Each button opens a confirmation page — nothing is granted until you confirm there. The links are single-use, expire in 14 days, and act on your behalf, so treat them like a password and don't forward this email.</p>`
      : `<p style="margin:24px 0 0;font-size:13px;color:#888888;">Approve or decline in the <a href="${SITE_URL}/admin" style="color:#F59E0B;">admin console</a>.</p>`;

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
      <h1 style="margin: 0 0 8px; font-size: 20px; color: #F5F5F5; font-weight: 700;">Access request</h1>
      <p style="margin: 0 0 20px; font-size: 15px; color: #AAAAAA;"><strong style="color:#F5F5F5;">${escapeHtml(
        name,
      )}</strong> is asking for access to FundExecs OS.</p>
      <table style="width:100%; border-collapse:collapse; border-top:1px solid #222222; padding-top:8px;">
        ${rowsHtml}
      </table>
      ${noteHtml}
      ${actionsHtml}
    </div>
    <div style="padding: 16px 24px; border-top: 1px solid #222222;">
      <p style="margin: 0; font-size: 11px; color: #555555;">You're receiving this because you're a FundExecs platform admin. The full queue lives in the <a href="${SITE_URL}/admin" style="color:#777777;">admin console</a>.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject: `Access request: ${name}`, html };
}

/** Invitation sent to the requester once a platform admin approves them. */
export function accessApprovedEmail(input: { fullName: string | null; email: string }): {
  subject: string;
  html: string;
} {
  const greeting = input.fullName?.trim()?.split(/\s+/)[0] || "there";
  const html = `<!DOCTYPE html>
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
      <h1 style="margin: 0 0 8px; font-size: 20px; color: #F5F5F5; font-weight: 700;">You're in, ${escapeHtml(
        greeting,
      )}</h1>
      <p style="margin: 0 0 20px; font-size: 15px; color: #AAAAAA;">Your access to FundExecs OS is approved. Sign in with <strong style="color:#F5F5F5;">${escapeHtml(
        input.email,
      )}</strong> and we'll walk you through setting up your firm.</p>
      <a href="${SITE_URL}/login" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#F59E0B;color:#0a0a0a;font-size:14px;font-weight:700;text-decoration:none;">Sign in</a>
    </div>
  </div>
</body>
</html>`;

  return { subject: "Your FundExecs OS access is approved", html };
}
