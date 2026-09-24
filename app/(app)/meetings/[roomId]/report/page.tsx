"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { FollowUpPanel } from "./FollowUpPanel";
import { ExportMenu } from "./ExportMenu";
import { TranscriptPanel } from "./TranscriptPanel";
import { ChatPanel } from "./ChatPanel";
import type { RecordingPlayerHandle } from "./RecordingPlayer";
import { transcriptCues, type CueRow } from "@/lib/meetings/transcript-cues";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { RecordingPanel } from "./RecordingPanel";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { reportViewState, shouldPollReport, type ReportViewState } from "@/lib/meetings/attendance";
import { callClock, isOneWay, readAcknowledgement, type ConsentAcknowledgement } from "@/lib/meetings/one-way";
import { TRUNCATED_KEY } from "@/lib/meetings/report-analysis";

type Meeting = {
  id: string;
  host_id: string | null;
  title: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  /** "meeting" or "one_way" — a recorded call has no room and no attendees. */
  kind: string | null;
};

type Report = {
  summary: string | null;
  key_points: string[] | null;
  action_items: string[] | null;
  analysis: Record<string, unknown> | null;
  full_transcript: string | null;
};

type Data = {
  meeting: Meeting;
  report: Report | null;
  attended: boolean;
  viewerId: string | null;
  /** The consent acknowledged before a one-way call was recorded, if any. */
  consent: ConsentAcknowledgement | null;
} | null;

const POLL_INTERVAL = 5000;

export default function MeetingReportPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [data, setData] = useState<Data | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The rows the room wrote while people were speaking. Only these carry a
  // time, which is what lets a line in the transcript drive the recording.
  const [lines, setLines] = useState<CueRow[]>([]);
  /**
   * Whether the timed transcript rows have been asked for, and whether that
   * read is the definitive one.
   *
   * Not simply "fetched once": participants are sent here the moment a meeting
   * ends, while their own final flush and everyone else's backing-off retries
   * are still in flight, so a read taken at mount can be missing the end of
   * the meeting — and the end is what people came to check. Two reads: one on
   * arrival so the page has something, and one once the report exists, which
   * the server writes only after those flushes have landed.
   */
  const linesFetchedRef = useRef(false);
  const linesFinalRef = useRef(false);
  /** When this page started waiting, for deciding a report is not coming. */
  const waitStartedRef = useRef<number>(Date.now());
  const [waitedMs, setWaitedMs] = useState(0);
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  /** The recording's own length, which is a one-way call's only clock. */
  const [recordedSeconds, setRecordedSeconds] = useState<number | null>(null);
  const playerRef = useRef<RecordingPlayerHandle>(null);
  /**
   * Where the recording has got to, so the transcript can follow it.
   *
   * The link between the two only ever ran one way: a line could seek the
   * player, and the player reported its position to nobody — so watching a
   * meeting back meant scrolling the transcript by hand to keep up, which is
   * the work having them side by side exists to remove.
   *
   * Rounded to the second before it reaches state. `timeupdate` fires about
   * four times a second, and re-rendering an hour-long transcript at that rate
   * to move a highlight that only changes between turns is most of a core for
   * nothing.
   */
  // undefined, not 0: zero is a real position, so starting there marks a turn
  // as being spoken and scrolls to it before anything has been played.
  const [playheadMs, setPlayheadMs] = useState<number | undefined>(undefined);
  const handleTime = useCallback((ms: number) => {
    // Only when the second changes, so a 4Hz timeupdate does not re-render the
    // transcript four times a second. The first report always lands, because
    // "nothing has played" is not a second.
    setPlayheadMs((prev) =>
      prev !== undefined && Math.floor(ms / 1000) === Math.floor(prev / 1000) ? prev : ms,
    );
  }, []);

  async function fetchReport() {
    const supabase = createClient();

    const [{ data: { user } }, { data: meeting }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("live_meetings")
        .select("id, host_id, title, created_at, started_at, ended_at, scheduled_at, kind, recording_consent")
        .eq("room_code", roomId)
        .maybeSingle(),
    ]);

    if (!meeting) {
      setData(null);
      stopPolling();
      return;
    }

    // Reports are attendees-only, and RLS enforces that in Postgres. Read the
    // attendance row too so the page can tell "no report yet" from "not yours
    // to read" — under RLS those are the same empty answer, which is why a
    // member who was not in the meeting used to sit on "Generating your
    // report…" for a report that was never going to arrive.
    const [{ data: report }, { data: attendance }] = await Promise.all([
      supabase
        .from("live_meeting_reports")
        .select("summary, key_points, action_items, analysis, full_transcript")
        .eq("meeting_id", meeting.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      user
        ? supabase
            .from("live_meeting_participants")
            .select("meeting_id")
            .eq("meeting_id", meeting.id)
            .eq("user_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // Timed lines, read through the viewer's own client: RLS gives these to
    // the people who were in the meeting, the same rule the report uses. A
    // failure here costs the timestamps, not the transcript.
    //
    // Paged, for the same reason the two report routes are: an unbounded
    // select is cut off at `max_rows` (1000) with nothing to say so, and these
    // rows are ordered oldest first — so the cues simply stopped partway
    // through a long recording, at a point that looked like the end of the
    // meeting rather than the end of the page.
    // Twice at most, never once per poll. This pages every transcript row a
    // meeting has — up to a thousand per request — and it used to sit inside
    // the poll body, so a two-hour meeting re-fetched its whole transcript
    // every five seconds for as long as the page waited.
    //
    // Twice rather than once because the rows ARE still arriving when this
    // page first opens (see linesFinalRef). The second read is taken once the
    // report row exists, which the route writes after the transcript it was
    // built from.
    const reportExists = Boolean(report);
    if (!linesFetchedRef.current || (reportExists && !linesFinalRef.current)) {
      linesFetchedRef.current = true;
      if (reportExists) linesFinalRef.current = true;
      void readAllTranscriptRows((from, to) =>
        supabase
          .from("live_meeting_transcripts")
          .select("speaker, text, ts, confidence, overlapped")
          .eq("meeting_id", meeting.id)
          .order("ts", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      )
        .then((rows) => setLines(rows as unknown as CueRow[]))
        .catch(() => {
          // Cleared so a later poll retries, which only helps while one is
          // still scheduled — polling stops as soon as the report exists. A
          // read lost after that costs the TIMESTAMPS for the life of the
          // page, not the transcript: it still renders from full_transcript,
          // it just cannot drive or follow the recording.
          linesFetchedRef.current = false;
          linesFinalRef.current = false;
        });
    }

    const next: Data = {
      meeting: meeting as Meeting,
      report: (report as Report | null) ?? null,
      attended: Boolean(attendance),
      viewerId: user?.id ?? null,
      consent: readAcknowledgement((meeting as { recording_consent?: unknown }).recording_consent),
    };
    setData(next);

    // Read from a ref rather than the state that has only just been set: this
    // runs in the same tick, and the next poll is five seconds away.
    const waited = Date.now() - waitStartedRef.current;
    setWaitedMs(waited);
    if (!shouldPollReport(viewStateOf(next, waited))) stopPolling();
  }

  function stopPolling() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    // Everything that describes the PREVIOUS report has to go, because this
    // component survives a soft navigation from one report to another. Left
    // behind, the transcript read would never run for the new meeting — its
    // cues would seek the new recording to the old meeting's timings — and the
    // stall clock would carry over, so an ordinary report could be declared
    // dead on arrival.
    linesFetchedRef.current = false;
    linesFinalRef.current = false;
    waitStartedRef.current = Date.now();
    setWaitedMs(0);
    setLines([]);
    setRecordingStartedAt(null);
    setRecordedSeconds(null);
    setData(undefined);

    fetchReport();

    // Start polling; fetchReport will stop it when status is terminal
    intervalRef.current = setInterval(fetchReport, POLL_INTERVAL);

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Placed above the early returns: a hook that only runs on some renders is
  // a hook that runs in a different order on the next one.
  const cues = useMemo(
    () => transcriptCues(lines, recordingStartedAt),
    [lines, recordingStartedAt],
  );
  const handleRecordingReady = useCallback((startedAt: string, durationSeconds: number | null) => {
    setRecordingStartedAt(startedAt);
    setRecordedSeconds(durationSeconds);
  }, []);
  const seekRecording = useCallback((ms: number) => {
    playerRef.current?.seekTo(ms);
  }, []);

  const state = viewStateOf(data, waitedMs);

  if (state === "loading" || state === "generating") return <GeneratingState />;
  if (state === "stalled") return <StalledState title={data?.meeting.title ?? null} />;
  if (state === "missing") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-[var(--fg-muted)]">Meeting not found.</p>
        <Link href="/meetings" className="text-sm text-[var(--gold-400)] hover:underline">
          Back to meetings
        </Link>
      </div>
    );
  }
  if (state === "forbidden") return <NotAnAttendeeState title={data?.meeting.title ?? null} />;

  // Narrowed by the states above: the meeting is present and the viewer may
  // read it. `report` is present too — "unsummarised" means a row with nothing
  // in the summary, not the absence of a row.
  const { meeting, report, viewerId, consent } = data!;
  if (!report) return <GeneratingState />;

  // Coerced, not cast. These are stored model output, and reports written before
  // the report route started normalizing can hold objects where the page expects
  // strings — which would throw in React and replace the page with an error.
  const keyPoints = normalizeNoteList(report.key_points);
  const actionItems = normalizeNoteList(report.action_items);
  const analysis = report.analysis as Record<string, unknown> | null;
  const decisions = normalizeNoteList(analysis?.decisions);
  const followUp = normalizeNoteText(analysis?.follow_up_draft) || null;
  const sentiment = analysis?.sentiment as string | null;
  const nextMeeting = analysis?.next_meeting_suggestion as string | null;
  // The model ran out of room before it finished. Said out loud, because a
  // report that stops early reads exactly like a meeting that decided nothing.
  const truncated = analysis?.[TRUNCATED_KEY] === true;
  const isHost = Boolean(viewerId && viewerId === meeting.host_id);

  const oneWay = isOneWay(meeting);

  // Wall clock between joining and ending. A one-way call has no started_at —
  // nobody joins a room that does not exist — so this is null for every
  // recorded call, and the recording's own length stands in below.
  const duration = meeting.started_at && meeting.ended_at
    ? Math.round((new Date(meeting.ended_at).getTime() - new Date(meeting.started_at).getTime()) / 60000)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/meetings" className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]">
              ← Meetings
            </Link>
          </div>
          <h1 className="text-xl font-semibold text-[var(--fg-primary)]">
            {meeting.title ?? "Meeting"}
          </h1>
          <p className="text-sm text-[var(--fg-muted)] mt-0.5">
            {/* When the meeting HAPPENED. `created_at` is when the row was
                made, which for anything scheduled in advance is a different
                day entirely — a report for Tuesday's board call dated the
                Thursday before it was booked. */}
            {new Date(
              meeting.started_at ?? meeting.scheduled_at ?? meeting.created_at,
            ).toLocaleDateString("en-US", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })}
            {duration ? ` · ${duration} min` : recordedSeconds ? ` · ${callClock(recordedSeconds)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sentiment && <SentimentBadge value={sentiment} />}
          <ExportMenu roomId={roomId} />
        </div>
      </div>

      {state === "unsummarised" && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
          <p className="text-xs font-medium text-[var(--fg-primary)]">No summary was written</p>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
            {/* Keyed on whether there are words, NOT on the kind of session.
                The route writes an empty summary down two paths: a call with
                nothing transcribed, and a model call that failed on a real
                transcript. Saying "nothing was transcribed" above a full
                transcript would be the page contradicting itself — and would
                withhold the regenerate advice that actually fixes the row. */}
            {report.full_transcript?.trim()
              ? "The analysis could not be completed, so there is no summary. Everything that was captured is below, and regenerating the report from the meeting log will try again."
              : oneWay
                ? "Nothing was transcribed on this call, so there was nothing to summarise. The recording is below."
                : "Nothing was transcribed in this meeting, so there was nothing to summarise."}
          </p>
        </div>
      )}

      {consent && (
        // Stored precisely so that somebody can answer "should this have been
        // recorded?" months later. The archive shows that consent exists; this
        // is the page where the answer is actually needed, and until now it
        // was the one place that held the record and never showed it.
        <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--fg-secondary)]">
            Consent recorded {new Date(consent.at).toLocaleString("en-US", {
              month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
            })}
          </summary>
          <p className="mt-2 text-xs italic text-[var(--fg-primary)]">&ldquo;{consent.disclosure}&rdquo;</p>
          <p className="mt-1.5 text-xs text-[var(--fg-muted)]">
            The person recording confirmed they had consent from everyone on the call.
            {consent.sources.length > 0 && ` Captured: ${consent.sources.join(" and ")}.`}
          </p>
        </details>
      )}

      {truncated && (
        <div className="rounded-xl border border-[var(--status-warning,#f59e0b)]/40 bg-[var(--status-warning,#f59e0b)]/10 px-4 py-3">
          <p className="text-xs font-medium text-[var(--fg-primary)]">This report was cut short</p>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
            The analysis ran out of room before it finished, so the later sections — usually the
            follow-up draft — may be incomplete. Regenerating it from the meeting log will try again.
          </p>
        </div>
      )}

      {/* Summary */}
      {report.summary && (
        <Section title="Summary">
          <p className="text-sm text-[var(--fg-primary)] leading-relaxed">{report.summary}</p>
        </Section>
      )}

      {/* Key points + decisions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {keyPoints.length > 0 && (
          <Section title="Key Points">
            <ul className="flex flex-col gap-2">
              {keyPoints.map((pt, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--gold-400)] shrink-0" />
                  {pt}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {decisions.length > 0 && (
          <Section title="Decisions Made">
            <ul className="flex flex-col gap-2">
              {decisions.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                  <span className="mt-0.5 text-[var(--status-success)] text-base">✓</span>
                  {d}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {/* Action items */}
      {actionItems.length > 0 && (
        <Section title="Action Items">
          <div className="flex flex-col gap-2">
            {actionItems.map((item, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3">
                <span className="text-[var(--fg-muted)] mt-0.5">☐</span>
                <span className="text-sm text-[var(--fg-primary)]">{item}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Next meeting suggestion */}
      {nextMeeting && (
        <div className="rounded-xl border border-gold-400/20 bg-gold-400/5 px-4 py-3 flex items-start gap-3">
          <span className="text-[var(--gold-400)] text-base shrink-0">📅</span>
          <p className="text-sm text-[var(--fg-primary)]">{nextMeeting}</p>
        </div>
      )}

      {/* Follow-up draft — editable, and sendable by the host. */}
      {followUp && <FollowUpPanel meetingId={meeting.id} draft={followUp} canSend={isHost} />}

      {/* The recording, when there is one. Renders nothing otherwise: most
          meetings are not recorded, and an empty heading on every report would
          be noise on the majority of pages to serve the minority. */}
      <RecordingPanel
        meetingId={meeting.id}
        playerRef={playerRef}
        onRecordingReady={handleRecordingReady}
        onTime={handleTime}
      />

      {/* What was typed, next to what was said. Renders nothing when nobody
          used the chat, which is most meetings. */}
      <ChatPanel meetingId={meeting.id} />

      {/* Full transcript, read back into turns rather than shown as the raw
          block it is stored as. */}
      {report.full_transcript && (
        <TranscriptPanel
          transcript={report.full_transcript}
          cues={cues}
          onSeek={recordingStartedAt ? seekRecording : undefined}
          currentMs={recordingStartedAt ? playheadMs : undefined}
        />
      )}

    </div>
  );
}

/**
 * What the page should be showing, from what it has loaded.
 *
 * Kept next to the fetch because both the poll and the render ask it — the
 * poll has to stop for exactly the states the render treats as final,
 * and the two drifting apart is what a spinner over a forbidden report is.
 */
function viewStateOf(data: Data | undefined, waitedMs: number): ReportViewState {
  return reportViewState({
    loaded: data !== undefined,
    meetingExists: data !== null && data !== undefined,
    hostId: data?.meeting.host_id ?? null,
    viewerId: data?.viewerId ?? null,
    attended: data?.attended ?? false,
    // Two questions, not one. A row exists and says nothing is a finished
    // report; no row at all is one that may still be coming. Asking only
    // whether the summary was non-empty conflated them, and put a permanent
    // spinner over every report the model could not write.
    hasReport: Boolean(data?.report),
    hasSummary: Boolean(data?.report?.summary?.trim()),
    waitedMs,
  });
}

/**
 * The honest answer for someone who was not in the meeting.
 *
 * Meetings are visible across the organisation; their reports are not. Saying
 * so is the point — the alternative this replaces was a spinner that never
 * resolved, which reads as the product being broken rather than as a rule
 * being applied.
 */
function NotAnAttendeeState({ title }: { title: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 px-4 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-1)] text-[var(--fg-muted)]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="10.5" width="16" height="10" rx="2" />
          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
        </svg>
      </div>
      <p className="text-sm font-medium text-[var(--fg-primary)]">
        This report is limited to the people who were in the meeting.
      </p>
      <p className="max-w-sm text-xs text-[var(--fg-muted)]">
        {title ? `You weren\u2019t in \u201c${title}\u201d.` : "You weren\u2019t in this meeting."}{" "}
        Ask the host to share the summary if you need it.
      </p>
      <Link href="/meetings" className="mt-1 text-sm text-[var(--gold-400)] hover:underline">
        Back to meetings
      </Link>
    </div>
  );
}

/**
 * A report that is not coming.
 *
 * The page used to poll for this one every five seconds for as long as the tab
 * stayed open, showing a spinner the whole time. Nothing about that told
 * anybody what had happened or what to do about it.
 */
function StalledState({ title }: { title: string | null }) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-[var(--fg-primary)]">
        {title ?? "This meeting"} has no report yet
      </p>
      <p className="text-xs text-[var(--fg-muted)]">
        The summary has not arrived, and enough time has passed that it is probably not coming.
        The recording and transcript, if there are any, are kept either way — regenerating the
        report from the meeting log will try again.
      </p>
      <Link href="/meetings" className="text-sm text-[var(--gold-400)] hover:underline">
        Back to meetings
      </Link>
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <svg
        className="animate-spin h-6 w-6 text-[var(--gold-400)]"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <p className="text-sm text-[var(--fg-muted)]">Generating your report…</p>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function SentimentBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    positive: "bg-status-success/15 text-[var(--status-success)]",
    neutral: "bg-[var(--surface-3)] text-[var(--fg-secondary)]",
    negative: "bg-status-danger/15 text-[var(--status-danger)]",
    mixed: "bg-status-warning/15 text-[var(--status-warning)]",
  };
  const knownKey = value?.toLowerCase();
  const className = map[knownKey] ?? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
  const label = map[knownKey] ? value : `${value} (?)`;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${className}`}>
      {label}
    </span>
  );
}
