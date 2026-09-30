// lib/meetings/crm-activity.ts
// What a finished meeting writes onto the CRM record of the people who were in
// it.
//
// The app hosts the meeting, records who attended, transcribes it, summarises it
// and emails the follow-up — and until now a contact's record showed none of it
// unless somebody typed "had a meeting" by hand. `network_activities` has had
// `meeting` as an activity type, an `is_system` flag for "entries from the
// engine", and a `metadata` column documented for "machine-generated entries
// (from/to stage, message id, duration)" since it was created. Nothing ever
// wrote one.
//
// Every rule is here rather than in the writer, because the rules are where the
// risk is: a wrong link puts one person's meeting on another person's permanent
// record, and an entry written twice makes the CRM double-count contact. Both
// are decidable from data alone, so both are tested rather than described.
//
// Pure: no database, no clock, no network.

/** A contact matched only by an address equal to one the CRM holds. */
export type EmailIndex = ReadonlyMap<string, string>;

export interface CrmMeetingInput {
  meeting: {
    id: string;
    roomCode: string | null;
    title: string | null;
    /** `started_at`, the instant the room actually opened. */
    startedAt: string | null;
    /** Fallback for a meeting that was scheduled but never marked started. */
    scheduledAt: string | null;
    /** The stamp the caller is closing the meeting with. Last resort. */
    endedAt: string;
    durationMinutes: number | null;
    /**
     * The host's own address, so a host who is also in the CRM is not logged as
     * having taken a meeting with themselves.
     */
    hostEmail: string | null;
    /** True when a public scheduling link produced this meeting. */
    fromBookingLink: boolean;
  };
  /** `live_meetings.attendees` — who was invited. */
  invited: ReadonlyArray<{ name?: string | null; email?: string | null }>;
  /** `live_meeting_participants` — who actually joined. */
  attendedEmails: readonly string[];
  /** Lowercased address → contact id. The caller builds this in one query. */
  contactsByEmail: EmailIndex;
  /**
   * The report, or null when there will not be one.
   *
   * Null is a real case, not an error: a meeting can end with the analysis
   * having failed or nothing transcribed, and the contact's record should still
   * show that the meeting happened rather than silently omit it. An entry
   * written without a report is replaced by the full one if a report arrives
   * later, because both use the same key.
   */
  report: { summary: string | null; decisions: readonly string[] } | null;
  /** Absolute base for the report link, e.g. https://app.example.com */
  siteUrl: string;
}

/** One row, shaped for `network_activities`. */
export interface CrmMeetingActivity {
  contactId: string;
  activityType: "meeting";
  direction: "inbound" | "outbound";
  subject: string;
  body: string;
  occurredAt: string;
  isSystem: true;
  metadata: {
    meeting_id: string;
    room_code: string | null;
    duration_minutes: number | null;
    /** Whether this contact actually joined, not whether the meeting happened. */
    attended: boolean;
    report_url: string | null;
    has_report: boolean;
    source: "live_meeting";
  };
}

/**
 * How much of the report reaches the timeline.
 *
 * The record is a place to see at a glance what happened with somebody, not a
 * second copy of the report. Past this the entry is cut and the link carries the
 * rest.
 */
export const CRM_BODY_MAX = 2000;

/** Said when a meeting closed without an analysis, so the gap is explicit. */
export const NO_REPORT_BODY = "No summary was generated for this meeting.";

/**
 * An address, or "" when it is not one.
 *
 * Deliberately strict, and deliberately not clever. Matching is exact: the only
 * link drawn is between an address and a contact holding the same address, with
 * case and surrounding space ignored because those are not differences. No
 * domain guessing and no name similarity — an unmatched participant stays
 * unlinked and can be attached by hand, which is recoverable, where a wrong link
 * is silently wrong forever.
 */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || /\s/.test(trimmed)) return "";
  const at = trimmed.indexOf("@");
  // Exactly one @, with something either side of it.
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || at === trimmed.length - 1) return "";
  // A domain has to have a dot in it, and cannot end on one.
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return "";
  return trimmed;
}

/** The body of the entry: what was said, and what was agreed. */
export function meetingBody(report: CrmMeetingInput["report"]): string {
  if (!report) return NO_REPORT_BODY;

  const summary = (report.summary ?? "").trim();
  const decisions = report.decisions
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter(Boolean);

  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (decisions.length) parts.push(`Decisions\n${decisions.map((d) => `- ${d}`).join("\n")}`);
  // A report row exists but the model wrote nothing usable into it.
  if (parts.length === 0) return NO_REPORT_BODY;

  const body = parts.join("\n\n");
  if (body.length <= CRM_BODY_MAX) return body;
  return `${body.slice(0, CRM_BODY_MAX).trimEnd()}…`;
}

/** Where the whole report lives, for the caller that wants the rest. */
export function reportUrl(siteUrl: string, roomCode: string | null): string | null {
  if (!roomCode) return null;
  return `${siteUrl.replace(/\/$/, "")}/meetings/${roomCode}/report`;
}

/**
 * One activity row per contact who was in the meeting, or none.
 *
 * One row per CONTACT, not per address and not per appearance: somebody invited
 * under an address and present under the same one is one meeting, and being
 * listed twice in an invite list is not two meetings.
 */
export function meetingActivities(input: CrmMeetingInput): CrmMeetingActivity[] {
  const { meeting, contactsByEmail } = input;
  if (contactsByEmail.size === 0) return [];

  const host = normalizeEmail(meeting.hostEmail);
  const attended = new Set<string>();
  for (const email of input.attendedEmails) {
    const normalized = normalizeEmail(email);
    if (normalized) attended.add(normalized);
  }

  // Everyone the meeting knows about: invited, present, or both. Present-only
  // is a real case — somebody forwarded the link.
  const addresses: string[] = [];
  for (const person of input.invited) {
    const normalized = normalizeEmail(person?.email);
    if (normalized) addresses.push(normalized);
  }
  for (const email of attended) addresses.push(email);

  const body = meetingBody(input.report);
  const url = reportUrl(input.siteUrl, meeting.roomCode);
  const occurredAt = meeting.startedAt ?? meeting.scheduledAt ?? meeting.endedAt;

  const byContact = new Map<string, CrmMeetingActivity>();
  for (const address of addresses) {
    // The host's own record is not a record of who the host met.
    if (host && address === host) continue;

    const contactId = contactsByEmail.get(address);
    if (!contactId) continue;

    const existing = byContact.get(contactId);
    if (existing) {
      // A second address for the same contact only ever adds attendance.
      if (attended.has(address)) existing.metadata.attended = true;
      continue;
    }

    byContact.set(contactId, {
      contactId,
      activityType: "meeting",
      // A meeting somebody booked came to us; one the host convened went out.
      direction: meeting.fromBookingLink ? "inbound" : "outbound",
      subject: (meeting.title ?? "").trim() || "Meeting",
      body,
      occurredAt,
      isSystem: true,
      metadata: {
        meeting_id: meeting.id,
        room_code: meeting.roomCode,
        duration_minutes: meeting.durationMinutes,
        attended: attended.has(address),
        report_url: url,
        has_report: input.report !== null,
        source: "live_meeting",
      },
    });
  }

  return [...byContact.values()];
}

/**
 * The report link out of an activity's metadata, or null.
 *
 * `metadata` is jsonb and free-form by design, and this value is rendered as an
 * href — so it is validated rather than trusted. Only an absolute http(s) URL is
 * returned: anything else, including a `javascript:` scheme, reads as no link at
 * all. Today nothing but server code writes this column, and that is exactly the
 * kind of fact that stops being true quietly.
 */
export function reportUrlFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as { report_url?: unknown }).report_url;
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
