"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  groupLogsByMonth,
  logEntrySubtitle,
  matchesLogSearch,
  type MeetingLogEntry,
} from "@/lib/meetings/meeting-log";

// The meeting log: what every meeting left behind, kept so it can be found
// again months later.
//
// Rows are collapsed to a line each and open in place. A log is something you
// scan for one meeting, not something you read — so the default is the shortest
// thing that still identifies a meeting, and the detail is one click away
// rather than a page away.

export function MeetingLogs({ entries }: { entries: MeetingLogEntry[] }) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const groups = useMemo(
    () => groupLogsByMonth(entries.filter((e) => matchesLogSearch(e, query))),
    [entries, query],
  );

  const total = entries.length;
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-10 text-center">
        <p className="text-sm text-[var(--fg-primary)]">No meetings yet</p>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Once a meeting ends, its summary, decisions and action items are kept here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)]">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search summaries, decisions, action items, people…"
            aria-label="Search the meeting log"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] py-2 pl-9 pr-3 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--gold-400)] focus:outline-none"
          />
        </div>
        <span className="shrink-0 text-xs text-[var(--fg-muted)]">
          {query.trim() ? `${shown} of ${total}` : `${total} meeting${total === 1 ? "" : "s"}`}
        </span>
      </div>

      {shown === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-8 text-center">
          <p className="text-sm text-[var(--fg-primary)]">Nothing matches “{query.trim()}”</p>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            The log searches titles, summaries, decisions, action items and attendees.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
              {group.label}
            </h3>
            <div className="flex flex-col gap-1.5">
              {group.entries.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  open={openId === entry.id}
                  onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function LogRow({
  entry, open, onToggle,
}: {
  entry: MeetingLogEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const when = new Date(entry.occurredAt);
  const dateLabel = Number.isFinite(when.getTime())
    ? when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "Undated";

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
      >
        <span className={`shrink-0 text-[var(--fg-muted)] transition-transform ${open ? "rotate-90" : ""}`}>
          <ChevronIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--fg-primary)]">
            {entry.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--fg-muted)]">
            {dateLabel}
            {entry.durationMinutes ? ` · ${entry.durationMinutes} min` : ""}
            {` · ${logEntrySubtitle(entry)}`}
          </span>
        </span>
        {entry.attendeeNames.length > 0 && (
          <span className="hidden shrink-0 text-xs text-[var(--fg-muted)] sm:block">
            {entry.attendeeNames.length} attendee{entry.attendeeNames.length === 1 ? "" : "s"}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--line)] px-4 py-4">
          {entry.hasReport ? (
            <div className="flex flex-col gap-4">
              <Detail label="Summary">
                <p className="text-sm leading-relaxed text-[var(--fg-primary)]">{entry.summary}</p>
              </Detail>
              {entry.keyPoints.length > 0 && <DetailList label="Key points" items={entry.keyPoints} />}
              {entry.decisions.length > 0 && <DetailList label="Decisions" items={entry.decisions} marker="✓" />}
              {entry.actionItems.length > 0 && <DetailList label="Action items" items={entry.actionItems} marker="☐" />}
              {entry.attendeeNames.length > 0 && (
                <Detail label="Attendees">
                  <p className="text-sm text-[var(--fg-secondary)]">{entry.attendeeNames.join(", ")}</p>
                </Detail>
              )}
            </div>
          ) : entry.attended ? (
            <p className="text-sm text-[var(--fg-muted)]">
              This meeting has no report. One is generated when a meeting is ended from inside the room.
            </p>
          ) : (
            // Not the same sentence as "no report", and the difference matters:
            // the record exists, it is simply not this member's to read. Saying
            // "no report" here would be the log misreporting its own contents.
            <p className="text-sm text-[var(--fg-muted)]">
              You weren&rsquo;t in this meeting, so its report isn&rsquo;t shown here. Ask the host if you need it.
            </p>
          )}

          {/* The report page is where the transcript and the export live. The
              log deliberately does not load a transcript to draw a list. */}
          {entry.attended && (
            <div className="mt-4 flex items-center gap-3 border-t border-[var(--line)] pt-3">
              <Link
                href={`/meetings/${entry.roomCode}/report`}
                className="text-xs font-medium text-[var(--gold-400)] transition-colors hover:text-[var(--gold-500)]"
              >
                Open full report →
              </Link>
              <span className="text-xs text-[var(--fg-muted)]">
                Transcript and export are on the report
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">{label}</p>
      {children}
    </div>
  );
}

function DetailList({ label, items, marker = "•" }: { label: string; items: string[]; marker?: string }) {
  return (
    <Detail label={label}>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
            <span className="mt-0.5 shrink-0 text-[var(--fg-muted)]">{marker}</span>
            {item}
          </li>
        ))}
      </ul>
    </Detail>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
