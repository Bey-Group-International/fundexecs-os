// lib/meetings/report-page.server.ts
// Everything the report page needs, read once, on the server.
//
// Seven browser round trips became one server pass. The page was a client
// component: it booted JavaScript, asked who the reader was, then asked for the
// meeting, then — once it had the meeting's id — the report, the attendance row,
// the timed transcript, the recordings and the chat. Nothing rendered until the
// first few had landed, and the last two were fired by panels deep in the tree
// that each did their own fetch on mount.
//
// A report is a document. It is written once and read many times, and none of
// what it says depends on the browser it is read in.
//
// The dependency here is real but shallow: everything except the viewer needs
// the meeting's id, and the meeting is found by room code. So it is two waves,
// not seven — the viewer and the meeting together, then the five reads that
// hang off the meeting, together.
//
// No `server-only` import, matching the other loaders in this repo: the
// `.server` suffix is the marker, and the guard would put this beyond the reach
// of a test.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { reportViewState, type ReportViewState } from "@/lib/meetings/attendance";
import { readAcknowledgement, type ConsentAcknowledgement } from "@/lib/meetings/one-way";
import { storedChatMessages, type ChatMessage, type StoredChatRow } from "@/lib/meetings/chat";
import {
  reportOwedForMs,
  type ReportMeeting,
  type ReportRecording,
  type ReportRow,
} from "@/lib/meetings/report-page";
import type { CueRow } from "@/lib/meetings/transcript-cues";

type Client = SupabaseClient<Database>;

/**
 * As many chat messages as the page will render. Chat is short; this is a guard,
 * not a page.
 */
export const CHAT_LIMIT = 500;

/** Everything one render of the report page needs. */
export interface ReportPageData {
  /** What the page should show. Decided here so the poll and the render agree. */
  state: ReportViewState;
  /** Null when no meeting has this room code. */
  meeting: ReportMeeting | null;
  report: ReportRow | null;
  /** Who is reading, as RLS sees them. */
  viewerId: string | null;
  attended: boolean;
  /** True when the reader is the meeting's host, which decides the follow-up send. */
  isHost: boolean;
  consent: ConsentAcknowledgement | null;
  recordings: ReportRecording[];
  /** Already read back as messages, so the panel does no shaping of its own. */
  chat: ChatMessage[];
  /** The timed rows, which are what let a transcript line drive the recording. */
  cueRows: CueRow[];
  /**
   * The reader's own address, and the meeting's organisation.
   *
   * Both exist for the inbox history beside the report, which is loaded
   * separately (see report-inbox.server.ts) and needs the two facts this pass
   * already has in hand: which organisation's inbox to read, and who to leave
   * out of it. Reading them again there would be two more round trips for
   * things already on this page.
   */
  viewerEmail: string | null;
  organizationId: string | null;
  /** `live_meetings.attendees` as stored, which the history keys off. */
  invited: unknown;
}

const EMPTY: ReportPageData = {
  state: "missing",
  meeting: null,
  report: null,
  viewerId: null,
  attended: false,
  isHost: false,
  consent: null,
  recordings: [],
  chat: [],
  cueRows: [],
  viewerEmail: null,
  organizationId: null,
  invited: null,
};

/** The meeting columns the state decision needs, and nothing else. */
const STATE_COLUMNS = "id, host_id, ended_at, started_at, scheduled_at, created_at";

/**
 * Just the state: has this room's report arrived, for whoever is asking.
 *
 * This exists because the obvious thing was wrong. The waiting poll asked
 * `loadReportPage` — the full load — every five seconds, to read three booleans
 * off the end of it. That meant, per tick: every page of the transcript through
 * `readAllTranscriptRows`, up to 500 chat rows, every recording, and the report
 * row with its whole `full_transcript` and `analysis`. A tab waiting the full six
 * minutes did that about seventy times, on a meeting whose transcript is at its
 * longest precisely when the wait is longest.
 *
 * Worse than the client page it replaced, which read the transcript twice.
 *
 * So the poll gets its own reads: the viewer, four meeting columns, whether a
 * report row exists and whether it has a summary, and the attendance row. No
 * transcript, no chat, no recordings, no report body.
 *
 * The DECISION is still shared — both this and `loadReportPage` end at the same
 * `reportViewState` call — so the poll and the render cannot disagree about what
 * the page should be showing. That is the part that had to stay common; the reads
 * are what had to differ.
 */
export async function loadReportState(
  supabase: Client,
  roomCode: string,
  now: number = Date.now(),
): Promise<ReportViewState> {
  const [viewerResult, meetingResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("live_meetings").select(STATE_COLUMNS).eq("room_code", roomCode).maybeSingle(),
  ]);

  const viewerId = viewerResult?.data?.user?.id ?? null;
  const meeting = meetingResult?.data as ReportMeeting | null | undefined;
  if (!meeting) return "missing";

  const [reportResult, attendanceResult] = await Promise.all([
    // `summary` alone: enough to answer both "is there a row" (the row came back)
    // and "does it say anything" — without dragging an hour of transcript along.
    supabase
      .from("live_meeting_reports")
      .select("summary")
      .eq("meeting_id", meeting.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    viewerId
      ? supabase
          .from("live_meeting_participants")
          .select("meeting_id")
          .eq("meeting_id", meeting.id)
          .eq("user_id", viewerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const report = reportResult?.data as { summary: string | null } | null;
  return reportViewState({
    loaded: true,
    meetingExists: true,
    hostId: meeting.host_id,
    viewerId,
    attended: Boolean(attendanceResult?.data),
    hasReport: Boolean(report),
    hasSummary: Boolean(report?.summary?.trim()),
    waitedMs: reportOwedForMs(meeting, now),
  });
}

/**
 * Load a report page for whoever the request's cookies say is asking.
 *
 * `supabase` must be the cookie-bound client, not the service one: RLS is what
 * decides that a report belongs to the people who were in the meeting, and this
 * function leans on it rather than re-implementing it. The attendance row is
 * read anyway, because under RLS "no report yet" and "not yours to read" are the
 * same empty answer — which is why a member who was not in the meeting used to
 * sit forever on "Generating your report…".
 */
export async function loadReportPage(
  supabase: Client,
  roomCode: string,
  now: number = Date.now(),
): Promise<ReportPageData> {
  // Wave one: who is asking, and which meeting this is. Independent of each
  // other, so together.
  const [viewerResult, meetingResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("live_meetings")
      .select(
        "id, host_id, title, created_at, started_at, ended_at, scheduled_at, kind, recording_consent, organization_id, attendees",
      )
      .eq("room_code", roomCode)
      .maybeSingle(),
  ]);

  const viewerId = viewerResult?.data?.user?.id ?? null;
  const viewerEmail = (viewerResult?.data?.user?.email ?? "").trim().toLowerCase() || null;
  const meetingRow = meetingResult?.data as
    | (ReportMeeting & {
        recording_consent?: unknown;
        organization_id?: string | null;
        attendees?: unknown;
      })
    | null
    | undefined;

  if (!meetingRow) return { ...EMPTY, viewerId, viewerEmail };

  const meeting: ReportMeeting = {
    id: meetingRow.id,
    host_id: meetingRow.host_id,
    title: meetingRow.title,
    created_at: meetingRow.created_at,
    started_at: meetingRow.started_at,
    ended_at: meetingRow.ended_at,
    scheduled_at: meetingRow.scheduled_at,
    kind: meetingRow.kind,
  };

  // Wave two: the five reads that need the meeting's id. All independent of one
  // another, so one Promise.all rather than a waterfall — on the client these
  // arrived in three separate rounds, two of them fired by panels mounting.
  const [reportResult, attendanceResult, recordingsResult, chatResult, cueRows] =
    await Promise.all([
      supabase
        .from("live_meeting_reports")
        .select("summary, key_points, action_items, analysis, full_transcript")
        .eq("meeting_id", meeting.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      viewerId
        ? supabase
            .from("live_meeting_participants")
            .select("meeting_id")
            .eq("meeting_id", meeting.id)
            .eq("user_id", viewerId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("live_meeting_recordings")
        .select(
          "id, status, duration_seconds, size_bytes, started_by_name, started_at, expires_at, deleted_at, mime_type",
        )
        .eq("meeting_id", meeting.id)
        .order("started_at", { ascending: true }),
      supabase
        .from("live_meeting_chat")
        .select("id, author_id, author_name, body, ts")
        .eq("meeting_id", meeting.id)
        .order("ts", { ascending: true })
        .limit(CHAT_LIMIT),
      // Paged, because an unbounded select is cut off at PostgREST's max_rows
      // (1000) with nothing to say so, and these rows are ordered oldest first —
      // so a long meeting's cues simply stopped partway through the recording,
      // at a point that looked like the end of the meeting.
      readAllTranscriptRows((from, to) =>
        supabase
          .from("live_meeting_transcripts")
          .select("speaker, text, ts, confidence, overlapped")
          .eq("meeting_id", meeting.id)
          .order("ts", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      )
        .then((rows) => rows as unknown as CueRow[])
        // The timestamps, not the transcript: the panel still renders from
        // full_transcript, it just cannot drive or follow the recording.
        .catch(() => [] as CueRow[]),
    ]);

  const report = (reportResult?.data as ReportRow | null) ?? null;
  const attended = Boolean(attendanceResult?.data);
  const recordings = (recordingsResult?.data as ReportRecording[] | null) ?? [];
  const chatRows = (chatResult?.data as StoredChatRow[] | null) ?? [];

  const state = reportViewState({
    loaded: true,
    meetingExists: true,
    hostId: meeting.host_id,
    viewerId,
    attended,
    hasReport: Boolean(report),
    hasSummary: Boolean(report?.summary?.trim()),
    // Measured from the meeting rather than from this request, so "not coming"
    // means the same thing on every visit instead of restarting each time
    // somebody opens the page.
    waitedMs: reportOwedForMs(meeting, now),
  });

  return {
    state,
    meeting,
    report,
    viewerId,
    attended,
    isHost: Boolean(viewerId && viewerId === meeting.host_id),
    consent: readAcknowledgement(meetingRow.recording_consent),
    // A read the viewer is not entitled to comes back empty under RLS, so these
    // do not need their own permission check — but they are cleared anyway for
    // a state that renders none of them, rather than shipped to a browser that
    // has been told it may not read the report.
    recordings: state === "forbidden" ? [] : recordings,
    chat: state === "forbidden" ? [] : storedChatMessages(chatRows),
    cueRows: state === "forbidden" ? [] : cueRows,
    viewerEmail,
    // Cleared for a reader who may not read the report at all, for the same
    // reason the rest is: the history load is keyed off these two, so handing
    // them over would mean answering "what is the inbox holding on these people"
    // for somebody who has just been told this report is not theirs.
    organizationId: state === "forbidden" ? null : meetingRow.organization_id ?? null,
    invited: state === "forbidden" ? null : meetingRow.attendees ?? null,
  };
}
