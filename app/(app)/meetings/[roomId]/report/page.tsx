import Link from "next/link";
import type { Metadata } from "next";
import { createServerClient } from "@/lib/supabase/server";
import { FollowUpPanel } from "./FollowUpPanel";
import { ExportMenu } from "./ExportMenu";
import { ChatPanel } from "./ChatPanel";
import { ReportMedia } from "./ReportMedia";
import { ReportWaiting } from "./ReportWaiting";
import { LocalTime } from "./LocalTime";
import { loadReportPage } from "@/lib/meetings/report-page.server";
import {
  meetingHappenedAt,
  meetingMinutes,
  playableRecording,
  reportContent,
  reportOwedForMs,
} from "@/lib/meetings/report-page";
import { REPORT_WAIT_LIMIT_MS } from "@/lib/meetings/attendance";
import { callClock, isOneWay } from "@/lib/meetings/one-way";

export const metadata: Metadata = {
  title: "Meeting report — FundExecs OS",
  description: "Summary, decisions, action items, recording and transcript for a meeting.",
};

/**
 * A report is a document, and this page now renders it like one.
 *
 * It was a client component that made SEVEN browser round trips before anything
 * appeared: who is reading, the meeting, the report, the attendance row, the
 * timed transcript, the recordings and the chat — the last two fired by panels
 * mounting, so they could not even start until the rest had rendered. All of it
 * for content that was finished before anybody opened the page.
 *
 * Now the server reads all seven in two waves (see report-page.server.ts) and
 * sends markup. Three things stay on the client, because each is genuinely
 * interactive rather than merely dynamic:
 *
 *   ExportMenu   — a dropdown.
 *   FollowUpPanel — an editable draft with a send.
 *   ReportMedia  — the <video> and the searchable transcript, which are one
 *                  island because a transcript line seeks the recording and the
 *                  playhead moves the highlight back.
 *
 * And one that is neither: ReportWaiting, for the seconds between a meeting
 * ending and the background route writing its report. That is the only live fact
 * on the page, and it now costs one small request rather than a full re-read of
 * everything above.
 *
 * `force-dynamic` because every part of this is per-reader: RLS decides what the
 * report even contains, so a cached render would be one person's report served
 * to the next.
 */
export const dynamic = "force-dynamic";

export default async function MeetingReportPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const supabase = await createServerClient();
  const data = await loadReportPage(supabase, roomId);

  if (data.state === "missing") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-[var(--fg-muted)]">Meeting not found.</p>
        <Link href="/meetings" className="text-sm text-[var(--gold-400)] hover:underline">
          Back to meetings
        </Link>
      </div>
    );
  }

  const meeting = data.meeting!;

  if (data.state === "forbidden") return <NotAnAttendeeState title={meeting.title} />;
  if (data.state === "stalled") return <StalledState title={meeting.title} />;

  if (data.state === "loading" || data.state === "generating") {
    // The remaining patience, not a fresh allowance: somebody opening a
    // five-minute-old meeting waits the last minute rather than another six.
    const remaining = Math.max(0, REPORT_WAIT_LIMIT_MS - reportOwedForMs(meeting, Date.now()));
    return (
      <>
        <GeneratingState />
        <ReportWaiting roomId={roomId} stopAfterMs={remaining} />
      </>
    );
  }

  // Narrowed by the states above: the meeting is present, the viewer may read
  // it, and there is a report row. "unsummarised" means a row with nothing in
  // the summary, not the absence of one.
  const report = data.report!;
  const content = reportContent(report);
  const oneWay = isOneWay(meeting);

  // Wall clock between joining and ending. A one-way call has no started_at —
  // nobody joins a room that does not exist — so this is null for every recorded
  // call, and the recording's own length stands in below.
  const duration = meetingMinutes(meeting);
  const recordedSeconds = playableRecording(data.recordings)?.duration_seconds ?? null;

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
            {/* In the READER's time zone, not the server's. A meeting at 20:00
                in New York is 00:00 UTC the next day, so formatting this here
                would print the wrong weekday and the wrong date. */}
            <LocalTime
              iso={meetingHappenedAt(meeting)}
              options={{ weekday: "long", year: "numeric", month: "long", day: "numeric" }}
            />
            {duration ? ` · ${duration} min` : recordedSeconds ? ` · ${callClock(recordedSeconds)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {content.sentiment && <SentimentBadge value={content.sentiment} />}
          <ExportMenu roomId={roomId} />
        </div>
      </div>

      {data.state === "unsummarised" && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
          <p className="text-xs font-medium text-[var(--fg-primary)]">No summary was written</p>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
            {/* Keyed on whether there are words, NOT on the kind of session.
                The route writes an empty summary down two paths: a call with
                nothing transcribed, and a model call that failed on a real
                transcript. Saying "nothing was transcribed" above a full
                transcript would be the page contradicting itself — and would
                withhold the regenerate advice that actually fixes the row. */}
            {content.transcript?.trim()
              ? "The analysis could not be completed, so there is no summary. Everything that was captured is below, and regenerating the report from the meeting log will try again."
              : oneWay
                ? "Nothing was transcribed on this call, so there was nothing to summarise. The recording is below."
                : "Nothing was transcribed in this meeting, so there was nothing to summarise."}
          </p>
        </div>
      )}

      {data.consent && (
        // Stored precisely so that somebody can answer "should this have been
        // recorded?" months later. The archive shows that consent exists; this
        // is the page where the answer is actually needed, and until now it
        // was the one place that held the record and never showed it.
        <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--fg-secondary)]">
            {/* The hour matters most here and is the easiest to get wrong: this
                record exists so somebody can answer "was this recorded with
                consent, and when". A UTC hour wearing no label is a quietly
                wrong answer to that. */}
            Consent recorded{" "}
            <LocalTime
              iso={data.consent.at}
              options={{
                month: "short", day: "numeric", year: "numeric",
                hour: "numeric", minute: "2-digit",
              }}
            />
          </summary>
          <p className="mt-2 text-xs italic text-[var(--fg-primary)]">&ldquo;{data.consent.disclosure}&rdquo;</p>
          <p className="mt-1.5 text-xs text-[var(--fg-muted)]">
            The person recording confirmed they had consent from everyone on the call.
            {data.consent.sources.length > 0 && ` Captured: ${data.consent.sources.join(" and ")}.`}
          </p>
        </details>
      )}

      {content.truncated && (
        <div className="rounded-xl border border-[var(--status-warning,#f59e0b)]/40 bg-[var(--status-warning,#f59e0b)]/10 px-4 py-3">
          <p className="text-xs font-medium text-[var(--fg-primary)]">This report was cut short</p>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
            The analysis ran out of room before it finished, so the later sections — usually the
            follow-up draft — may be incomplete. Regenerating it from the meeting log will try again.
          </p>
        </div>
      )}

      {/* Summary */}
      {content.summary && (
        <Section title="Summary">
          <p className="text-sm text-[var(--fg-primary)] leading-relaxed">{content.summary}</p>
        </Section>
      )}

      {/* Key points + decisions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {content.keyPoints.length > 0 && (
          <Section title="Key Points">
            <ul className="flex flex-col gap-2">
              {content.keyPoints.map((pt, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--gold-400)] shrink-0" />
                  {pt}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {content.decisions.length > 0 && (
          <Section title="Decisions Made">
            <ul className="flex flex-col gap-2">
              {content.decisions.map((d, i) => (
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
      {content.actionItems.length > 0 && (
        <Section title="Action Items">
          <div className="flex flex-col gap-2">
            {content.actionItems.map((item, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3">
                <span className="text-[var(--fg-muted)] mt-0.5">☐</span>
                <span className="text-sm text-[var(--fg-primary)]">{item}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Next meeting suggestion */}
      {content.nextMeeting && (
        <div className="rounded-xl border border-gold-400/20 bg-gold-400/5 px-4 py-3 flex items-start gap-3">
          <span className="text-[var(--gold-400)] text-base shrink-0">📅</span>
          <p className="text-sm text-[var(--fg-primary)]">{content.nextMeeting}</p>
        </div>
      )}

      {/* Follow-up draft — editable, and sendable by the host. */}
      {content.followUp && (
        <FollowUpPanel meetingId={meeting.id} draft={content.followUp} canSend={data.isHost} />
      )}

      {/* The recording and the transcript, which are the one pair that has to
          share state: a line seeks the player, and the playhead moves the
          highlight back. */}
      <ReportMedia
        meetingId={meeting.id}
        recordings={data.recordings}
        cueRows={data.cueRows}
        transcript={content.transcript}
      />

      {/* What was typed, next to what was said. Renders nothing when nobody
          used the chat, which is most meetings. */}
      <ChatPanel messages={data.chat} />
    </div>
  );
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
        {title ? `You weren’t in “${title}”.` : "You weren’t in this meeting."}{" "}
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
 *
 * And the clock it gave up by was the tab's, not the report's — so a reload
 * bought another six minutes of spinner, and a report that failed last week
 * still promised to arrive. It is measured from the meeting now, which is the
 * thing that is actually late.
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
