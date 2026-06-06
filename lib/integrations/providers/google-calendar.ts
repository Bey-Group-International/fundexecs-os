import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

interface GoogleAttendee {
  email?: string;
  displayName?: string;
  self?: boolean;
  resource?: boolean;
  responseStatus?: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: GoogleAttendee[];
}

/**
 * Google Calendar adapter. Each external attendee on an event becomes a
 * contact + a `meeting` interaction — meetings are a strong warmth signal.
 * Uses the stored Google OAuth access token from private.integration_secrets.
 */
export const googleCalendarProvider: Provider = {
  id: 'google_calendar',
  label: 'Google Calendar',

  async fetchSignals({ token, since, userEmail }: FetchContext) {
    const params = new URLSearchParams({
      maxResults: '50',
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      throw new Error(`Google Calendar API error ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { items?: GoogleEvent[] };

    const contacts: NormalizedContact[] = [];
    const interactions: NormalizedInteraction[] = [];
    const self = userEmail?.toLowerCase();

    for (const event of body.items ?? []) {
      if (event.status === 'cancelled') continue;
      const occurredAt = event.start?.dateTime ?? event.start?.date;
      if (!occurredAt) continue;

      for (const attendee of event.attendees ?? []) {
        const email = attendee.email?.toLowerCase();
        if (!email || attendee.self || attendee.resource || email === self) continue;

        contacts.push({ email, fullName: attendee.displayName });
        interactions.push({
          contactEmail: email,
          type: 'meeting',
          direction: 'internal',
          occurredAt: new Date(occurredAt).toISOString(),
          subject: event.summary ?? 'Meeting',
          externalRef: `${event.id}:${email}`
        });
      }
    }

    return { contacts, interactions };
  }
};
