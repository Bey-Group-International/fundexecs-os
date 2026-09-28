"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { archiveSummary, callWhen, type CallHit } from "@/lib/meetings/call-archive";
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
  const [partial, setPartial] = useState(false);
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

  const run = useCallback(async (q: string) => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/meetings/calls?q=${encodeURIComponent(q)}`);
      const body = (await res.json().catch(() => ({}))) as { calls?: CallHit[]; partial?: boolean };
      if (ticket !== latest.current) return;
      setCalls((body.calls ?? []).filter((c) => !deleted.current.has(c.id)));
      setPartial(body.partial === true);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  // Debounced, because this reads transcripts: a request per keystroke would
  // have the server scanning the archive five times to answer one question.
  useEffect(() => {
    const q = query.trim();
    if (q.length > 0 && q.length < MIN_QUERY) return;
    const timer = setTimeout(() => { void run(q); }, 250);
    return () => clearTimeout(timer);
  }, [query, run]);

  // A hard delete: the route removes the meeting, its transcript and report,
  // and the recording's stored parts. Removed from the list only once the
  // server says so — a row that vanished on a failed delete would have
  // somebody believing a recording was gone when it was not.
  async function remove(id: string) {
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
  }

  const summary = archiveSummary(query, calls.length);

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
        {summary && (
          <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--fg-muted)]">
            {loading ? "Searching…" : summary}
          </p>
        )}
        {partial && !loading && (
          // Said plainly rather than implying the whole archive was read. A
          // search that quietly saw only part of it would have somebody
          // concluding a call does not exist.
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            Only your most recent calls were searched.
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
            <li key={call.id} className="flex items-start hover:bg-[var(--surface-2)]">
              <Link href={`/meetings/${call.roomCode}/report`} className="block min-w-0 flex-1 px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-[var(--fg-primary)]">{call.title}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--fg-muted)]">
                    {call.durationSeconds === null ? "—" : callClock(call.durationSeconds)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--fg-muted)]">
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
                {confirming === call.id ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--fg-muted)]">Delete call and recording?</span>
                    <button
                      type="button"
                      onClick={() => void remove(call.id)}
                      className="rounded bg-status-danger/15 px-2 py-0.5 font-medium text-[var(--status-danger)] hover:bg-status-danger/25"
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded bg-[var(--surface-2)] px-2 py-0.5 font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-3)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(call.id)}
                    disabled={deleting === call.id}
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
          ))}
        </ol>
      )}
    </div>
  );
}
