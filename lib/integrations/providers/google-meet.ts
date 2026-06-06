import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

interface GoogleAttendee {
  email?: string;
  displayName?: string;
  self?: boolean;
  resource?: boolean;
}

interface GoogleConferenceData {
  conferenceSolution?: { key?: { type?: string } };
}

interface GoogleEvent {
  id: string;
  summary?: string;
  status?: string;
  hangoutLink?: string;
  conferenceData?: GoogleConferenceData;
  start?: { dateTime?: string; date?: string };
  attendees?: GoogleAttendee[];
}

/** A calendar event is a Meet call if it carries a hangout link or a Meet
 * conference solution. */
function isMeetEvent(event: GoogleEvent): boolean {
  if (event.hangoutLink) return true;
  return event.conferenceData?.conferenceSolution?.key?.type === 'hangoutsMeet';
}

/**
 * Google Meet adapter. Meet calls surface as Google Calendar events that carry
 * a Meet link (`hangoutLink` / `conferenceData`), so this reuses the existing
 * `calendar.readonly` scope already granted at Google sign-in — no extra
 * consent. Each external attendee on a Meet-backed event becomes a contact +
 * a `meeting` interaction.
 */
export const googleMeetProvider: Provider = {
  id: 'google_meet',
  label: 'Google Meet',

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
      throw new Error(`Google Meet API error ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { items?: GoogleEvent[] };

    const contacts: NormalizedContact[] = [];
    const interactions: NormalizedInteraction[] = [];
    const self = userEmail?.toLowerCase();

    for (const event of body.items ?? []) {
      if (event.status === 'cancelled' || !isMeetEvent(event)) continue;
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
          subject: event.summary ? `Google Meet: ${event.summary}` : 'Google Meet',
          externalRef: `meet:${event.id}:${email}`
        });
      }
    }

    return { contacts, interactions };
  }
};
