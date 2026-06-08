import 'server-only';

/* ============================================================================
 * lib/email/send.ts — minimal transactional email via Resend's REST API.
 *
 * Called over HTTP (no SDK dependency). Env-gated: when `RESEND_API_KEY` is
 * absent it returns `{ sent: false, reason: 'not_configured' }` so callers can
 * degrade gracefully (e.g. the gift buyer still gets a copyable redeem link).
 *
 * Env:
 *   RESEND_API_KEY   — Resend API key (required to actually send)
 *   EMAIL_FROM       — From header, e.g. "FundExecs <gifts@fundexecs.com>"
 * ========================================================================= */

export interface SendEmailResult {
  sent: boolean;
  reason?: string;
}

const DEFAULT_FROM = 'FundExecs <gifts@fundexecs.com>';

/** Send a single transactional email. No-op (sent:false) when unconfigured. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'not_configured' };

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { sent: false, reason: detail || `status ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : 'send failed' };
  }
}

/** Render + send the gift-notification email to the recipient. */
export async function sendGiftEmail(opts: {
  to: string;
  recipientName?: string | null;
  senderName?: string | null;
  credits: number;
  message?: string | null;
  redeemUrl: string;
}): Promise<SendEmailResult> {
  const who = opts.recipientName?.trim() || 'there';
  const from = opts.senderName?.trim() || 'Someone';
  const credits = opts.credits.toLocaleString();
  const note = opts.message?.trim();

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
    <h1 style="font-size:20px;margin:0 0 8px">You've received a FundExecs gift 🎁</h1>
    <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 16px">
      Hi ${escapeHtml(who)}, ${escapeHtml(from)} sent you <strong>${credits} Earn credits</strong> on FundExecs OS —
      fuel for your AI Chief Operating Officer.
    </p>
    ${
      note
        ? `<blockquote style="border-left:3px solid #f7c948;margin:0 0 16px;padding:8px 14px;background:#fffbea;font-size:14px;color:#475569">${escapeHtml(
            note
          )}</blockquote>`
        : ''
    }
    <p style="margin:0 0 24px">
      <a href="${opts.redeemUrl}" style="display:inline-block;background:#2152d8;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px">
        Redeem your credits
      </a>
    </p>
    <p style="font-size:12px;color:#94a3b8;margin:0">
      Or paste this link into your browser:<br/>
      <span style="word-break:break-all">${opts.redeemUrl}</span>
    </p>
  </div>`;

  const text = `You've received a FundExecs gift!\n\n${from} sent you ${credits} Earn credits on FundExecs OS.${
    note ? `\n\n"${note}"` : ''
  }\n\nRedeem your credits: ${opts.redeemUrl}`;

  return sendEmail({
    to: opts.to,
    subject: `${from} sent you ${credits} FundExecs credits`,
    html,
    text
  });
}

/** Escape the small set of characters that matter inside our HTML email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
