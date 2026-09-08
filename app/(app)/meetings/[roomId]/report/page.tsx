"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CopyButton } from "./CopyButton";
import { ExportMenu } from "./ExportMenu";
import { TranscriptPanel } from "./TranscriptPanel";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { reportViewState, shouldPollReport, type ReportViewState } from "@/lib/meetings/attendance";

type Meeting = {
  id: string;
  host_id: string | null;
  title: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

type Report = {
  summary: string | null;
  key_points: string[] | null;
  action_items: string[] | null;
  analysis: Record<string, unknown> | null;
  full_transcript: string | null;
};

type Data = { meeting: Meeting; report: Report | null; attended: boolean; viewerId: string | null } | null;

const POLL_INTERVAL = 5000;

export default function MeetingReportPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [data, setData] = useState<Data | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchReport() {
    const supabase = createClient();

    const [{ data: { user } }, { data: meeting }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("live_meetings")
        .select("id, host_id, title, created_at, started_at, ended_at")
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

    const next: Data = {
      meeting: meeting as Meeting,
      report: (report as Report | null) ?? null,
      attended: Boolean(attendance),
      viewerId: user?.id ?? null,
    };
    setData(next);

    if (!shouldPollReport(viewStateOf(next))) stopPolling();
  }

  function stopPolling() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    fetchReport();

    // Start polling; fetchReport will stop it when status is terminal
    intervalRef.current = setInterval(fetchReport, POLL_INTERVAL);

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const state = viewStateOf(data);

  if (state === "loading" || state === "generating") return <GeneratingState />;
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

  // Narrowed by the states above: "ready" means both of these are present.
  const { meeting, report } = data!;
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
            {new Date(meeting.created_at as string).toLocaleDateString("en-US", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })}
            {duration ? ` · ${duration} min` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sentiment && <SentimentBadge value={sentiment} />}
          <ExportMenu roomId={roomId} />
        </div>
      </div>

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
        <div className="rounded-xl border border-[var(--gold-400)]/20 bg-[var(--gold-400)]/5 px-4 py-3 flex items-start gap-3">
          <span className="text-[var(--gold-400)] text-base shrink-0">📅</span>
          <p className="text-sm text-[var(--fg-primary)]">{nextMeeting}</p>
        </div>
      )}

      {/* Follow-up draft */}
      {followUp && (
        <Section title="Follow-up Draft" action={<CopyButton text={followUp} />}>
          <pre className="text-sm text-[var(--fg-primary)] whitespace-pre-wrap font-sans leading-relaxed">
            {followUp}
          </pre>
        </Section>
      )}

      {/* Full transcript, read back into turns rather than shown as the raw
          block it is stored as. */}
      {report.full_transcript && <TranscriptPanel transcript={report.full_transcript} />}

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
function viewStateOf(data: Data | undefined): ReportViewState {
  return reportViewState({
    loaded: data !== undefined,
    meetingExists: data !== null && data !== undefined,
    hostId: data?.meeting.host_id ?? null,
    viewerId: data?.viewerId ?? null,
    attended: data?.attended ?? false,
    hasSummary: Boolean(data?.report?.summary),
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
    positive: "bg-[var(--status-success)]/15 text-[var(--status-success)]",
    neutral: "bg-[var(--surface-3)] text-[var(--fg-secondary)]",
    negative: "bg-[var(--status-danger)]/15 text-[var(--status-danger)]",
    mixed: "bg-[var(--status-warning)]/15 text-[var(--status-warning)]",
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
