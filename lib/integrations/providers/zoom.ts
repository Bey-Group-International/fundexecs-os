import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

const ZOOM = 'https://api.zoom.us/v2';

interface ZoomMeeting {
  id?: number | string;
  uuid?: string;
  topic?: string;
  start_time?: string;
}

interface ZoomRegistrant {
  email?: string;
  first_name?: string;
  last_name?: string;
  status?: string;
}

/**
 * Zoom adapter. The host's meetings become `meeting` interactions and each
 * registrant becomes a contact — booked/attended calls are a strong warmth
 * signal. Registrant emails are only available when the meeting has
 * registration enabled, so meetings without resolvable participants are
 * skipped (best-effort; no noisy contactless rows).
 *
 * OAuth: Zoom has its own OAuth app (ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET). The
 * connect callback stores access + refresh tokens in private.integration_secrets;
 * sync receives only the resolved access token. Default scopes:
 * user:read:user, meeting:read:list_meetings, meeting:read:list_registrants.
 */
export const zoomProvider: Provider = {
  id: 'zoom',
  label: 'Zoom',

  async fetchSignals({ token, since }: FetchContext) {
    const auth = { Authorization: `Bearer ${token}` };

    const params = new URLSearchParams({ type: 'previous_meetings', page_size: '50' });
    const meetingsRes = await fetch(`${ZOOM}/users/me/meetings?${params}`, { headers: auth });
    if (!meetingsRes.ok) {
      throw new Error(`Zoom API error ${meetingsRes.status}: ${await meetingsRes.text()}`);
    }
    const meetingsBody = (await meetingsRes.json()) as { meetings?: ZoomMeeting[] };
    const sinceMs = since ? new Date(since).getTime() : null;

    const contacts: NormalizedContact[] = [];
    const interactions: NormalizedInteraction[] = [];

    for (const meeting of meetingsBody.meetings ?? []) {
      if (meeting.id == null || !meeting.start_time) continue;
      const startMs = new Date(meeting.start_time).getTime();
      if (sinceMs && Number.isFinite(startMs) && startMs <= sinceMs) continue;
      const occurredAt = new Date(meeting.start_time).toISOString();

      // Registrant emails are only present when registration is enabled — a 400
      // here just means no roster, so skip the meeting rather than failing sync.
      const regRes = await fetch(`${ZOOM}/meetings/${meeting.id}/registrants?page_size=100`, {
        headers: auth
      });
      if (!regRes.ok) continue;
      const registrants = (await regRes.json()) as { registrants?: ZoomRegistrant[] };

      for (const registrant of registrants.registrants ?? []) {
        const email = registrant.email?.toLowerCase();
        if (!email || registrant.status === 'denied') continue;

        const fullName = [registrant.first_name, registrant.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();
        contacts.push({ email, fullName: fullName || undefined });
        interactions.push({
          contactEmail: email,
          type: 'meeting',
          direction: 'internal',
          occurredAt,
          subject: meeting.topic ? `Zoom: ${meeting.topic}` : 'Zoom meeting',
          externalRef: `zoom:${meeting.uuid ?? meeting.id}:${email}`
        });
      }
    }

    return { contacts, interactions };
  }
};
