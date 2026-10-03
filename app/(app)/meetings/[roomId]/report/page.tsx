import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { createServerClient } from "@/lib/supabase/server";
import { AttendeeHistoryPanel } from "./AttendeeHistory";
import { FollowUpPanel } from "./FollowUpPanel";
import { ReportRevisions } from "./ReportRevisions";
import { ActionItemsList } from "./ActionItemsList";
import { FollowUpStatusChip } from "./FollowUpPanel";
import { ExportMenu } from "./ExportMenu";
import { ChatPanel } from "./ChatPanel";
import { ReportMedia } from "./ReportMedia";
import { ReportWaiting } from "./ReportWaiting";
import { ReportTabs } from "./ReportTabs";
import { reportTabs } from "@/lib/meetings/report-tabs";
import { LocalTime } from "./LocalTime";
import { loadReportPage } from "@/lib/meetings/report-page.server";
import { loadReportSide } from "@/lib/meetings/report-side.server";
import { linkActionItems, presenceFromSpeech, type ReportParticipant } from "@/lib/meetings/report-participants";
import {
  meetingHappenedAt,
  meetingMinutes,
  playableRecording,
  reportContent,
  reportOwedForMs,
} from "@/lib/meetings/report-page";
import { REPORT_WAIT_LIMIT_MS } from "@/lib/meetings/attendance";
import { callClock, isOneWay } from "@/lib/meetings/one-way";
import { AskEarnButton } from "@/components/AskEarnButton";

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

  // Who was there, where the follow-up stands, and the tasks the action items
  // became. A third read, after the document's own two, because it is about
  // acting on the report rather than reading it; it never fails the page.
  const side = await loadReportSide(supabase, {
    meetingId: meeting.id,
    hostId: meeting.host_id,
    invited: data.invited,
    hasFollowUp: Boolean(content.followUp),
    // The attendance table cannot hold an unauthenticated guest -- its RLS is
    // `user_id = auth.uid()` -- so an invitee who opened the link without
    // signing in left no row and the page reported them absent. Their lines in
    // the transcript are the evidence that survives, and the rows are already
    // loaded above.
    spoke: presenceFromSpeech(data.cueRows),
  });
  const actionItems = linkActionItems(content.actionItems, side.tasks);
  const recipients = side.participants.filter((p) => p.receivesFollowUp);
  const unreachable = side.participants
    .filter((p) => p.role !== "host" && !p.receivesFollowUp)
    .map((p) => p.name);

  // Wall clock between joining and ending. A one-way call has no started_at —
  // nobody joins a room that does not exist — so this is null for every recorded
  // call, and the recording's own length stands in below.
  const duration = meetingMinutes(meeting);
  const recordedSeconds = playableRecording(data.recordings)?.duration_seconds ?? null;
  const lengthLabel = duration ? `${duration} min` : recordedSeconds ? callClock(recordedSeconds) : null;
  const doneCount = actionItems.filter((item) => item.done).length;
  const hasBody =
    Boolean(content.summary) || content.keyPoints.length > 0 || content.decisions.length > 0;

  // The report a tab at a time; see ReportTabs. A tab only for what this
  // meeting has: no Chat tab for the meetings where nobody typed.
  const tabs = reportTabs({
    hasFollowUp: Boolean(content.followUp),
    followUpBadge: FOLLOW_UP_BADGE[side.followUp.kind] ?? null,
    hasRecording: data.recordings.length > 0,
    hasTranscript: Boolean(content.transcript?.trim()) || data.cueRows.length > 0,
    chatCount: data.chat.length,
    actionItemCount: actionItems.length,
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
      {/* Header */}
      <header className="flex flex-col gap-4">
        <Link href="/meetings" className="w-fit text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]">
          ← Meetings
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="text-xl font-semibold text-[var(--fg-primary)] sm:text-2xl break-words">
              {meeting.title ?? "Meeting"}
            </h1>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              {/* In the READER's time zone, not the server's. A meeting at 20:00
                  in New York is 00:00 UTC the next day, so formatting this here
                  would print the wrong weekday and the wrong date. */}
              <LocalTime
                iso={meetingHappenedAt(meeting)}
                options={{ weekday: "long", year: "numeric", month: "long", day: "numeric" }}
              />
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {content.followUp && data.isHost && (
              <a
                href="#follow-up"
                className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-[#0d0d10] hover:opacity-90"
              >
                Review follow-up
              </a>
            )}
            <AskEarnButton type="meeting" id={roomId} name={meeting.title ?? "this meeting"} />
            <ExportMenu roomId={roomId} />
          </div>
        </div>

        {/* The meeting at a glance. Three across on a phone, so the five facts
            take two short rows rather than pushing the tabs a screen down. */}
        <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Stat label="Length" value={lengthLabel ?? "—"} />
          <Stat label="People" value={side.participants.length ? String(side.participants.length) : "—"} />
          <Stat label="Decisions" value={String(content.decisions.length)} />
          <Stat
            label="Action items"
            value={actionItems.length ? `${doneCount}/${actionItems.length} done` : "0"}
          />
          <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2.5 py-2 sm:px-3">
            <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">Sentiment</dt>
            <dd>{content.sentiment ? <SentimentBadge value={content.sentiment} /> : <span className="text-sm text-[var(--fg-muted)]">—</span>}</dd>
          </div>
        </dl>
      </header>

      <ReportTabs
        tabs={tabs}
        panels={{
          overview: (
            <div className="flex flex-col gap-5">
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
                // is the page where the answer is actually needed.
                <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-3">
                  <summary className="cursor-pointer text-xs font-medium text-[var(--fg-secondary)]">
                    {/* The hour matters most here and is the easiest to get wrong. */}
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
                    follow-up draft — may be incomplete. Regenerating it will try again.
                  </p>
                </div>
              )}

              {/* Summary */}
              {content.summary && (
                <Section title="Summary">
                  <p className="text-[15px] leading-relaxed text-[var(--fg-primary)]">{content.summary}</p>
                </Section>
              )}

              {/* Action items — straight after the summary, because they are what the
                  meeting left people to do. Ticked off here, as the tasks they became. */}
              {actionItems.length > 0 ? (
                <ActionItemsList
                  meetingId={meeting.id}
                  items={actionItems}
                  viewerId={data.viewerId}
                  isHost={data.isHost}
                />
              ) : hasBody ? (
                <Section title="Action items">
                  <EmptyNote>No action items were captured in this meeting.</EmptyNote>
                </Section>
              ) : null}

              {/* Decisions + key points. Decisions first: they are what the meeting
                  settled, and the follow-up commits people to them. */}
              {hasBody && (content.decisions.length > 0 || content.keyPoints.length > 0) && (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <Section title="Decisions" count={content.decisions.length}>
                    {content.decisions.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {content.decisions.map((d, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                            <span className="mt-0.5 text-[var(--status-success)]" aria-hidden="true">✓</span>
                            {d}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyNote>No decisions were recorded.</EmptyNote>
                    )}
                  </Section>
                  <Section title="Key points" count={content.keyPoints.length}>
                    {content.keyPoints.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {content.keyPoints.map((pt, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gold-400)]" aria-hidden="true" />
                            {pt}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyNote>No key points were recorded.</EmptyNote>
                    )}
                  </Section>
                </div>
              )}

              {/* Next meeting suggestion */}
              {content.nextMeeting && (
                <div className="flex items-start gap-3 rounded-xl border border-gold-400/20 bg-gold-400/5 px-4 py-3">
                  <span className="shrink-0 text-base text-[var(--gold-400)]" aria-hidden="true">📅</span>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">Next meeting</p>
                    <p className="mt-0.5 text-sm text-[var(--fg-primary)]">{content.nextMeeting}</p>
                  </div>
                </div>
              )}
            </div>
          ),
          "follow-up": (
            <>
              {/* Follow-up draft — editable, and sendable by the host. Keyed on the
                  draft so a corrected or restored report replaces what the panel holds
                  rather than leaving the old words in its local state. */}
              {content.followUp && (
                <FollowUpPanel
                  key={content.followUp}
                  meetingId={meeting.id}
                  draft={content.followUp}
                  canSend={data.isHost}
                  recipients={recipients}
                  unreachable={unreachable}
                  hostName={side.hostName}
                  status={side.followUp}
                />
              )}
            </>
          ),
          media: (
            <>
              {/* The recording and the transcript, which are the one pair that has to
                  share state: a line seeks the player, and the playhead moves the
                  highlight back. */}
              <ReportMedia
                meetingId={meeting.id}
                recordings={data.recordings}
                cueRows={data.cueRows}
                transcript={content.transcript}
              />
            </>
          ),
          chat: (
            <>
              {/* What was typed, next to what was said. Renders nothing when nobody
                  used the chat, which is most meetings. */}
              <ChatPanel messages={data.chat} />
            </>
          ),
        }}
        aside={
          <>
            <ParticipantsCard participants={side.participants} />

            {content.followUp && (
              // Wide screens only: on a phone this card would sit in the Details
              // tab, one tab away from the Follow-up tab that already says it.
              <div className="hidden flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 lg:flex">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">Follow-up</p>
                  <FollowUpStatusChip state={side.followUp} />
                </div>
                <p className="text-xs text-[var(--fg-muted)]">
                  {recipients.length
                    ? `To ${recipients.length} ${recipients.length === 1 ? "person" : "people"}, each greeted by name.`
                    : "Nobody on this meeting has an email address yet."}
                </p>
                <a href="#follow-up" className="text-xs font-semibold text-[var(--gold-400)] hover:underline">
                  {data.isHost ? "Review and send →" : "Read the follow-up →"}
                </a>
              </div>
            )}

            {/* Correct-and-regenerate for the host; the version history for anyone
                who may read the report. */}
            <ReportRevisions meetingId={meeting.id} isHost={data.isHost} />

            {/* What the inbox holds on the people who were here.
                Suspended on purpose: its reads are keyed off the attendance rows, so
                awaiting it in loadReportPage would have put another round trip in
                front of the summary. The fallback is nothing rather than a skeleton,
                because on most meetings the answer is nothing. */}
            <Suspense fallback={null}>
              <AttendeeHistoryPanel
                meetingId={meeting.id}
                organizationId={data.organizationId}
                invited={data.invited}
                viewerEmail={data.viewerEmail}
                meetingTitle={meeting.title}
                actionItems={content.actionItems}
              />
            </Suspense>
          </>
        }
      />
    </div>
  );
}

/** Where the follow-up stands, in a word, for its tab. */
const FOLLOW_UP_BADGE: Partial<Record<string, string>> = {
  sent: "Sent",
  drafted: "Draft",
  not_sent: "Not sent",
};

const ROLE_LABEL: Record<ReportParticipant["role"], string> = {
  host: "Host",
  invitee: "Invitee",
  attendee: "Attendee",
};

/** Who the meeting was between, and in what role — the page never used to say. */
function ParticipantsCard({ participants }: { participants: ReportParticipant[] }) {
  if (participants.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
        Participants <span className="text-[var(--fg-muted)]">· {participants.length}</span>
      </p>
      <ul className="flex flex-col gap-2.5">
        {participants.map((p) => (
          <li key={`${p.role}:${p.email ?? p.name}`} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                p.role === "host"
                  ? "bg-[var(--gold-400)] text-[#0d0d10]"
                  : "bg-[var(--surface-3)] text-[var(--fg-secondary)]"
              }`}
            >
              {initials(p.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[var(--fg-primary)]" title={p.email ?? undefined}>
                {p.name}
              </p>
              <p className="text-[11px] text-[var(--fg-muted)]">
                {ROLE_LABEL[p.role]}
                {p.attended === false ? " · didn’t join" : ""}
                {p.role !== "host" && !p.email ? " · no email" : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function initials(name: string): string {
  // Letters only: "Guest (phone)" is "GP", not "G(".
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .map((part) => part.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2.5 py-2 sm:px-3">
      <dt className="truncate text-[10px] uppercase tracking-wide text-[var(--fg-muted)] sm:text-[11px]">{label}</dt>
      <dd className="text-sm font-medium text-[var(--fg-primary)]">{value}</dd>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--fg-muted)]">{children}</p>;
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

/**
 * The report's shape, before the report. A spinner alone gave no sense of what
 * was coming or that anything was; this shows where the summary, the action
 * items and the follow-up will land.
 */
function GeneratingState() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8" aria-busy="true">
      <div className="flex items-center gap-3">
        <svg
          className="h-5 w-5 animate-spin text-[var(--gold-400)]"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-[var(--fg-muted)]">Generating your report…</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-[var(--surface-1)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-hidden="true">
        <div className="flex flex-col gap-5">
          <div className="h-28 animate-pulse rounded-xl bg-[var(--surface-1)]" />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="h-40 animate-pulse rounded-xl bg-[var(--surface-1)]" />
            <div className="h-40 animate-pulse rounded-xl bg-[var(--surface-1)]" />
          </div>
          <div className="h-48 animate-pulse rounded-xl bg-[var(--surface-1)]" />
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-[var(--surface-1)]" />
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  count,
}: {
  title: string;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
        {title}
        {count ? <span className="text-[var(--fg-muted)]"> · {count}</span> : null}
      </h2>
      {children}
    </section>
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
