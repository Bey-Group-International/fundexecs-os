"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { callWhen, type CallHit } from "@/lib/meetings/call-archive";
import { searchSummary } from "@/lib/meetings/session-archive";
import { callClock } from "@/lib/meetings/one-way";
import { MIN_QUERY } from "@/lib/meetings/transcript-search";

/**
 * Recorded calls, searched by what was said in them.
 *
 * A list of forty rows called "Call · Mar 4, 2:15 PM" is useless for the
 * question people actually bring to it — "what did we agree with Dunbar in
 * March" — so the search box reads transcripts, not titles, and a hit arrives
 * with the sentence around it.
 */
export function CallArchive({ initial }: { initial: CallHit[] }) {
  const [query, setQuery] = useState("");
  const [calls, setCalls] = useState<CallHit[]>(initial);
  // How far the last search read, and whether that was everything.
  const [scanned, setScanned] = useState(0);
  const [bounded, setBounded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Calls deleted on this page. A search already in flight when the delete
  // lands was answered before it, and must not put the call back.
  const deleted = useRef<Set<string>>(new Set());

  // The search that is in flight. A slow request for "val" must not land after
  // a fast one for "valuation" and replace its results with the earlier ones.
  const latest = useRef(0);
  /** The query the list on screen answers. Starts as the server's empty one. */
  const lastRun = useRef("");

  const run = useCallback(async (q: string) => {
    const ticket = ++latest.current;
    lastRun.current = q;
    setLoading(true);
    try {
      const res = await fetch(`/api/meetings/calls?q=${encodeURIComponent(q)}`);
      const body = (await res.json().catch(() => ({}))) as {
        calls?: CallHit[];
        scanned?: number;
        bounded?: boolean;
      };
      if (ticket !== latest.current) return;
      setCalls((body.calls ?? []).filter((c) => !deleted.current.has(c.id)));
      setScanned(body.scanned ?? 0);
      setBounded(body.bounded === true);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  // Debounced, because this reads transcripts: a request per keystroke would
  // have the server scanning the archive five times to answer one question.
  //
  // And NOT run on arrival. This used to fire with an empty query on mount, so
  // every visit to the page ran the same fifty-row query twice — once in the
  // server render that drew the list, and again 250ms later to replace it with an
  // identical one. The list is already on screen; the first request worth making
  // is the first one somebody asks for.
  useEffect(() => {
    const q = query.trim();
    if (q.length > 0 && q.length < MIN_QUERY) return;
    // Already showing this. On arrival that is the unfiltered list the server
    // just rendered — and a cleared box after a search is NOT, so that one still
    // fetches the full list back.
    if (q === lastRun.current) return;
    const timer = setTimeout(() => { void run(q); }, 250);
    return () => clearTimeout(timer);
  }, [query, run]);

  /**
   * Permanently delete one call.
   *
   * A hard delete: the route removes the meeting, its transcript and report,
   * and the recording's stored parts. Removed from the list only once the
   * server says so — a row that vanished on a failed delete would have
   * somebody believing a recording was gone when it was not.
   */
  const remove = useCallback(async (id: string) => {
    setConfirming(null);
    setDeleting(id);
    setDeleteError(null);
    try {
      const res = await fetch("/api/meetings/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      deleted.current.add(id);
      setCalls((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setDeleteError("That call could not be deleted. Try again.");
    } finally {
      setDeleting(null);
    }
    // Stable: every closure here is a setState or the `deleted` ref, none of
    // which change identity. That is what keeps CallRow's memo real without a
    // ref-backed wrapper.
  }, []);

  const confirm = useCallback((id: string) => setConfirming(id), []);
  const cancelConfirm = useCallback(() => setConfirming(null), []);

  const trimmed = query.trim();
  const isSearch = trimmed.length >= MIN_QUERY;
  // The same sentence the meeting log shows, from the same function, in this
  // page's own noun — including the bound, which used to be a second paragraph
  // underneath. One statement about what was read is harder to read past than
  // two.
  //
  // Nothing at rest: the count would be a claim about the archive, and what is on
  // screen is the first page of it.
  const summary = isSearch
    ? searchSummary({ query: trimmed, hits: calls.length, scanned, bounded, noun: "call" })
    : "";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--fg-primary)]">Recorded calls</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Calls you recorded, with their transcripts and summaries.
          </p>
        </div>
        <Link
          href="/meetings/record"
          className="shrink-0 rounded-lg bg-[var(--gold-400)] px-3 py-2 text-sm font-medium text-[var(--surface-0)]"
        >
          Record a call
        </Link>
      </div>

      <div className="mt-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search what was said…"
          aria-label="Search what was said in your calls"
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--gold-400)] focus:outline-none"
        />
        {(summary || loading) && (
          <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--fg-muted)]">
            {loading ? "Searching…" : summary}
          </p>
        )}
        {trimmed.length > 0 && !isSearch && (
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            Keep typing — a search needs at least {MIN_QUERY} characters.
          </p>
        )}
      </div>

      {deleteError && (
        <p role="alert" className="mt-3 text-xs text-[var(--status-danger)]">
          {deleteError}
        </p>
      )}

      {calls.length === 0 ? (
        <p className="mt-10 text-center text-sm text-[var(--fg-muted)]">
          {query.trim()
            ? "Nothing matched. Try a word you remember somebody saying."
            : "No recorded calls yet. Record one and it will appear here with its transcript."}
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
          {calls.map((call) => (
            <CallRow
              key={call.id}
              call={call}
              confirming={confirming === call.id}
              deleting={deleting === call.id}
              onConfirm={confirm}
              onCancel={cancelConfirm}
              onDelete={remove}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * One recorded call.
 *
 * MEMOIZED, and the reason is the search box above it. Every character typed
 * re-renders this list, and each row derives its date through `callWhen` —
 * which is two `Intl` formats, not one. Measured over the fifty rows shown at
 * rest: 50 `toLocaleTimeString` plus 50 `toLocaleDateString` calls per
 * keystroke, 5.29ms of it, and up to four times that when a search fills the
 * page. The memo takes the rows that did not change out of the render, and the
 * cached formatters in `callWhen` make the ones that remain cheap.
 *
 * Takes `confirming` and `deleting` as booleans rather than the parent's
 * selected id, so pressing delete on one row re-renders that row instead of
 * all of them. The three handlers are stable by construction — see `remove`.
 */
const CallRow = memo(function CallRow({
  call, confirming, deleting, onConfirm, onCancel, onDelete,
}: {
  call: CallHit;
  confirming: boolean;
  deleting: boolean;
  onConfirm: (id: string) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="flex items-start hover:bg-[var(--surface-2)]">
      <Link href={`/meetings/${call.roomCode}/report`} className="block min-w-0 flex-1 px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium text-[var(--fg-primary)]">{call.title}</span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--fg-muted)]">
            {call.durationSeconds === null ? "—" : callClock(call.durationSeconds)}
          </span>
        </div>
        {/* flex-wrap, found by rendering this at 400px and looking at it:
            without it the three items shrank instead of wrapping, and a
            phone showed a ragged three-column block — "Sep 7, 2:47 /
            PM", "· consent / recorded", "· 14 / mentions". Wrapping
            moves a whole item to the next line instead of folding it in
            half. */}
        <div
          data-call-meta
          className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--fg-muted)]"
        >
          <span>{callWhen(call.at)}</span>
          {call.consented && (
            <span title="Consent was acknowledged before this call was recorded.">· consent recorded</span>
          )}
          {call.matches > 0 && (
            <span>· {call.matches} mention{call.matches === 1 ? "" : "s"}</span>
          )}
        </div>

        {call.snippet ? (
          <p className="mt-1.5 text-xs text-[var(--fg-secondary)]">
            {call.snippet.speaker && (
              <span className="font-medium text-[var(--fg-muted)]">{call.snippet.speaker}: </span>
            )}
            {/* Parts, never markup — these are other people's words. */}
            {call.snippet.parts.map((part, i) =>
              part.match ? (
                <mark key={i} className="rounded bg-gold-400/25 px-0.5 text-[var(--fg-primary)]">
                  {part.value}
                </mark>
              ) : (
                <span key={i}>{part.value}</span>
              ),
            )}
          </p>
        ) : call.summary ? (
          <p className="mt-1.5 line-clamp-2 text-xs text-[var(--fg-secondary)]">{call.summary}</p>
        ) : null}
      </Link>

      {/* Outside the link, so pressing it never opens the report. */}
      <div className="flex shrink-0 items-center py-3.5 pr-4">
        {confirming ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--fg-muted)]">Delete call and recording?</span>
            <button
              type="button"
              onClick={() => void onDelete(call.id)}
              className="rounded bg-status-danger/15 px-2 py-0.5 font-medium text-[var(--status-danger)] hover:bg-status-danger/25"
            >
              Yes, delete
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded bg-[var(--surface-2)] px-2 py-0.5 font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-3)]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onConfirm(call.id)}
            disabled={deleting}
            title="Delete permanently"
            aria-label={`Delete ${call.title} permanently`}
            className="text-[var(--fg-muted)] transition-colors hover:text-[var(--status-danger)] disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
});
