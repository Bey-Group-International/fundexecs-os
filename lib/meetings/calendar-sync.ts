// lib/meetings/calendar-sync.ts
// Whether a scheduled meeting belongs on the host's own calendar.
//
// It did not get there, and the reason was never a failure: nothing ever asked.
// `syncMeetingExternal` ran only when the request carried BOTH
// `externalCalendarSyncEnabled` and `externalCalendarProvider`, and both came
// from a checkbox and a dropdown inside a COLLAPSED "Advanced options" section
// that defaults to off. Schedule a meeting the ordinary way and no push was
// ever attempted — so a host with a perfectly good Google connection saw their
// meetings stay out of their calendar forever, with nothing wrong anywhere.
//
// The connection is the better signal, and the app already computes it:
// `providerSyncAvailable` in /api/meetings/calendar-status resolves the same
// write target the push path uses — a grant PLUS a calendar this member owns or
// can write to, because read access would 403 on every write. If that is true,
// the meeting goes on their calendar. The checkbox becomes what it should
// always have been: a way to keep one meeting OFF it.
//
// Pure: no supabase client, no Google, no DOM.

/**
 * The only provider a meeting can actually be written to.
 *
 * `EXTERNAL_CALENDAR_PROVIDERS` in schedule.ts lists four, and the form offered
 * all four — but `pushMeetingToGoogle` is the only writer in the codebase, so
 * choosing Outlook, Calendly or iCal enabled a "sync" that then wrote to Google
 * or skipped entirely. A dropdown that cannot keep three of its four promises is
 * worse than one option and an honest sentence about the rest.
 */
export const SYNCABLE_PROVIDER = "google_calendar";

/** Whether a stored provider value names something this app can write to. */
export function isWritableProvider(provider: string | null | undefined): boolean {
  return provider === SYNCABLE_PROVIDER;
}

export interface CalendarSyncPlan {
  /**
   * What to store on the meeting row.
   *
   * `decideWrite` reads `external_calendar_sync_enabled` and refuses anything
   * that is not exactly `true`, so this is the flag that decides whether the
   * meeting has an event on Google at all — now and on every later edit.
   */
  enabled: boolean;
  /** What to store as the provider. Null when nothing will be written. */
  provider: string | null;
  /** Whether to push to the calendar as part of THIS save. */
  push: boolean;
  /**
   * Why it is not being pushed, when a host might reasonably expect it to be.
   *
   * Null when there is nothing to explain: a draft is not finished, and an
   * explicit opt-out is the host's own choice. Only the case they cannot see —
   * no calendar connected — earns a sentence.
   */
  reason: string | null;
}

/**
 * Where this meeting stands with the host's calendar.
 *
 * `requested` is what the client asked for, and `undefined` means it did not
 * ask. That distinction is the whole change: an absent preference now follows
 * the connection instead of defaulting to "no".
 */
export function planCalendarSync(input: {
  /**
   * A grant AND a calendar this member can write to — `providerSyncAvailable`.
   *
   * `null` means the app could not find out. That is not the same as "no": it
   * must not produce the "connect a calendar" advice, because there may be
   * nothing to connect.
   */
  connected: boolean | null;
  /** The client's explicit preference, when it stated one. */
  requested?: boolean | null;
  isDraft: boolean;
}): CalendarSyncPlan {
  if (input.connected === null && input.requested !== false && !input.isDraft) {
    return {
      // Nothing is claimed either way on the row: a flag written from a failed
      // lookup would be acted on by every later edit.
      enabled: input.requested === true,
      provider: input.requested === true ? SYNCABLE_PROVIDER : null,
      push: false,
      reason:
        "Could not check your calendar connection, so this meeting was not added to it. Saving again will try.",
    };
  }
  // An explicit no is respected even when a calendar is connected: some
  // meetings are deliberately kept off a shared calendar, and overriding that
  // would put them somewhere the host chose to exclude.
  const optedOut = input.requested === false;
  const connected = input.connected === true;
  const enabled = optedOut ? false : connected || input.requested === true;

  if (input.isDraft) {
    // Intent is stored so the meeting syncs the moment it stops being a draft,
    // but nothing is written now: a draft has never been committed to, and
    // pushing one puts a half-written meeting on a real calendar.
    return { enabled, provider: enabled ? SYNCABLE_PROVIDER : null, push: false, reason: null };
  }

  if (optedOut) {
    return { enabled: false, provider: null, push: false, reason: null };
  }

  if (!connected) {
    return {
      enabled,
      provider: enabled ? SYNCABLE_PROVIDER : null,
      push: false,
      reason:
        "This meeting is not on your calendar: no Google Calendar you can write to is connected. Connect one from the Meetings page and later saves will add it.",
    };
  }

  return { enabled: true, provider: SYNCABLE_PROVIDER, push: true, reason: null };
}

/**
 * What the scheduling form should say about the calendar, before anything is
 * saved.
 *
 * The old copy — "Sync to a third-party calendar after saving" next to an
 * unticked box — described a capability without saying whether it was available,
 * so a host with no connection ticked it and got nothing, and a host with a
 * connection left it alone and also got nothing.
 */
export function calendarSyncNote(input: { connected: boolean | null; optedOut: boolean }): string {
  // Not yet known. The form asks for this over the network, and a note that
  // promised "will be added" before the answer came back would be a claim that
  // can turn out false a moment later.
  if (input.connected === null) {
    return input.optedOut
      ? "This meeting will be kept off your Google Calendar."
      : "Checking whether a Google Calendar is connected\u2026";
  }
  if (!input.connected) {
    return "No Google Calendar is connected, so this meeting will not appear in your calendar. Connect one and future meetings are added automatically.";
  }
  return input.optedOut
    ? "This meeting will be kept off your Google Calendar."
    : "This meeting will be added to your Google Calendar, and removed from it if you cancel.";
}
