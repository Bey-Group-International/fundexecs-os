import 'server-only';

/* ============================================================================
 * lib/inbox/send.ts — channel send primitives for the Relationship Inbox (P3).
 *
 * Thin, dependency-free wrappers over the Gmail send + Slack chat.postMessage
 * APIs. Each takes an already-resolved access token and returns a typed result
 * — token resolution, refresh, authorization and the inbox_items status update
 * live in the server action. Sending requires the gmail.send / chat:write
 * scopes added in P3; a token without them returns a `reconnect`-flavoured
 * error the UI can surface.
 * ========================================================================= */

export interface SendResult {
  ok: boolean;
  /** Stable reason code for the UI (e.g. 'missing_scope', 'send_failed'). */
  reason?: string;
  error?: string;
}

/** Base64url-encode a UTF-8 string for the Gmail raw message field. */
function base64Url(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Send an email reply via the Gmail API (users.messages.send). `threadId`,
 * when known, threads the reply onto the original conversation.
 */
export async function sendGmailReply(opts: {
  token: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
}): Promise<SendResult> {
  const subject = opts.subject.toLowerCase().startsWith('re:')
    ? opts.subject
    : `Re: ${opts.subject}`;

  const mime = [
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    opts.body
  ].join('\r\n');

  const payload: { raw: string; threadId?: string } = { raw: base64Url(mime) };
  if (opts.threadId) payload.threadId = opts.threadId;

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) return { ok: true };

  // 403 with an insufficient-scope body means the connection predates the
  // gmail.send scope — the UI should prompt a reconnect.
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      reason: 'missing_scope',
      error: 'Reconnect Gmail to grant send permission.'
    };
  }
  return { ok: false, reason: 'send_failed', error: `Gmail send failed (${res.status}).` };
}

/**
 * Post a reply into a Slack DM channel via chat.postMessage. The channel id is
 * the first segment of the inbox item's external_id (`<channel>:<ts>`).
 */
export async function sendSlackReply(opts: {
  token: string;
  channel: string;
  text: string;
}): Promise<SendResult> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({ channel: opts.channel, text: opts.text })
  });

  if (!res.ok)
    return { ok: false, reason: 'send_failed', error: `Slack send failed (${res.status}).` };

  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (body.ok) return { ok: true };

  if (
    body.error === 'missing_scope' ||
    body.error === 'not_authed' ||
    body.error === 'invalid_auth'
  ) {
    return {
      ok: false,
      reason: 'missing_scope',
      error: 'Reconnect Slack to grant send permission.'
    };
  }
  return {
    ok: false,
    reason: 'send_failed',
    error: `Slack send failed: ${body.error ?? 'unknown'}.`
  };
}
