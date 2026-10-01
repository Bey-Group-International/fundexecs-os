import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { MeetingsLanding } from "./MeetingsLanding";
import type { CalendarMeeting } from "@/lib/meetings/calendar";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";
import type { PastMeeting } from "./PastMeetingsList";
import { readOAuthOutcome } from "@/lib/oauth-outcome";
import { OAuthOutcomeBanner } from "@/components/OAuthOutcomeBanner";
import { mailboxConfigured } from "@/lib/meetings/mailbox.server";
import { MailboxWarning } from "./MailboxWarning";
import { CallRelayWarning } from "./CallRelayWarning";
import { relayStatus } from "@/lib/meetings/turn-servers.server";
import { loadMeetingLog } from "@/lib/meetings/meeting-log.server";
import {
  belongsInLog,
  loggedMeeting,
  sortLogEntries,
  toLogEntry,
  type LoggedMeeting,
} from "@/lib/meetings/meeting-log";
import { isPastMeeting, isUpcomingMeeting, upcomingWindowStart } from "@/lib/meetings/schedule";
import { attendedButNotHosted } from "@/lib/meetings/attendance";
import { MEETING_KIND } from "@/lib/meetings/one-way";
import { CALENDAR_VIEW_PARAM, parseCalendarView } from "./calendar-view";

export const metadata: Metadata = {
  title: "Meetings — FundExecs OS",
  description: "Real-time video meetings with live presence, AI transcription, briefing notes, and action items.",
};

export const dynamic = "force-dynamic";

interface LiveMeeting {
  id: string;
  room_code: string;
  title: string;
  description: string | null;
  location: string | null;
  meeting_url: string | null;
  status: "waiting" | "active" | "ended";
  host_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  timezone: string | null;
  meeting_type: string | null;
  priority: "low" | "normal" | "high" | "critical" | null;
  tags: string[] | null;
  attendees: Array<{ name: string; email?: string; type?: "internal" | "external" }> | null;
  source: string | null;
  sync_status: string | null;
  source_event_id: string | null;
  source_calendar_id: string | null;
  deal_id: string | null;
  related_contact_id: string | null;
  related_fund_id: string | null;
  objective: string | null;
  agenda: string | null;
  preparation_requirements: string | null;
  preparation_status: string | null;
  followup_status: string | null;
  assigned_copilot_agent: string | null;
  related_record_type: string | null;
  related_record_id: string | null;
  calendar_visibility: string | null;
  reminder_minutes: number | null;
  external_calendar_provider: string | null;
  external_calendar_sync_enabled: boolean | null;
  external_calendar_sync_status: string | null;
  is_draft: boolean | null;
  locked_at: string | null;
  updated_at: string | null;
  guest_quick_access: boolean | null;
}

const MEETING_SELECT =
  "id, room_code, title, description, location, meeting_url, status, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes, timezone, meeting_type, priority, tags, attendees, source, sync_status, source_event_id, source_calendar_id, deal_id, related_contact_id, related_fund_id, objective, agenda, preparation_requirements, preparation_status, followup_status, assigned_copilot_agent, related_record_type, related_record_id, calendar_visibility, reminder_minutes, external_calendar_provider, external_calendar_sync_enabled, external_calendar_sync_status, is_draft, locked_at, updated_at, guest_quick_access, series_id, series_index, series_rule";

/**
 * Meetings this page renders at once.
 *
 * The list views replace this snapshot from their own endpoints moments later,
 * so its job is to be RIGHT on first paint rather than complete.
 */
const RECENT_LIMIT = 50;

/**
 * Attendance rows read to recover a meeting the org window missed.
 *
 * This was unbounded, and `live_meeting_participants` grows by one row per
 * meeting a person attends for the life of their account — so it was heading for
 * PostgREST's `max_rows` ceiling, which truncates silently. Bounded to the
 * newest, because a snapshot of fifty meetings cannot use more: an older
 * attendance can only recover a meeting the sort below then drops.
 */
const ATTENDANCE_LIMIT = 200;

async function getMeetings(
  orgId: string,
  userId: string,
  /**
   * One clock for the whole render.
   *
   * Passed in rather than read here: the page partitions Past with its own
   * `Date.now()`, and two readings milliseconds apart can put a meeting whose
   * window closes between them into neither list.
   */
  now: number,
  opts: {
    /**
     * Whether to read the history the calendar draws from.
     *
     * Off for an ordinary visit. `initialMeetings` and `initialPast` are passed
     * to exactly one component — MeetingsCalendar — which is code-split behind
     * `?view=`, is not mounted on first paint, and refetches its own five
     * hundred rows the moment it does mount. So every meetings page load was
     * running a forty-one-column history query and serialising the result into
     * the HTML for a component that would not read it.
     */
    withHistory: boolean;
  },
): Promise<{
  all: LiveMeeting[];
  upcoming: LiveMeeting[];
}> {
  const supabase = await createServerClient();

  // Two windows, because one cannot serve both lists.
  //
  // There used to be a single query ordered `scheduled_at DESC NULLS LAST,
  // created_at DESC` with a 50-row limit, and the two halves of that ordering
  // fought each other: nulls last puts every INSTANT meeting at the end of the
  // result, and the limit then cuts from the end. An organisation with fifty
  // scheduled meetings showed none of its instant ones — which is the product's
  // commonest kind — while the client-side refresh ordered by `created_at` and
  // found them, so the list also changed content a moment after the page
  // settled.
  //
  // Asking the two questions separately costs one more round trip in parallel
  // and answers both exactly: what is coming up, and what happened recently.
  const [{ data: soon }, { data: recent }, { data: attendance }] = await Promise.all([
    supabase
      .from("live_meetings")
      .select(MEETING_SELECT)
      .eq("organization_id", orgId)
      // Meetings only. A one-way call is a live_meetings row — it has to be,
      // so that its recording is reachable by the same policy and cleaned up
      // by the same sweep — but it is not a meeting anybody can join, and
      // listing it here would put an un-enterable room in the calendar and in
      // past meetings. The archive lists them instead.
      .eq("kind", MEETING_KIND)
      .is("deleted_at", null)
      .eq("is_draft", false)
      .neq("status", "ended")
      // The same window /api/meetings/upcoming uses, so the snapshot this page
      // paints and the list that replaces it cannot disagree about whether a
      // meeting already in progress belongs here.
      .gte("scheduled_at", upcomingWindowStart(now).toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(100),
    opts.withHistory
      ? supabase
          .from("live_meetings")
          .select(MEETING_SELECT)
          .eq("organization_id", orgId)
          .eq("kind", MEETING_KIND)
          .is("deleted_at", null)
          // By recency, full stop. Instant meetings carry no `scheduled_at` and
          // belong in this window on the same terms as everything else.
          .order("created_at", { ascending: false })
          .limit(RECENT_LIMIT)
      : { data: null },
    opts.withHistory
      ? supabase
          .from("live_meeting_participants")
          .select("meeting_id, joined_at")
          .eq("user_id", userId)
          .order("joined_at", { ascending: false })
          .limit(ATTENDANCE_LIMIT)
      : { data: null },
  ]);

  const byId = new Map<string, LiveMeeting>();
  for (const row of [...((soon ?? []) as LiveMeeting[]), ...((recent ?? []) as LiveMeeting[])]) {
    byId.set(row.id, row);
  }

  // A meeting somebody attended that neither window caught — one held in
  // another organisation, or older than the recent window. Rare, and the only
  // reason this read exists.
  const missingIds = attendedButNotHosted(
    (attendance ?? []).map((r: { meeting_id: string }) => r.meeting_id),
    [...byId.keys()],
  );
  if (opts.withHistory && missingIds.length > 0) {
    const { data } = await supabase
      .from("live_meetings")
      .select(MEETING_SELECT)
      .in("id", missingIds)
      .eq("kind", MEETING_KIND)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT);
    for (const row of (data ?? []) as LiveMeeting[]) byId.set(row.id, row);
  }

  const all = [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // Upcoming is taken from its own window rather than sliced out of `all`, so a
  // meeting scheduled months ahead is never pushed out of it by recent activity.
  const upcoming = all
    .filter((m) => isUpcomingMeeting(m, now))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

  return { all, upcoming };
}

export default async function MeetingsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Google Calendar's connect routes report back here as `?google_calendar=…`.
  // Nothing read it, so connecting a calendar looked identical whether it
  // succeeded, was declined, or died on a missing vault key.
  const searchParams = await props.searchParams;
  const oauthOutcome = readOAuthOutcome(searchParams);
  // Whether this visit is actually opening the calendar. The overlay reads its
  // pane from `?view=`, so the same param that decides whether the grid mounts
  // decides whether the history it draws from is worth reading at all.
  const viewParam = searchParams[CALENDAR_VIEW_PARAM];
  const calendarRequested =
    parseCalendarView(Array.isArray(viewParam) ? viewParam[0] : viewParam) !== null;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const userId = ctx.userId;
  // canSendEmail: whether anything this page schedules can actually be emailed.
  // Cheap by design — a credential-existence check, not a token mint — because
  // it runs on every visit.
  //
  // logRows: the log is its own query rather than a slice of `meetings`. That
  // one stops at 50 rows and carries no reports, and the whole point of a log
  // is that a meeting from months ago is still in it, with what it produced.
  // One client, awaited once. The `await createServerClient()` used to sit INSIDE
  // this array, and array elements evaluate left to right — so it blocked
  // between the first read starting and the other two, putting a round trip in
  // front of the page for nothing.
  const client = await createServerClient();
  const now = Date.now();
  const [{ all: meetings, upcoming }, canSendEmail, logRows] = await Promise.all([
    getMeetings(ctx.orgId, userId, now, { withHistory: calendarRequested }),
    mailboxConfigured(client, userId, ctx.orgId),
    loadMeetingLog(client, ctx.orgId, userId),
  ]);
  // Past is the complement of Upcoming, asked directly rather than derived by
  // subtraction. `!upcoming.some(...)` inside a filter both scanned the upcoming
  // list once per meeting and defined Past as "whatever Upcoming rejected",
  // which quietly swept up drafts and ad-hoc rooms that belong in neither.
  //
  // Both of these go to the calendar overlay and nowhere else, so on a visit
  // that is not opening it they are sent empty rather than sent unread: the
  // overlay only exists at `?view=`, and it reloads its own window on mount.
  // An environment read, not a request: whether calls can be relayed for
  // guests on networks that block direct connections.
  const relay = relayStatus();
  const history = calendarRequested ? meetings : [];
  const past = history.filter((m) => isPastMeeting(m, now));

  // Only meetings that have actually happened — `belongsInLog`, the same rule the
  // log's search route applies, so a hit is never the only place a meeting
  // appears.
  //
  // And a LINE per meeting, not an entry: `loggedMeeting` drops the summary, key
  // points, decisions, action items and attendee names, which the collapsed row
  // does not draw. They are fetched by the row that opens. Two hundred meetings
  // of prose used to travel with this page so the browser could filter them;
  // the filtering is now a query (see /api/meetings/log/search) and the prose
  // stopped needing to come along.
  const logs: LoggedMeeting[] = sortLogEntries(
    logRows
      .filter((row) => belongsInLog(row.meeting, now))
      .map((row) => loggedMeeting(toLogEntry(row.meeting, row.report, row.attended, row.isHost))),
  );

  return (
    // Landing shows the lobby + Upcoming meetings; the full calendar opens behind
    // the lobby's "Schedule for later" action (Meetings → Schedule for later →
    // calendar) rather than sitting on the page permanently.
    <>
      {oauthOutcome && (
        <OAuthOutcomeBanner outcome={oauthOutcome} dismissHref="/meetings" />
      )}
      {!canSendEmail && <MailboxWarning />}
      {/* Only the people who can set the relay up are told it is missing. */}
      {!relay.configured && (ctx.role === "owner" || ctx.role === "admin") && (
        <CallRelayWarning reason={relay.reason} />
      )}
      <MeetingsLanding
        initialMeetings={history as unknown as CalendarMeeting[]}
        initialUpcoming={upcoming as unknown as UpcomingMeeting[]}
        initialPast={past as unknown as PastMeeting[]}
        initialLogs={logs}
        userId={userId}
        orgId={ctx.orgId}
      />
    </>
  );
}
