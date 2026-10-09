"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  groupLogsByMonth,
  logDateLabel,
  logEntrySubtitle,
  loggedMeeting,
  meetingLogDetail,
  type LoggedMeeting,
  type MeetingLogDetail,
  type MeetingLogEntry,
} from "@/lib/meetings/meeting-log";
import { searchSummary, type SessionHit } from "@/lib/meetings/session-archive";
import { MIN_QUERY } from "@/lib/meetings/transcript-search";
import { CARD, EYEBROW } from "./tone";

// The meeting log: what every meeting left behind, kept so it can be found
// again months later.
//
// Rows are collapsed to a line each and open in place. A log is something you
// scan for one meeting, not something you read — so the default is the shortest
// thing that still identifies a meeting, and the detail is one click away
// rather than a page away.
//
// TWO CONSEQUENCES OF TAKING THAT SERIOUSLY, both new:
//
// The page ships a line per meeting, not an entry. Summaries, key points,
// decisions, action items and attendee names are fetched by the row that opens
// — one small request per open, against two hundred meetings of prose that used
// to travel with the page so that one row could show its detail.
//
// And searching happens on the server. It had to: the browser cannot filter
// prose it no longer has, and more to the point it never had the transcripts —
// so "what did we agree with Dunbar in March" was unanswerable here unless
// somebody had written "Dunbar" in a title. The search now reads what was said.

/** Why a row is in a search result. */
type Hit = Pick<SessionHit, "reason" | "matches" | "snippet">;

/** A row, with the hit that put it there when it came from a search. */
interface LogRowData extends LoggedMeeting {
  hit?: Hit;
}

/** One answered search, kept whole so the caveat is drawn from the same read. */
interface SearchResult {
  query: string;
  rows: LogRowData[];
  scanned: number;
  bounded: boolean;
}

/** Long enough that a typed word is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;

export function MeetingLogs({
  meetings: initialMeetings,
  query: controlledQuery,
}: {
  meetings: LoggedMeeting[];
  /**
   * The search, when the page owns the box. The meetings workspace has one
   * search across every tab; given a query, this list searches with it and
   * draws no box of its own.
   */
  query?: string;
}) {
  const [ownQuery, setQuery] = useState("");
  const controlled = controlledQuery !== undefined;
  const query = controlled ? controlledQuery : ownQuery;
  const [openId, setOpenId] = useState<string | null>(null);
  // Held locally so a regenerated report replaces its row in place. The
  // alternative is router.refresh(), which re-runs the page's whole server
  // query and collapses the row you were reading.
  const [meetings, setMeetings] = useState(initialMeetings);

  // ...but local state must still yield to the server. Siblings under
  // MeetingsLanding call router.refresh() after scheduling or saving a
  // meeting, which re-renders this component with new props WITHOUT
  // unmounting it. Without this the Logs tab's count badge (read from the
  // prop) moved while the list below it kept a stale snapshot, and the two
  // disagreed for the rest of the session. Adjusted during render rather than
  // in an effect: an effect would paint the stale list once first.
  const [lastProp, setLastProp] = useState(initialMeetings);
  if (initialMeetings !== lastProp) {
    setLastProp(initialMeetings);
    setMeetings(initialMeetings);
  }

  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // The prose for rows that have been opened, kept so closing and reopening a
  // row is free. Filed under the id the RESPONSE carries, never the id that was
  // asked for — see loadDetail.
  const [details, setDetails] = useState<Record<string, MeetingLogDetail>>({});
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // The search in flight. A slow request for "val" must not land after a fast
  // one for "valuation" and replace its results with the earlier ones.
  const latest = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const ticket = ++latest.current;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/meetings/log/search?q=${encodeURIComponent(q)}`);
      const body = (await res.json().catch(() => ({}))) as {
        meetings?: LogRowData[];
        scanned?: number;
        bounded?: boolean;
        error?: string;
      };
      // Answered a question that is no longer being asked.
      if (ticket !== latest.current) return;
      if (!res.ok) {
        setSearchError(body.error ?? "That search could not be run.");
        return;
      }
      setResult({
        query: q,
        rows: body.meetings ?? [],
        scanned: body.scanned ?? 0,
        bounded: body.bounded === true,
      });
    } catch {
      if (ticket === latest.current) setSearchError("Could not reach the server.");
    } finally {
      if (ticket === latest.current) setSearching(false);
    }
  }, []);

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY;
  const isSearch = trimmed.length >= MIN_QUERY;

  // Debounced, because this reads transcripts: a request per keystroke would
  // have the server scanning the archive five times to answer one question.
  useEffect(() => {
    if (!isSearch) {
      // Abandon anything in flight, so its answer cannot arrive after the box
      // was cleared and filter a list nobody is filtering.
      latest.current++;
      setResult(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const timer = setTimeout(() => { void runSearch(trimmed); }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, isSearch, runSearch]);

  /**
   * Fetch the prose for one row.
   *
   * Filed under `detail.id` rather than under the id requested: the reader can
   * open a second meeting while the first request is in flight, and a response
   * filed by request would put one meeting's summary under another's heading.
   */
  const loadDetail = useCallback(async (id: string) => {
    setDetailBusy(id);
    setDetailError(null);
    try {
      const res = await fetch(`/api/meetings/log/${encodeURIComponent(id)}`);
      const body = (await res.json().catch(() => ({}))) as {
        detail?: MeetingLogDetail;
        error?: string;
      };
      if (!res.ok || !body.detail) {
        setDetailError(body.error ?? "Could not load this meeting's detail.");
        return;
      }
      setDetails((prev) => ({ ...prev, [body.detail!.id]: body.detail! }));
    } catch {
      setDetailError("Could not reach the server.");
    } finally {
      setDetailBusy((busy) => (busy === id ? null : busy));
    }
  }, []);

  /**
   * The latest `openId` and `details`, for a handler that must not change.
   *
   * `toggle` used to close over both and list them as dependencies, which made
   * it a new function every time either moved — and it is handed to all 200
   * memoised rows. So opening one row re-rendered every row, and the detail
   * landing a moment later re-rendered every row again. Measured at 200
   * meetings: 72ms to open one, against 9ms for a keystroke, which is the same
   * page doing far more work for a smaller change.
   *
   * The memo was doing its job on the path it was written for. Typing moves
   * neither of these, so rows held still and the keystroke stayed cheap; the
   * open path was never measured, and a dependency array is a quiet way to lose
   * a memo. Read through refs, `toggle` is stable for the life of the page and
   * opening a row costs the two rows whose state actually changed.
   */
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const detailsRef = useRef(details);
  detailsRef.current = details;

  const toggle = useCallback(
    (row: LoggedMeeting) => {
      if (openIdRef.current === row.id) {
        setOpenId(null);
        return;
      }
      setOpenId(row.id);
      setDetailError(null);
      // Only rows that have something to show. A meeting the reader was not in
      // holds nothing they may read, and a request for it would be answered 403.
      if (row.attended && row.hasReport && !detailsRef.current[row.id]) void loadDetail(row.id);
    },
    [loadDetail],
  );

  /** A regenerated report: a new line AND new prose, both from one response. */
  const replaceEntry = useCallback((entry: MeetingLogEntry) => {
    const row = loggedMeeting(entry);
    setMeetings((prev) => prev.map((m) => (m.id === row.id ? row : m)));
    setResult((prev) =>
      prev
        ? { ...prev, rows: prev.rows.map((r) => (r.id === row.id ? { ...row, hit: r.hit } : r)) }
        : prev,
    );
    setDetails((prev) => ({ ...prev, [entry.id]: meetingLogDetail(entry) }));
  }, []);

  /**
   * Whether the result on screen answers the query in the box.
   *
   * It stops answering the moment another character is typed, and stays that way
   * through the debounce AND the request — the two together are about a third of
   * a second in which the rows below describe an older question.
   *
   * The rows are left standing rather than cleared, which is the deliberate half:
   * falling back to the unfiltered list would flash all two hundred meetings up
   * between two keystrokes, and the reader would watch their results disappear
   * and come back on every letter. What must not survive is the CLAIM — see the
   * count line below, which stops saying how many matched the moment it no longer
   * knows.
   */
  const answered = isSearch && result !== null && result.query === trimmed;
  const shownRows: LogRowData[] = isSearch && result ? result.rows : meetings;
  const groups = useMemo(() => groupLogsByMonth(shownRows), [shownRows]);

  const total = meetings.length;
  const summary = answered
    ? searchSummary({
      query: result.query,
      hits: result.rows.length,
      scanned: result.scanned,
      bounded: result.bounded,
      // The log's own word. "3 matches … in the most recent 200 sessions" is
      // a caveat about a page this reader is not on.
      noun: "meeting",
    })
    : `${total} meeting${total === 1 ? "" : "s"}`;

  // Covers the debounce as well as the request. `searching` alone starts a
  // quarter of a second late, and in that gap the line read "3 matches for
  // “dunbar”" over a box that already said "dunbar x".
  const searchPending = searching || (isSearch && !answered);

  if (total === 0 && !isSearch) {
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
        {controlled ? <div className="flex-1" /> : (
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search what was said, decided, or agreed…"
            aria-label="Search the meeting log, including what was said"
            className="w-full rounded-lg border border-line bg-surface-1 py-2 pl-9 pr-3 text-sm text-fg-primary transition-colors placeholder:text-fg-muted focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/30"
          />
        </div>
        )}
        <span role="status" aria-live="polite" className="shrink-0 text-xs tabular-nums text-fg-muted">
          {searchPending ? "Searching…" : summary}
        </span>
      </div>

      {tooShort && (
        <p className="px-1 text-xs text-fg-muted">
          Keep typing — a search needs at least {MIN_QUERY} characters.
        </p>
      )}

      {searchError && (
        <p role="alert" className="px-1 text-xs text-[var(--status-danger)]">
          {searchError}
        </p>
      )}

      {/* `searchPending`, not `searching`: a query that found nothing, followed by
          another keystroke, would otherwise spend the debounce telling the reader
          that nothing matches a query nobody has answered yet. */}
      {shownRows.length === 0 && !searchPending ? (
        <div className={`${CARD} border-dashed px-4 py-8 text-center`}>
          <p className="text-sm font-medium text-fg-primary">Nothing matches “{trimmed}”</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            The log searches titles, summaries, decisions, action items, attendees — and the
            transcript of every meeting you were in.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h3 className={`px-1 ${EYEBROW}`}>{group.label}</h3>
            <div className="flex flex-col gap-1.5">
              {group.entries.map((row) => (
                <LogRow
                  key={row.id}
                  row={row}
                  detail={details[row.id] ?? null}
                  loading={detailBusy === row.id}
                  error={openId === row.id ? detailError : null}
                  open={openId === row.id}
                  onToggle={toggle}
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

/**
 * One meeting, collapsed to a line.
 *
 * MEMOIZED, and the reason is the search box above it. Every character typed
 * re-renders this component, and a full log is two hundred of them — each one
 * formatting a date that had not changed. Measured at 200 `toLocaleDateString`
 * calls and 11.24ms of Intl work per keystroke; the memo takes the rows that
 * did not change out of the render entirely, and `logDateLabel` makes the ones
 * that do remain cheap.
 *
 * `onToggle` takes the row rather than closing over it, which is what lets the
 * page pass its `toggle` straight through. A fresh `() => toggle(row)` per row
 * per render would have made this memo a comment — and `toggle` itself is
 * stable across a keystroke, because what it depends on (which row is open,
 * which details have landed) is not what typing changes.
 */
const LogRow = memo(function LogRow({
  row, detail, loading, error, open, onToggle, onRegenerated,
}: {
  row: LogRowData;
  detail: MeetingLogDetail | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle: (row: LogRowData) => void;
  onRegenerated: (entry: MeetingLogEntry) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setRegenError(null);
    try {
      const res = await fetch(`/api/meetings/${row.id}/report/regenerate`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { entry?: MeetingLogEntry; error?: string };
      if (!res.ok || !json.entry) {
        setRegenError(json.error ?? "Could not regenerate the report.");
        return;
      }
      onRegenerated(json.entry);
    } catch {
      setRegenError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  const dateLabel = logDateLabel(row.occurredAt);

  return (
    <div className={`${CARD} overflow-hidden transition duration-200`}>
      <button
        type="button"
        onClick={() => onToggle(row)}
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
            {row.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-fg-muted">
            {dateLabel}
            {row.durationMinutes ? ` · ${row.durationMinutes} min` : ""}
            {` · ${logEntrySubtitle(row)}`}
            {row.hit && row.hit.matches > 0
              ? ` · ${row.hit.matches} mention${row.hit.matches === 1 ? "" : "s"}`
              : ""}
          </span>
        </span>
        {row.attendeeCount > 0 && (
          <span className="hidden shrink-0 text-xs tabular-nums text-fg-muted sm:block">
            {row.attendeeCount} attendee{row.attendeeCount === 1 ? "" : "s"}
          </span>
        )}
      </button>

      {/* The sentence the hit was in, on the collapsed row: it is the half of
          "why is this here" that a title and a date cannot answer, and the
          reader should not have to open the row to see it. */}
      {row.hit?.snippet && (
        <p className="border-t border-line/70 px-4 pb-2.5 pt-2 text-xs leading-relaxed text-fg-secondary">
          {row.hit.snippet.speaker && (
            <span className="font-medium text-fg-muted">{row.hit.snippet.speaker}: </span>
          )}
          {/* Parts, never markup — these are other people's words. */}
          {row.hit.snippet.parts.map((part, i) =>
            part.match ? (
              <mark key={i} className="rounded bg-gold-400/25 px-0.5 text-fg-primary">
                {part.value}
              </mark>
            ) : (
              <span key={i}>{part.value}</span>
            ),
          )}
        </p>
      )}

      {open && (
        <div className="border-t border-line/70 bg-surface-0/40 px-4 py-4 motion-safe:animate-fade-up">
          {row.hasReport && row.attended ? (
            loading && !detail ? (
              <p className="text-sm text-fg-muted">Reading the report…</p>
            ) : detail ? (
              <div className="flex flex-col gap-4">
                <Detail label="Summary">
                  <p className="text-sm leading-relaxed text-fg-primary">{detail.summary}</p>
                </Detail>
                {detail.keyPoints.length > 0 && <DetailList label="Key points" items={detail.keyPoints} />}
                {detail.decisions.length > 0 && <DetailList label="Decisions" items={detail.decisions} marker="✓" />}
                {detail.actionItems.length > 0 && <DetailList label="Action items" items={detail.actionItems} marker="☐" />}
                {detail.attendeeNames.length > 0 && (
                  <Detail label="Attendees">
                    <p className="text-sm text-fg-secondary">{detail.attendeeNames.join(", ")}</p>
                  </Detail>
                )}
              </div>
            ) : null
          ) : row.attended ? (
            // Two different silences. A meeting with a transcript and no
            // summary was transcribed and then not analysed — the model failed,
            // or nobody pressed End — and telling its host "no report is
            // generated until you end from inside the room" would be describing
            // something they cannot do now, next to a button offering to finish
            // the job.
            <p className="text-sm text-fg-muted">
              {row.canRegenerate
                ? "The transcript is on file, but no report was written from it. Generate one from the transcript below."
                : "This meeting has no report and nothing was transcribed, so there is nothing to write one from."}
            </p>
          ) : (
            // Not the same sentence as "no report", and the difference matters:
            // the record exists, it is simply not this member's to read. Saying
            // "no report" here would be the log misreporting its own contents.
            <p className="text-sm text-fg-muted">
              You weren&rsquo;t in this meeting, so its report isn&rsquo;t shown here. Ask the host if you need it.
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-[var(--status-danger)]">
              {error}
            </p>
          )}

          {/* The report page is where the transcript and the export live. The
              log deliberately does not load a transcript to draw a list. */}
          {row.attended && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line/70 pt-3">
              <Link
                href={`/meetings/${row.roomCode}/report`}
                className="fx-btn rounded-lg border border-gold-400/35 bg-gold-400/10 px-3 py-1.5 text-xs font-semibold text-[var(--gold-300)] hover:bg-gold-400/20"
              >
                Open full report
              </Link>
              {/* Reads the transcript already on file and writes a fresh
                  report from it. Host only, and it appends rather than
                  overwrites, so the previous report is never lost.
                  Gated on the TRANSCRIPT, not on the summary: a report whose
                  analysis failed holds the one and not the other, and that is
                  the row this button exists for. */}
              {row.isHost && row.canRegenerate && (
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

          {regenError && (
            <p role="alert" className="mt-2 text-xs text-[var(--status-danger)]">
              {regenError}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

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
