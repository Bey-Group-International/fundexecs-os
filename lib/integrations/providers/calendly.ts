import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

const CALENDLY = 'https://api.calendly.com';

interface CalendlyUser {
  resource?: { uri?: string };
}

interface CalendlyEvent {
  uri?: string;
  name?: string;
  status?: string;
  start_time?: string;
}

interface CalendlyInvitee {
  email?: string;
  name?: string;
  status?: string;
}

/**
 * Calendly adapter. Scheduled events become `meeting` interactions and each
 * invitee becomes a contact — booked meetings are a strong warmth signal.
 *
 * OAuth: Calendly has its own OAuth app (NOT the Google session token). Create
 * a Calendly OAuth app, store the access token on
 * `integration_connections.metadata.access_token`. The sync route resolves the
 * token from there. Scope required: read access to scheduled events/invitees.
 * Docs: https://developer.calendly.com/api-docs
 */
export const calendlyProvider: Provider = {
  id: 'calendly',
  label: 'Calendly',

  async fetchSignals({ token, since }: FetchContext) {
    const auth = { Authorization: `Bearer ${token}` };

    // Resolve the current user URI — events are scoped to it.
    const meRes = await fetch(`${CALENDLY}/users/me`, { headers: auth });
    if (!meRes.ok) {
      throw new Error(`Calendly API error ${meRes.status}: ${await meRes.text()}`);
    }
    const me = (await meRes.json()) as CalendlyUser;
    const userUri = me.resource?.uri;
    if (!userUri) {
      throw new Error('Calendly API error: could not resolve current user URI');
    }

    const params = new URLSearchParams({ user: userUri, count: '50', sort: 'start_time:desc' });
    if (since) params.set('min_start_time', new Date(since).toISOString());

    const eventsRes = await fetch(`${CALENDLY}/scheduled_events?${params}`, { headers: auth });
    if (!eventsRes.ok) {
      throw new Error(`Calendly API error ${eventsRes.status}: ${await eventsRes.text()}`);
    }
    const eventsBody = (await eventsRes.json()) as { collection?: CalendlyEvent[] };

    const contacts: NormalizedContact[] = [];
    const interactions: NormalizedInteraction[] = [];

    for (const event of eventsBody.collection ?? []) {
      if (!event.uri || !event.start_time || event.status === 'canceled') continue;

      const inviteesRes = await fetch(`${event.uri}/invitees?count=100`, { headers: auth });
      if (!inviteesRes.ok) continue;
      const invitees = (await inviteesRes.json()) as { collection?: CalendlyInvitee[] };

      const occurredAt = new Date(event.start_time).toISOString();
      for (const invitee of invitees.collection ?? []) {
        const email = invitee.email?.toLowerCase();
        if (!email || invitee.status === 'canceled') continue;

        contacts.push({ email, fullName: invitee.name });
        interactions.push({
          contactEmail: email,
          type: 'meeting',
          direction: 'internal',
          occurredAt,
          subject: event.name ?? 'Calendly meeting',
          externalRef: `${event.uri}:${email}`
        });
      }
    }

    return { contacts, interactions };
  }
};
