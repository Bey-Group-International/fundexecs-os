// Where we are with the people who were in this meeting.
//
// The report ends at what happened in the room. The question it leaves a reader
// with is the CRM question — "what else is going on with these people, and who
// have we never written to" — and the answer was two pages away, reachable only
// by searching the inbox for each attendee by hand.
//
// A server component with its OWN load, rendered inside the page's Suspense
// boundary. The report is a document and must not wait on a sidebar: the reads
// this needs are keyed off the attendance rows, so folding them into
// loadReportPage would have put a third round trip in front of the summary.
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { INBOX_CHANNELS } from "@/lib/inbox/channels";
import type { InboxChannel } from "@/lib/supabase/database.types";
import { loadAttendeeInboxHistory } from "@/lib/meetings/report-inbox.server";
import type { AttendeeHistory as Attendee, ThreadDigest } from "@/lib/meetings/report-inbox";
import { LocalTime } from "./LocalTime";
import { StartConversation } from "./StartConversation";
import { getSessionContext } from "@/lib/auth";

/**
 * The inbox has no per-thread URL — threads expand in place on the board — so
 * every link here goes to that person's conversations rather than pretending a
 * single thread is addressable. Which is also the more useful destination: the
 * reader is asking about the person, not about one email.
 */
function inboxSearchHref(email: string): string {
  return `/inbox?q=${encodeURIComponent(email)}`;
}

/** The channel's label, or the raw key for a channel this build does not know. */
function channelLabel(channel: string): string {
  return INBOX_CHANNELS[channel as InboxChannel]?.label ?? channel;
}

export async function AttendeeHistoryPanel({
  meetingId,
  organizationId,
  invited,
  viewerEmail,
  meetingTitle = null,
  actionItems = [],
}: {
  meetingId: string;
  organizationId: string | null;
  invited: unknown;
  viewerEmail: string | null;
  /** For the "Start conversation" composer's opening message. */
  meetingTitle?: string | null;
  actionItems?: readonly string[];
}) {
  const supabase = await createServerClient();
  const [history, session] = await Promise.all([
    loadAttendeeInboxHistory(supabase, {
      meetingId,
      organizationId,
      invited,
      viewerEmail,
    }),
    getSessionContext(),
  ]);
  // Only a member of the meeting's organisation has an inbox to start a
  // conversation from. A guest attendee reads the same report without it.
  const canMessage = Boolean(organizationId) && session?.orgId === organizationId;
  const composer = (recipient: { name: string; email: string }) =>
    canMessage ? (
      <StartConversation
        meetingId={meetingId}
        meetingTitle={meetingTitle}
        recipient={recipient}
        actionItems={actionItems}
      />
    ) : null;

  // Nothing to say: no attendee has a thread and none is missing one either,
  // which is every one-way recording and every meeting the reader held alone.
  if (history.attendees.length === 0 && history.untouched.length === 0 && !history.capped) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
          Where we are with them
        </h2>
        <Link href="/inbox" className="shrink-0 text-xs text-[var(--gold-400)] hover:underline">
          Open inbox
        </Link>
      </div>

      {history.attendees.length > 0 && (
        <ul className="flex flex-col gap-3">
          {history.attendees.map((attendee) => (
            <AttendeeCard
              key={attendee.email}
              attendee={attendee}
              composer={composer({ name: attendee.name, email: attendee.email })}
            />
          ))}
        </ul>
      )}

      {history.untouched.length > 0 && (
        // The most actionable line on a follow-up page, and the reason these are
        // listed together instead of each getting an empty card: eight cards
        // saying "nothing" is the reliable way to make nobody read any of them.
        <div className="border-t border-[var(--line)] pt-3">
          {canMessage ? (
            <p className="text-xs text-[var(--fg-muted)]">No inbox history yet:</p>
          ) : (
            <p className="text-xs text-[var(--fg-muted)]">
              No inbox history for{" "}
              <span className="text-[var(--fg-secondary)]">
                {history.untouched.map((person) => person.name).join(", ")}
              </span>
              .
            </p>
          )}
          {/* The people most likely to need a first message: offered one each. */}
          {canMessage && (
            <ul className="mt-1 flex flex-col">
              {history.untouched.map((person) => (
                <li key={person.email} className="text-xs text-[var(--fg-secondary)]">
                  <span className="mr-2">{person.name}</span>
                  {composer({ name: person.name, email: person.email })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Said instead of the line above, never alongside it. The read was cut
          short, so "nobody else has been written to" would be a guess presented as
          a fact — and it is the one line on this panel somebody would act on. */}
      {history.capped && (
        <p className="text-xs text-[var(--fg-muted)] border-t border-[var(--line)] pt-3">
          This meeting has more correspondence than fits here, so the attendees with
          no history are not listed.{" "}
          <Link href="/inbox" className="text-[var(--gold-400)] hover:underline">
            Check the inbox
          </Link>
          .
        </p>
      )}
    </section>
  );
}

function AttendeeCard({ attendee, composer }: { attendee: Attendee; composer: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <Link
            href={inboxSearchHref(attendee.email)}
            className="text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--gold-400)]"
          >
            {attendee.name}
          </Link>
          {/* Shown when the name is a name. The recipient rules fall back to the
              address as the name, and printing it twice reads as a bug. */}
          {attendee.name !== attendee.email && (
            <span className="ml-2 text-xs text-[var(--fg-muted)]">{attendee.email}</span>
          )}
        </div>
        <p className="text-xs text-[var(--fg-muted)] shrink-0">
          {attendee.lastContactAt ? (
            <>
              last contact{" "}
              <LocalTime
                iso={attendee.lastContactAt}
                options={{ month: "short", day: "numeric", year: "numeric" }}
              />
            </>
          ) : (
            "no messages yet"
          )}
          {attendee.unread > 0 && (
            <span className="ml-2 text-[var(--gold-400)]">{attendee.unread} unread</span>
          )}
        </p>
      </div>

      <ul className="mt-2 flex flex-col gap-1.5">
        {attendee.threads.map((thread) => (
          <ThreadRow key={thread.id} thread={thread} />
        ))}
      </ul>

      {/* What the bound is not showing, rather than implying there is no more. */}
      {attendee.total > attendee.threads.length && (
        <Link
          href={inboxSearchHref(attendee.email)}
          className="mt-2 inline-block text-xs text-[var(--gold-400)] hover:underline"
        >
          {attendee.total - attendee.threads.length} more in the inbox
        </Link>
      )}
      {composer}
    </li>
  );
}

function ThreadRow({ thread }: { thread: ThreadDigest }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0 text-[var(--fg-muted)]" aria-hidden="true">
        {INBOX_CHANNELS[thread.channel as InboxChannel]?.icon ?? "•"}
      </span>
      <div className="min-w-0">
        <p className="text-[var(--fg-primary)]">
          <span className={thread.unread ? "font-semibold" : ""}>{thread.subject}</span>
          {/* This meeting's own follow-up thread, where replies to it arrive. */}
          {thread.fromThisMeeting && (
            <span className="ml-2 rounded border border-[var(--gold-400)]/40 px-1 font-mono text-[10px] uppercase tracking-wider text-[var(--gold-400)]">
              Follow-up
            </span>
          )}
          <span className="ml-2 text-[var(--fg-muted)]">{channelLabel(thread.channel)}</span>
          {/* A done or snoozed thread reads very differently from an open one on
              a page about what to do next, so the status is said rather than
              implied by ordering. */}
          {thread.status !== "open" && (
            <span className="ml-2 text-[var(--fg-muted)]">· {thread.status}</span>
          )}
          {thread.lastMessageAt && (
            <span className="ml-2 text-[var(--fg-muted)]">
              ·{" "}
              <LocalTime
                iso={thread.lastMessageAt}
                options={{ month: "short", day: "numeric" }}
              />
            </span>
          )}
        </p>
        {thread.summary && <p className="text-[var(--fg-muted)]">{thread.summary}</p>}
      </div>
    </li>
  );
}
