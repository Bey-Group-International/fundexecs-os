"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  groupLogsByMonth,
  logEntrySubtitle,
  matchesLogSearch,
  type MeetingLogEntry,
} from "@/lib/meetings/meeting-log";
import { CARD, EYEBROW } from "./tone";

// The meeting log: what every meeting left behind, kept so it can be found
// again months later.
//
// Rows are collapsed to a line each and open in place. A log is something you
// scan for one meeting, not something you read — so the default is the shortest
// thing that still identifies a meeting, and the detail is one click away
// rather than a page away.

export function MeetingLogs({ entries: initialEntries }: { entries: MeetingLogEntry[] }) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Held locally so a regenerated report replaces its row in place. The
  // alternative is router.refresh(), which re-runs the page's whole server
  // query and collapses the row you were reading.
  const [entries, setEntries] = useState(initialEntries);

  // ...but local state must still yield to the server. Siblings under
  // MeetingsLanding call router.refresh() after scheduling or saving a
  // meeting, which re-renders this component with new props WITHOUT
  // unmounting it. Without this the Logs tab's count badge (read from the
  // prop) moved while the list below it kept a stale snapshot, and the two
  // disagreed for the rest of the session. Adjusted during render rather than
  // in an effect: an effect would paint the stale list once first.
  const [lastProp, setLastProp] = useState(initialEntries);
  if (initialEntries !== lastProp) {
    setLastProp(initialEntries);
    setEntries(initialEntries);
  }

  const replaceEntry = useCallback(
    (next: MeetingLogEntry) =>
      setEntries((prev) => prev.map((e) => (e.id === next.id ? next : e))),
    [],
  );

  const groups = useMemo(
    () => groupLogsByMonth(entries.filter((e) => matchesLogSearch(e, query))),
    [entries, query],
  );

  const total = entries.length;
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);

  if (total === 0) {
    return (
      <div className={`${CARD} border-dashed px-4 py-10 text-center`}>
        <p className="text-sm font-medium text-fg-primary">No meetings yet</p>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          Once a meeting ends, its summary, decisions and action items are kept here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search summaries, decisions, action items, people…"
            aria-label="Search the meeting log"
            className="w-full rounded-lg border border-line bg-surface-1 py-2 pl-9 pr-3 text-sm text-fg-primary transition-colors placeholder:text-fg-muted focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/30"
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-fg-muted">
          {query.trim() ? `${shown} of ${total}` : `${total} meeting${total === 1 ? "" : "s"}`}
        </span>
      </div>

      {shown === 0 ? (
        <div className={`${CARD} border-dashed px-4 py-8 text-center`}>
          <p className="text-sm font-medium text-fg-primary">Nothing matches “{query.trim()}”</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            The log searches titles, summaries, decisions, action items and attendees.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h3 className={`px-1 ${EYEBROW}`}>{group.label}</h3>
            <div className="flex flex-col gap-1.5">
              {group.entries.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  open={openId === entry.id}
                  onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
                  onRegenerated={replaceEntry}
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
  entry, open, onToggle, onRegenerated,
}: {
  entry: MeetingLogEntry;
  open: boolean;
  onToggle: () => void;
  onRegenerated: (entry: MeetingLogEntry) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${entry.id}/report/regenerate`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { entry?: MeetingLogEntry; error?: string };
      if (!res.ok || !json.entry) {
        setError(json.error ?? "Could not regenerate the report.");
        return;
      }
      onRegenerated(json.entry);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  const when = new Date(entry.occurredAt);
  const dateLabel = Number.isFinite(when.getTime())
    ? when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "Undated";

  return (
    <div className={`${CARD} overflow-hidden transition duration-200`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="fx-focus flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors hover:bg-surface-2/70"
      >
        <span
          aria-hidden
          className={`shrink-0 text-fg-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          <ChevronIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg-primary">
            {entry.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-fg-muted">
            {dateLabel}
            {entry.durationMinutes ? ` · ${entry.durationMinutes} min` : ""}
            {` · ${logEntrySubtitle(entry)}`}
          </span>
        </span>
        {entry.attendeeNames.length > 0 && (
          <span className="hidden shrink-0 text-xs tabular-nums text-fg-muted sm:block">
            {entry.attendeeNames.length} attendee{entry.attendeeNames.length === 1 ? "" : "s"}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-line/70 bg-surface-0/40 px-4 py-4 motion-safe:animate-fade-up">
          {entry.hasReport ? (
            <div className="flex flex-col gap-4">
              <Detail label="Summary">
                <p className="text-sm leading-relaxed text-fg-primary">{entry.summary}</p>
              </Detail>
              {entry.keyPoints.length > 0 && <DetailList label="Key points" items={entry.keyPoints} />}
              {entry.decisions.length > 0 && <DetailList label="Decisions" items={entry.decisions} marker="✓" />}
              {entry.actionItems.length > 0 && <DetailList label="Action items" items={entry.actionItems} marker="☐" />}
              {entry.attendeeNames.length > 0 && (
                <Detail label="Attendees">
                  <p className="text-sm text-fg-secondary">{entry.attendeeNames.join(", ")}</p>
                </Detail>
              )}
            </div>
          ) : entry.attended ? (
            <p className="text-sm text-fg-muted">
              This meeting has no report. One is generated when a meeting is ended from inside the room.
            </p>
          ) : (
            // Not the same sentence as "no report", and the difference matters:
            // the record exists, it is simply not this member's to read. Saying
            // "no report" here would be the log misreporting its own contents.
            <p className="text-sm text-fg-muted">
              You weren&rsquo;t in this meeting, so its report isn&rsquo;t shown here. Ask the host if you need it.
            </p>
          )}

          {/* The report page is where the transcript and the export live. The
              log deliberately does not load a transcript to draw a list. */}
          {entry.attended && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line/70 pt-3">
              <Link
                href={`/meetings/${entry.roomCode}/report`}
                className="fx-btn rounded-lg border border-gold-400/35 bg-gold-400/10 px-3 py-1.5 text-xs font-semibold text-[var(--gold-300)] hover:bg-gold-400/20"
              >
                Open full report
              </Link>
              {/* Reads the transcript already on file and writes a fresh
                  report from it. Host only, and it appends rather than
                  overwrites, so the previous report is never lost. */}
              {entry.isHost && entry.hasReport && (
                <button
                  type="button"
                  onClick={() => void regenerate()}
                  disabled={busy}
                  className="fx-btn rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                >
                  {busy ? "Re-reading the transcript…" : "Regenerate from transcript"}
                </button>
              )}
              <span className="text-xs text-fg-muted">
                Transcript and export are on the report
              </span>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-2 text-xs text-[var(--status-danger)]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">{label}</p>
      {children}
    </div>
  );
}

function DetailList({ label, items, marker = "•" }: { label: string; items: string[]; marker?: string }) {
  return (
    <Detail label={label}>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-fg-primary">
            <span className="mt-0.5 shrink-0 text-fg-muted">{marker}</span>
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
