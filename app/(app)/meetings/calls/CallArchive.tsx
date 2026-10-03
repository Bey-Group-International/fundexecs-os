"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CALL_RANGES,
  callWhen,
  cleanCallTitle,
  CALL_TITLE_MAX,
  groupCalls,
  passesChips,
  rangeStart,
  statsLine,
  type CallChips,
  type CallHit,
  type CallRange,
  type CallStats,
} from "@/lib/meetings/call-archive";
import { searchSummary } from "@/lib/meetings/session-archive";
import { callClock } from "@/lib/meetings/one-way";
import { MIN_QUERY } from "@/lib/meetings/transcript-search";
import { copyText } from "../MeetingShareLink";

/**
 * Recorded calls, searched by what was said in them.
 *
 * A list of forty rows called "Call · Mar 4, 2:15 PM" is useless for the
 * question people actually bring to it — "what did we agree with Dunbar in
 * March" — so the search box reads transcripts, not titles, and a hit arrives
 * with the sentence around it.
 *
 * Around the search: the list falls under day and month headings, older calls
 * load on request instead of stopping at the first fifty, a range narrows how
 * far back the server reads, and two chips narrow what is drawn. Each row plays
 * its recording in place, and can be renamed, linked to or downloaded without
 * opening the report.
 */
export function CallArchive({
  initial,
  initialHasMore = false,
  stats = null,
}: {
  initial: CallHit[];
  /** Whether the server's first page was full, so older calls may follow. */
  initialHasMore?: boolean;
  /** What the header says about the last thirty days. */
  stats?: CallStats | null;
}) {
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<CallRange>("all");
  const [chips, setChips] = useState<CallChips>({ withSummary: false, withRecording: false });
  const [calls, setCalls] = useState<CallHit[]>(initial);
  // How far the last search read, and whether that was everything.
  const [scanned, setScanned] = useState(0);
  const [bounded, setBounded] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The one call playing. One at a time: two recordings talking over each
  // other is nobody's intent, and starting a second is how people stop the first.
  const [playing, setPlaying] = useState<string | null>(null);

  // Calls deleted on this page. A search already in flight when the delete
  // lands was answered before it, and must not put the call back.
  const deleted = useRef<Set<string>>(new Set());

  // The read that is in flight. A slow request for "val" must not land after
  // a fast one for "valuation" and replace its results with the earlier ones —
  // and an older page arriving after the search changed must not be appended
  // to a list it no longer belongs to.
  const latest = useRef(0);
  /** The query and range the list on screen answers. Starts as the server's. */
  const lastRun = useRef("|all");

  const run = useCallback(async (q: string, r: CallRange) => {
    const ticket = ++latest.current;
    lastRun.current = `${q}|${r}`;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(callsUrl(q, rangeStart(r)));
      // A failed read keeps the list on screen and says so, rather than
      // replacing it with "Nothing matched" for calls that do exist.
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json().catch(() => ({}))) as {
        calls?: CallHit[];
        scanned?: number;
        bounded?: boolean;
        hasMore?: boolean;
      };
      if (ticket !== latest.current) return;
      setCalls((body.calls ?? []).filter((c) => !deleted.current.has(c.id)));
      setScanned(body.scanned ?? 0);
      setBounded(body.bounded === true);
      setHasMore(body.hasMore === true);
    } catch {
      if (ticket === latest.current) setLoadError("Calls could not be loaded. Check your connection and try again.");
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
    if (`${q}|${range}` === lastRun.current) return;
    const timer = setTimeout(() => { void run(q, range); }, 250);
    return () => clearTimeout(timer);
  }, [query, range, run]);

  /**
   * The calls before the last one loaded.
   *
   * The cursor is the last call's time, not an offset: a call recorded or
   * deleted while somebody reads would shift an offset and repeat or skip a
   * row at the seam. Rows already on screen are dropped from the answer anyway,
   * for the two calls that share a second.
   */
  const loadMore = useCallback(async () => {
    const last = calls[calls.length - 1];
    if (!last) return;
    const ticket = latest.current;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const res = await fetch(callsUrl("", rangeStart(range), last.at));
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json().catch(() => ({}))) as { calls?: CallHit[]; hasMore?: boolean };
      if (ticket !== latest.current) return;
      setCalls((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...(body.calls ?? []).filter((c) => !seen.has(c.id) && !deleted.current.has(c.id))];
      });
      setHasMore(body.hasMore === true);
    } catch {
      if (ticket === latest.current) setLoadError("Older calls could not be loaded. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }, [calls, range]);

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
      setPlaying((p) => (p === id ? null : p));
    } catch {
      setDeleteError("That call could not be deleted. Try again.");
    } finally {
      setDeleting(null);
    }
    // Stable: every closure here is a setState or the `deleted` ref, none of
    // which change identity. That is what keeps CallRow's memo real without a
    // ref-backed wrapper.
  }, []);

  /**
   * Rename one call. Resolves to whether it worked, so the row can keep the
   * field open with what was typed when it did not.
   */
  const rename = useCallback(async (id: string, input: string): Promise<boolean> => {
    const title = cleanCallTitle(input);
    if (!title) return false;
    try {
      const res = await fetch(`/api/meetings/calls/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) return false;
      setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      return true;
    } catch {
      return false;
    }
  }, []);

  const confirm = useCallback((id: string) => setConfirming(id), []);
  const cancelConfirm = useCallback(() => setConfirming(null), []);
  const togglePlay = useCallback((id: string) => setPlaying((p) => (p === id ? null : id)), []);

  /**
   * The day the rows' dates are relative to.
   *
   * `callWhen` says "Today, 2:15 PM" by comparing against the moment it is
   * CALLED, so a memoized row that does not re-render keeps whatever it said
   * when it last did. Left open across midnight, yesterday's last call went on
   * claiming to be today's — a staleness the memo introduced, because before it
   * every parent render recomputed every label.
   *
   * So the day is passed in rather than read inside. Keyed on `toDateString`,
   * which is cheap and has no Intl in it, the identity is stable for as long as
   * the date is: memoized rows ignore a keystroke, and the first render after
   * midnight re-labels all of them — and the headings with them.
   */
  const todayKey = new Date().toDateString();
  const today = useMemo(() => new Date(todayKey), [todayKey]);

  const visible = useMemo(() => calls.filter((c) => passesChips(c, chips)), [calls, chips]);
  const groups = useMemo(() => groupCalls(visible, today), [visible, today]);

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
  const recent = statsLine(stats);
  const narrowed = range !== "all" || chips.withSummary || chips.withRecording;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[var(--fg-primary)]">Recorded calls</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Calls you recorded, with their transcripts and summaries.
          </p>
          {recent && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium tabular-nums text-[var(--fg-secondary)]">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--gold-400)]" />
              {recent}
            </p>
          )}
        </div>
        <Link
          href="/meetings/record"
          className="fx-btn inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-gold-400 px-4 text-sm font-semibold text-on-gold hover:bg-gold-500 sm:min-h-9 sm:w-auto"
        >
          <MicIcon />
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
          className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-base text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--gold-400)] focus:outline-none sm:min-h-0 sm:text-sm"
        />
        {/* The range is how far back the server reads; the chips narrow what
            is drawn of it. Wraps on a phone rather than scrolling sideways. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="How far back" className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-0.5">
            {CALL_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
                className={`min-h-9 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  range === r.id
                    ? "bg-[var(--surface-3)] text-[var(--fg-primary)]"
                    : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Chip
            pressed={chips.withSummary}
            onClick={() => setChips((c) => ({ ...c, withSummary: !c.withSummary }))}
          >
            Has summary
          </Chip>
          <Chip
            pressed={chips.withRecording}
            onClick={() => setChips((c) => ({ ...c, withRecording: !c.withRecording }))}
          >
            Has recording
          </Chip>
        </div>
        {(summary || loading) && (
          <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--fg-muted)]">
            {loading ? (isSearch ? "Searching…" : "Loading…") : summary}
          </p>
        )}
        {trimmed.length > 0 && !isSearch && (
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            Keep typing — a search needs at least {MIN_QUERY} characters.
          </p>
        )}
      </div>

      {(deleteError || loadError) && (
        <p role="alert" className="mt-3 text-xs text-[var(--status-danger)]">
          {deleteError ?? loadError}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-[var(--fg-muted)]">
          {calls.length > 0
            ? "No calls loaded so far match those filters."
            : query.trim()
              ? "Nothing matched. Try a word you remember somebody saying."
              : narrowed
                ? "No recorded calls in that range."
                : "No recorded calls yet. Record one and it will appear here with its transcript."}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`calls-${group.key}`}>
              <h2
                id={`calls-${group.key}`}
                className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]"
              >
                {group.label}
              </h2>
              <ol className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
                {group.calls.map((call) => (
                  <CallRow
                    key={call.id}
                    call={call}
                    today={today}
                    confirming={confirming === call.id}
                    deleting={deleting === call.id}
                    playing={playing === call.id}
                    onConfirm={confirm}
                    onCancel={cancelConfirm}
                    onDelete={remove}
                    onPlay={togglePlay}
                    onRename={rename}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {/* Older calls on request. Not for a search, which reads its own bound
          and says so in its summary. */}
      {hasMore && !isSearch && calls.length > 0 && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-4 text-sm font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-60 sm:min-h-9 sm:w-auto"
          >
            {loadingMore ? "Loading…" : "Load older calls"}
          </button>
        </div>
      )}
    </div>
  );
}

/** The archive's read, with only the parameters that say something. */
function callsUrl(q: string, since: string | null, before?: string): string {
  let url = `/api/meetings/calls?q=${encodeURIComponent(q)}`;
  if (since) url += `&since=${encodeURIComponent(since)}`;
  if (before) url += `&before=${encodeURIComponent(before)}`;
  return url;
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors ${
        pressed
          ? "border-[var(--gold-400)] bg-gold-400/15 text-[var(--fg-primary)]"
          : "border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
      }`}
    >
      {pressed && <CheckIcon />}
      {children}
    </button>
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
 * Takes `confirming`, `deleting` and `playing` as booleans rather than the
 * parent's selected id, so acting on one row re-renders that row instead of
 * all of them. The handlers are stable by construction — see `remove`. The
 * menu, the rename field and the "copied" note are the row's own state, for
 * the same reason.
 *
 * And it takes the DAY rather than reading the clock, because a memo that skips
 * a render also skips re-deriving "Today" — see `today` in the parent.
 */
const CallRow = memo(function CallRow({
  call, today, confirming, deleting, playing, onConfirm, onCancel, onDelete, onPlay, onRename,
}: {
  call: CallHit;
  /** The day "Today" is measured against — see the parent. */
  today: Date;
  confirming: boolean;
  deleting: boolean;
  playing: boolean;
  onConfirm: (id: string) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onPlay: (id: string) => void;
  onRename: (id: string, title: string) => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(call.title);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const reportPath = `/meetings/${call.roomCode}/report`;
  const streamUrl = call.recordingId
    ? `/api/meetings/${call.id}/recording/${call.recordingId}/stream`
    : null;

  const startRename = () => {
    setDraft(call.title);
    setRenameError(false);
    setRenaming(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cleanCallTitle(draft) === call.title) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    const ok = await onRename(call.id, draft);
    setSaving(false);
    if (ok) setRenaming(false);
    else setRenameError(true);
  };

  const copyLink = async () => {
    const ok = await copyText(`${window.location.origin}${reportPath}`);
    setCopied(ok ? "ok" : "failed");
  };

  return (
    <li className="hover:bg-[var(--surface-2)]/60">
      <div className="flex items-start">
        {renaming ? (
          <form onSubmit={save} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-4 py-3">
            <input
              autoFocus
              value={draft}
              maxLength={CALL_TITLE_MAX}
              onChange={(e) => { setDraft(e.target.value); setRenameError(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }}
              aria-label="Call name"
              aria-invalid={renameError || undefined}
              className="min-h-10 min-w-0 flex-1 basis-48 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 text-base text-[var(--fg-primary)] focus:border-[var(--gold-400)] focus:outline-none sm:min-h-9 sm:text-sm"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving || !cleanCallTitle(draft)}
                className="min-h-10 rounded-lg bg-gold-400 px-3 text-xs font-semibold text-on-gold disabled:opacity-50 sm:min-h-9"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="min-h-10 rounded-lg bg-[var(--surface-2)] px-3 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-3)] sm:min-h-9"
              >
                Cancel
              </button>
            </div>
            {renameError && (
              <p role="alert" className="basis-full text-xs text-[var(--status-danger)]">
                That name could not be saved. Try again.
              </p>
            )}
          </form>
        ) : (
          <Link href={reportPath} className="block min-w-0 flex-1 py-3.5 pl-4 pr-2">
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
              <span>{callWhen(call.at, today)}</span>
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
        )}

        {/* Outside the link, so pressing any of these never opens the report. */}
        <div className="flex shrink-0 items-center gap-0.5 py-2.5 pr-2 sm:pr-3">
          {copied && (
            <span role="status" className="mr-1 text-xs text-[var(--fg-muted)]">
              {copied === "ok" ? "Link copied" : "Copy failed"}
            </span>
          )}
          {streamUrl && (
            <button
              type="button"
              onClick={() => onPlay(call.id)}
              aria-pressed={playing}
              aria-label={playing ? `Stop playing ${call.title}` : `Play ${call.title}`}
              title={playing ? "Stop" : "Play recording"}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors sm:h-9 sm:w-9 ${
                playing
                  ? "bg-gold-400 text-on-gold"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--surface-3)] hover:text-[var(--fg-primary)]"
              }`}
            >
              {playing ? <StopIcon /> : <PlayIcon />}
            </button>
          )}
          <RowMenu
            title={call.title}
            downloadUrl={streamUrl ? `${streamUrl}?download=1` : null}
            disabled={deleting}
            onRename={startRename}
            onCopy={() => void copyLink()}
            onDelete={() => onConfirm(call.id)}
          />
        </div>
      </div>

      {/* Below the row rather than squeezed beside it: on a phone the question
          and its two answers did not fit next to a title. */}
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-4 py-2.5 text-xs">
          <span className="mr-auto text-[var(--fg-muted)]">Delete call and recording?</span>
          <button
            type="button"
            onClick={() => void onDelete(call.id)}
            className="min-h-9 rounded-lg bg-status-danger/15 px-3 font-medium text-[var(--status-danger)] hover:bg-status-danger/25"
          >
            Yes, delete
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-9 rounded-lg bg-[var(--surface-2)] px-3 font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-3)]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* The recording, in place. Mounted only while playing, so a page of
          fifty rows is not fifty media elements each fetching metadata. */}
      {playing && streamUrl && (
        <div className="px-4 pb-3">
          <audio
            controls
            autoPlay
            preload="metadata"
            src={streamUrl}
            aria-label={`Recording of ${call.title}`}
            className="h-10 w-full"
          />
        </div>
      )}
    </li>
  );
});

/**
 * The row's other actions, behind one button: rename, copy the report's link,
 * download the recording, delete. Four icons on a phone row would leave the
 * title a few characters wide.
 */
function RowMenu({
  title, downloadUrl, disabled, onRename, onCopy, onDelete,
}: {
  title: string;
  downloadUrl: string | null;
  disabled: boolean;
  onRename: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  const item =
    "flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm text-[var(--fg-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-primary)]";

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${title}`}
        title="More actions"
        className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--fg-primary)] disabled:opacity-40 sm:h-9 sm:w-9"
      >
        <DotsIcon />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${title}`}
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] py-1 shadow-xl"
        >
          <button type="button" role="menuitem" onClick={pick(onRename)} className={item}>
            <PencilIcon /> Rename
          </button>
          <button type="button" role="menuitem" onClick={pick(onCopy)} className={item}>
            <LinkIcon /> Copy link to report
          </button>
          {downloadUrl && (
            <a role="menuitem" href={downloadUrl} download onClick={() => setOpen(false)} className={item}>
              <DownloadIcon /> Download recording
            </a>
          )}
          <div className="my-1 border-t border-[var(--line)]" />
          <button
            type="button"
            role="menuitem"
            onClick={pick(onDelete)}
            aria-label={`Delete ${title} permanently`}
            className={`${item} text-[var(--status-danger)] hover:text-[var(--status-danger)]`}
          >
            <TrashIcon /> Delete permanently
          </button>
        </div>
      )}
    </div>
  );
}

function Svg({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function PlayIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>;
}
function StopIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
}
function DotsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>;
}
function PencilIcon() {
  return <Svg><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
}
function LinkIcon() {
  return <Svg><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Svg>;
}
function DownloadIcon() {
  return <Svg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Svg>;
}
function TrashIcon() {
  return <Svg><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></Svg>;
}
function MicIcon() {
  return <Svg><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="17" x2="12" y2="22" /></Svg>;
}
function CheckIcon() {
  return <Svg size={12}><polyline points="20 6 9 17 4 12" /></Svg>;
}
