import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

const GRAPH = 'https://graph.microsoft.com/v1.0';

interface GraphEmailAddress {
  address?: string;
  name?: string;
}

interface GraphAttendee {
  emailAddress?: GraphEmailAddress;
  type?: string;
}

interface GraphEvent {
  id: string;
  subject?: string;
  isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  attendees?: GraphAttendee[];
}

/**
 * Outlook Calendar adapter (Microsoft Graph). Mirrors google-calendar.ts: each
 * external attendee becomes a contact + a `meeting` interaction.
 *
 * OAuth: Microsoft has its own OAuth app. If this provider is re-enabled in
 * the catalog, store the Graph access token in private.integration_secrets.
 * Docs: https://learn.microsoft.com/graph/api/user-list-events
 */
export const outlookCalendarProvider: Provider = {
  id: 'outlook_calendar',
  label: 'Outlook Calendar',

  async fetchSignals({ token, since, userEmail }: FetchContext) {
    const params = new URLSearchParams({
      $top: '50',
      $orderby: 'start/dateTime desc',
      $select: 'id,subject,isCancelled,start,attendees'
    });
    const timeMin = since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    params.set('$filter', `start/dateTime ge '${new Date(timeMin).toISOString()}'`);

    const res = await fetch(`${GRAPH}/me/events?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"'
      }
    });
    if (!res.ok) {
      throw new Error(`Microsoft Graph API error ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { value?: GraphEvent[] };

    const contacts: NormalizedContact[] = [];
    const interactions: NormalizedInteraction[] = [];
    const self = userEmail?.toLowerCase();

    for (const event of body.value ?? []) {
      if (event.isCancelled) continue;
      const occurredAt = event.start?.dateTime;
      if (!occurredAt) continue;

      for (const attendee of event.attendees ?? []) {
        if (attendee.type === 'resource') continue;
        const email = attendee.emailAddress?.address?.toLowerCase();
        if (!email || email === self) continue;

        contacts.push({ email, fullName: attendee.emailAddress?.name });
        interactions.push({
          contactEmail: email,
          type: 'meeting',
          direction: 'internal',
          occurredAt: new Date(occurredAt).toISOString(),
          subject: event.subject ?? 'Meeting',
          externalRef: `${event.id}:${email}`
        });
      }
    }

    return { contacts, interactions };
  }
};
