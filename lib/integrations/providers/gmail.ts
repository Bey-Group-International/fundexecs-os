import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Parse a "Name <email@x.com>" header into its parts. */
function parseAddress(raw: string | undefined): { email?: string; name?: string } {
  if (!raw) return {};
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim() || undefined, email: match[2].trim().toLowerCase() };
  const email = raw.trim().toLowerCase();
  return email.includes('@') ? { email } : {};
}

/**
 * Gmail adapter. Maps recent messages into contacts + email interactions,
 * inferring direction from whether the connected user is the sender.
 * Bounded to the most recent messages to keep sync fast.
 */
export const gmailProvider: Provider = {
  id: 'gmail',
  label: 'Gmail',

  async fetchSignals({ token, userEmail }: FetchContext) {
    const auth = { Authorization: `Bearer ${token}` };
    const listRes = await fetch(`${GMAIL}/messages?maxResults=25&q=newer_than:90d`, {
      headers: auth
    });
    if (!listRes.ok) {
      throw new Error(`Gmail API error ${listRes.status}: ${await listRes.text()}`);
    }
    const list = (await listRes.json()) as { messages?: { id: string }[] };
    const self = userEmail?.toLowerCase();

    const contacts: NormalizedContact[] = [];
    const interactions: NormalizedInteraction[] = [];

    for (const { id } of list.messages ?? []) {
      const params = new URLSearchParams({ format: 'metadata' });
      ['From', 'To', 'Subject', 'Date', 'Message-ID'].forEach((h) =>
        params.append('metadataHeaders', h)
      );
      const msgRes = await fetch(`${GMAIL}/messages/${id}?${params}`, { headers: auth });
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as GmailMessage;

      const headers = new Map(
        (msg.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])
      );
      const from = parseAddress(headers.get('from'));
      const to = parseAddress(headers.get('to'));
      const outbound = from.email === self;
      const other = outbound ? to : from;
      if (!other.email || other.email === self) continue;

      const occurredAt = msg.internalDate
        ? new Date(Number(msg.internalDate)).toISOString()
        : new Date().toISOString();

      contacts.push({ email: other.email, fullName: other.name });
      interactions.push({
        contactEmail: other.email,
        type: outbound ? 'email_sent' : 'email_received',
        direction: outbound ? 'outbound' : 'inbound',
        occurredAt,
        subject: headers.get('subject') ?? '(no subject)',
        externalRef: id,
        threadId: msg.threadId,
        messageId: headers.get('message-id') ?? undefined
      });
    }

    return { contacts, interactions };
  }
};
