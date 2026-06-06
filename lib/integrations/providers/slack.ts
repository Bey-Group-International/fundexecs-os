import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

const SLACK = 'https://slack.com/api';

interface SlackConversation {
  id?: string;
  user?: string;
}

interface SlackMessage {
  type?: string;
  user?: string;
  text?: string;
  ts?: string;
  subtype?: string;
}

interface SlackUser {
  id?: string;
  real_name?: string;
  profile?: { email?: string; real_name?: string };
}

/**
 * Slack adapter. Direct messages become `message` interactions and the DM
 * counterpart becomes a contact. Best-effort: we map what the Web API returns
 * and resolve emails via users.info where available.
 *
 * OAuth: Slack has its own OAuth app. The connect route requests user scopes
 * (`im:history`, `im:read`, `users:read`, `users:read.email`) and stores the
 * resulting access token in private.integration_secrets.
 */
export const slackProvider: Provider = {
  id: 'slack',
  label: 'Slack',

  async fetchSignals({ token, since, userEmail }: FetchContext) {
    const auth = { Authorization: `Bearer ${token}` };
    const self = userEmail?.toLowerCase();

    // List open DM conversations.
    const listRes = await fetch(`${SLACK}/conversations.list?types=im&limit=50`, { headers: auth });
    if (!listRes.ok) {
      throw new Error(`Slack API error ${listRes.status}: ${await listRes.text()}`);
    }
    const listBody = (await listRes.json()) as {
      ok?: boolean;
      error?: string;
      channels?: SlackConversation[];
    };
    if (!listBody.ok) {
      throw new Error(`Slack API error: ${listBody.error ?? 'conversations.list failed'}`);
    }

    const contacts: NormalizedContact[] = [];
    const interactions: NormalizedInteraction[] = [];
    const userCache = new Map<string, SlackUser | null>();
    const oldest = since ? String(new Date(since).getTime() / 1000) : undefined;

    async function resolveUser(userId: string): Promise<SlackUser | null> {
      if (userCache.has(userId)) return userCache.get(userId) ?? null;
      const res = await fetch(`${SLACK}/users.info?user=${encodeURIComponent(userId)}`, {
        headers: auth
      });
      let user: SlackUser | null = null;
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; user?: SlackUser };
        if (body.ok) user = body.user ?? null;
      }
      userCache.set(userId, user);
      return user;
    }

    for (const channel of listBody.channels ?? []) {
      if (!channel.id || !channel.user) continue;

      const counterpart = await resolveUser(channel.user);
      const email = counterpart?.profile?.email?.toLowerCase();
      const fullName = counterpart?.profile?.real_name ?? counterpart?.real_name;
      if (email && email !== self) {
        contacts.push({ email, fullName });
      }

      const histParams = new URLSearchParams({ channel: channel.id, limit: '50' });
      if (oldest) histParams.set('oldest', oldest);
      const histRes = await fetch(`${SLACK}/conversations.history?${histParams}`, {
        headers: auth
      });
      if (!histRes.ok) continue;
      const histBody = (await histRes.json()) as {
        ok?: boolean;
        messages?: SlackMessage[];
      };
      if (!histBody.ok) continue;

      for (const msg of histBody.messages ?? []) {
        if (msg.subtype || !msg.ts) continue;
        // A message from the DM counterpart is inbound, one from us is outbound.
        const fromCounterpart = msg.user === channel.user;
        interactions.push({
          contactEmail: email && email !== self ? email : undefined,
          type: 'message',
          direction: fromCounterpart ? 'inbound' : 'outbound',
          occurredAt: new Date(Number(msg.ts) * 1000).toISOString(),
          subject: 'Slack DM',
          summary: msg.text?.slice(0, 280),
          externalRef: `${channel.id}:${msg.ts}`
        });
      }
    }

    return { contacts, interactions };
  }
};
