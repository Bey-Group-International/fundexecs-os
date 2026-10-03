"use client";

// The meetings you have: what needs you, today, what is coming, and what
// happened.
//
// It replaces two tabs — Upcoming, a flat list of up to a hundred meetings, and
// Logs — that answered "what is on" but never "what needs me". Four tabs now:
//
//   Needs action  meetings in the next week still to prepare, meetings that have
//                 run and want a follow-up, and follow-ups drafted and never sent;
//   Today         the day's agenda;
//   Upcoming      everything ahead, by day, a week at a time or all at once;
//   Past          the meeting log, with what each one decided.
//
// One search box serves all four. Selecting meetings lets a reminder or a delete
// go to several at once. Clicking a meeting opens its preview beside the list.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { deriveMeetingStatus, meetingTimeState } from "@/lib/meetings/schedule";
import {
  ACTION_LABEL,
  TAB_PARAM,
  groupByDay,
  inWeek,
  isToday,
  matchesQuery,
  needsAction,
  parseTab,
  rowChips,
  weekLabel,
  weekRange,
  type PendingFollowUp,
  type WorkspaceTab,
} from "@/lib/meetings/workspace";
import type { LoggedMeeting } from "@/lib/meetings/meeting-log";
import { meetingInviteUrl } from "@/lib/meetings/share";
import { CARD, EYEBROW, chip } from "./tone";
import { MeetingLogs } from "./MeetingLogs";
import { MeetingRow, type RowPerson } from "./MeetingRow";
import { MeetingPreview } from "./MeetingPreview";
import { ConfirmBox, MeetingEditScreen, toEditInitial } from "./meeting-shared";
import { copyText } from "./MeetingShareLink";
import { useLivePresence, useNow } from "./hooks";
import { useUpcomingMeetings } from "./useUpcomingMeetings";
import { UpNextStrip } from "./UpNextStrip";
import { upNextMeeting } from "@/lib/meetings/lobby";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

/** How often the list re-reads the clock. Every label it drives is minute-grained. */
const CLOCK_TICK_MS = 15_000;

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

const TAB_LABEL: Record<WorkspaceTab, string> = {
  needs: "Needs action",
  today: "Today",
  upcoming: "Upcoming",
  past: "Past",
};

export function MeetingsWorkspace({
  initialUpcoming,
  initialLogs,
  initialPendingFollowUps,
}: {
  initialUpcoming: UpcomingMeeting[];
  initialLogs: LoggedMeeting[];
  initialPendingFollowUps: PendingFollowUp[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    meetings,
    reminded,
    busy,
    error,
    setError,
    deleteMeeting,
    removeFromCalendar,
    retrySync,
    sendReminder,
    refresh,
    prepareWithEarn,
    followUpWithEarn,
  } = useUpcomingMeetings(initialUpcoming);

  const now = useNow(CLOCK_TICK_MS);
  const meetingIds = useMemo(() => meetings.map((m) => m.id), [meetings]);
  const { presence } = useLivePresence(meetingIds);

  // The tab lives in the address, so a link or a reload lands on the same one.
  // Without one in the address: Today when there is anything today, else
  // Upcoming.
  //
  // "Today" is the READER's today, which the server cannot know — it renders in
  // UTC. So nothing that depends on it is drawn until the browser has mounted:
  // the server sends a skeleton, and the tab is chosen here, once, on the client.
  const urlTab = parseTab(searchParams.get(TAB_PARAM));
  const [mounted, setMounted] = useState(false);
  const [tab, setTabState] = useState<WorkspaceTab>(urlTab ?? "upcoming");
  useEffect(() => {
    setMounted(true);
    if (!urlTab && initialUpcoming.some((m) => isToday(m, Date.now()))) setTabState("today");
    // Mount only: this is the first choice of tab, not a rule kept afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTab = useCallback(
    (next: WorkspaceTab) => {
      setTabState(next);
      setSelected(new Set());
      const params = new URLSearchParams(searchParams.toString());
      params.set(TAB_PARAM, next);
      // Replace, not push: switching tabs is not somewhere Back should return to.
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    },
    [pathname, searchParams],
  );

  const [query, setQuery] = useState("");
  const [weekOffset, setWeekOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ confirming: boolean; running: string | null; message: string | null }>({
    confirming: false,
    running: null,
    message: null,
  });
  const searchBox = useRef<HTMLInputElement>(null);

  const statusOf = useCallback((m: UpcomingMeeting) => deriveMeetingStatus(m, now), [now]);
  const matching = useMemo(() => meetings.filter((m) => matchesQuery(m, query)), [meetings, query]);
  const today = useMemo(() => matching.filter((m) => isToday(m, now)), [matching, now]);
  const range = weekOffset === null ? null : weekRange(now, weekOffset);
  const upcomingShown = useMemo(
    () => (range ? matching.filter((m) => inWeek(m, range)) : matching),
    [matching, range],
  );
  const pending = useMemo(
    () => initialPendingFollowUps.filter((p) => matchesQuery({ id: p.id, title: p.title, scheduled_at: null }, query)),
    [initialPendingFollowUps, query],
  );
  const actions = useMemo(() => needsAction(matching, statusOf, pending, now), [matching, statusOf, pending, now]);

  const counts: Record<WorkspaceTab, number> = {
    needs: actions.length,
    today: today.length,
    upcoming: matching.length,
    past: initialLogs.length,
  };

  // A preview of a meeting that has gone (deleted, or moved out of the window)
  // closes rather than showing a stale copy.
  const previewing = previewId ? meetings.find((m) => m.id === previewId) ?? null : null;
  useEffect(() => {
    if (previewId && !previewing) setPreviewId(null);
  }, [previewId, previewing]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const preview = useCallback((id: string) => {
    setPreviewId((prev) => (prev === id ? null : id));
    setDeleteId(null);
  }, []);

  const byId = useMemo(() => new Map(meetings.map((m) => [m.id, m])), [meetings]);
  const onPrep = useCallback((id: string) => { const m = byId.get(id); if (m) prepareWithEarn(m); }, [byId, prepareWithEarn]);
  const onFollowUp = useCallback((id: string) => { const m = byId.get(id); if (m) followUpWithEarn(m); }, [byId, followUpWithEarn]);
  const onRemind = useCallback((id: string) => void sendReminder(id), [sendReminder]);
  const onEdit = useCallback((id: string) => setEditingId(id), []);
  const onDelete = useCallback((id: string) => {
    setPreviewId(id);
    setDeleteId(id);
  }, []);
  const onCopyLink = useCallback(
    (id: string) => {
      const m = byId.get(id);
      if (!m) return;
      void copyText(meetingInviteUrl(window.location.origin, m.room_code)).then((ok) => {
        if (ok) {
          setCopiedId(id);
          setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
        } else {
          setError("Couldn't copy the link. Open the meeting's preview to copy it from there.");
        }
      });
    },
    [byId, setError],
  );

  // "/" focuses the search, the shortcut most search boxes on the web share.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "/" || target?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      searchBox.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function bulkRemind() {
    const ids = [...selected];
    setBulk({ confirming: false, running: "remind", message: null });
    for (const id of ids) await sendReminder(id);
    setBulk({ confirming: false, running: null, message: `Reminders sent for ${ids.length} meeting${ids.length === 1 ? "" : "s"}. Each row says how it went.` });
    setSelected(new Set());
  }

  async function bulkDelete() {
    const ids = [...selected];
    setBulk({ confirming: false, running: "delete", message: null });
    for (const id of ids) await deleteMeeting(id);
    setBulk({ confirming: false, running: null, message: `Deleted ${ids.length} meeting${ids.length === 1 ? "" : "s"}.` });
    setSelected(new Set());
  }

  function rowFor(m: UpcomingMeeting, reason?: string) {
    const status = statusOf(m);
    const time = meetingTimeState(m.scheduled_at, m.duration_minutes, now);
    const room = presence[m.id];
    const live = (room?.count ?? 0) > 0 || time?.phase === "in_progress";
    const ended = time?.phase === "ended" || m.status === "ended";
    const people: RowPerson[] = (m.attendees ?? []).map((a) => ({ name: a.name, email: a.email ?? null }));
    return (
      <MeetingRow
        key={m.id}
        id={m.id}
        roomCode={m.room_code}
        title={m.title}
        timeLabel={m.scheduled_at ? TIME_FORMAT.format(new Date(m.scheduled_at)) : "TBD"}
        status={status}
        phase={time?.phase ?? null}
        countdown={time?.label ?? null}
        live={live}
        inRoom={room?.count ?? 0}
        people={people}
        chips={rowChips(m)}
        reason={reason ?? null}
        ended={ended}
        selected={selected.has(m.id)}
        selectable
        previewing={previewId === m.id}
        reminderState={reminded[m.id]?.state ?? null}
        copied={copiedId === m.id}
        onSelect={toggleSelect}
        onPreview={preview}
        onPrep={onPrep}
        onFollowUp={onFollowUp}
        onCopyLink={onCopyLink}
        onRemind={onRemind}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
  }

  function dayList(list: UpcomingMeeting[], empty: { title: string; body: string }) {
    if (list.length === 0) return <EmptyState {...empty} query={query} />;
    return groupByDay(list, now).map((group) => (
      <section key={group.key} className="flex flex-col gap-1.5">
        <h3 className={`px-1 ${EYEBROW}`}>
          {group.label}
          <span className="ml-2 font-normal tabular-nums text-fg-muted">{group.meetings.length}</span>
        </h3>
        {group.meetings.map((m) => rowFor(m))}
      </section>
    ));
  }

  const editingMeeting = editingId ? byId.get(editingId) ?? null : null;
  const selectable = tab !== "past";
  const previewTime = previewing ? meetingTimeState(previewing.scheduled_at, previewing.duration_minutes, now) : null;

  if (!mounted) return <WorkspaceSkeleton />;

  // The meeting to join now, from the same live list and room presence the
  // tabs below draw on — no second subscription for one line.
  const next = upNextMeeting(meetings, presence, now);

  return (
    <div className="flex flex-col gap-3">
      <UpNextStrip next={next} now={now} />
      {/* Tabs, search, and — for Upcoming — the week. */}
      <div className="flex flex-col gap-3 border-b border-line pb-3 md:flex-row md:items-end md:justify-between">
        <div role="tablist" aria-label="Meetings" className="-mb-px flex gap-1 overflow-x-auto">
          {(["needs", "today", "upcoming", "past"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
              className={`fx-focus flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                tab === id ? "bg-surface-3 text-fg-primary" : "text-fg-muted hover:bg-surface-2 hover:text-fg-secondary"
              }`}
            >
              {TAB_LABEL[id]}
              {counts[id] > 0 ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums tracking-normal ${
                    id === "needs" ? "bg-status-warning/15 text-[var(--status-warning)]" : "bg-surface-3 text-fg-secondary"
                  }`}
                >
                  {counts[id]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
            <SearchIcon />
          </span>
          <input
            ref={searchBox}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "past" ? "Search what was said or decided…" : "Search meetings and people…"}
            aria-label="Search meetings"
            className="w-full rounded-lg border border-line bg-surface-1 py-1.5 pl-9 pr-8 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/30"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1 font-mono text-[10px] text-fg-muted md:block">
            /
          </kbd>
        </div>
      </div>

      {tab === "upcoming" ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Week">
          <div className="flex rounded-lg border border-line p-0.5 text-xs">
            <button
              type="button"
              aria-pressed={weekOffset === null}
              onClick={() => setWeekOffset(null)}
              className={`rounded-md px-2.5 py-1 ${weekOffset === null ? "bg-surface-3 text-fg-primary" : "text-fg-muted hover:text-fg-secondary"}`}
            >
              All
            </button>
            <button
              type="button"
              aria-pressed={weekOffset !== null}
              onClick={() => setWeekOffset((w) => w ?? 0)}
              className={`rounded-md px-2.5 py-1 ${weekOffset !== null ? "bg-surface-3 text-fg-primary" : "text-fg-muted hover:text-fg-secondary"}`}
            >
              By week
            </button>
          </div>
          {weekOffset !== null && range ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous week"
                disabled={weekOffset <= 0}
                onClick={() => setWeekOffset((w) => Math.max(0, (w ?? 0) - 1))}
                className="fx-btn rounded-md border border-line px-2 py-1 text-xs text-fg-secondary hover:bg-surface-2 disabled:opacity-40"
              >
                ‹
              </button>
              <span className="min-w-[7.5rem] text-center text-xs font-medium text-fg-primary" aria-live="polite">
                {weekLabel(range, weekOffset)}
              </span>
              <button
                type="button"
                aria-label="Next week"
                onClick={() => setWeekOffset((w) => (w ?? 0) + 1)}
                className="fx-btn rounded-md border border-line px-2 py-1 text-xs text-fg-secondary hover:bg-surface-2"
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-[var(--status-danger)]">
          {error}
        </p>
      ) : null}

      {/* Bulk actions, once anything is selected. */}
      {selectable && selected.size > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-gold-400/40 bg-surface-1 px-3 py-2 shadow-[0_10px_30px_-18px_rgb(15_23_42/0.45)]">
          <span className="text-xs font-medium text-fg-primary">{selected.size} selected</span>
          <button
            type="button"
            disabled={bulk.running !== null}
            onClick={() => void bulkRemind()}
            className="fx-btn rounded-lg border border-line bg-surface-1 px-2.5 py-1 text-xs font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg-primary disabled:opacity-50"
          >
            {bulk.running === "remind" ? "Sending…" : "Send reminders"}
          </button>
          <button
            type="button"
            disabled={bulk.running !== null}
            onClick={() => setBulk((b) => ({ ...b, confirming: true }))}
            className="fx-btn rounded-lg border border-status-danger/40 px-2.5 py-1 text-xs font-medium text-[var(--status-danger)] hover:bg-status-danger/10 disabled:opacity-50"
          >
            {bulk.running === "delete" ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-fg-muted hover:text-fg-secondary"
          >
            Clear selection
          </button>
          {bulk.confirming ? (
            <div className="w-full">
              <ConfirmBox
                title={`Delete ${selected.size} meeting${selected.size === 1 ? "" : "s"}?`}
                body="This deletes the local FundExecs meeting records only. Guests with an email address are told each meeting is cancelled. Connected calendar events are not deleted unless separately approved and synced."
                confirmLabel={`Delete ${selected.size}`}
                onConfirm={() => void bulkDelete()}
                onCancel={() => setBulk((b) => ({ ...b, confirming: false }))}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {bulk.message ? (
        <p role="status" className="text-xs text-fg-muted">
          {bulk.message}
        </p>
      ) : null}

      <div className={`grid grid-cols-1 gap-4 ${previewing ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""} lg:items-start`}>
        <div className="flex min-w-0 flex-col gap-4">
          <div id="panel-needs" role="tabpanel" aria-labelledby="tab-needs" hidden={tab !== "needs"} className="flex flex-col gap-1.5">
            {tab !== "needs" ? null : actions.length === 0 ? (
              <EmptyState
                title="Nothing needs you"
                body="Meetings that still need preparing, and follow-ups that haven't gone out, show up here."
                query={query}
              />
            ) : (
              actions.map((item) =>
                item.meeting ? (
                  rowFor(item.meeting, ACTION_LABEL[item.reason])
                ) : item.past ? (
                  <div key={`past-${item.past.id}`} className={`${CARD} flex items-center gap-3 px-3 py-2.5`}>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium text-fg-primary">{item.past.title}</span>
                      <span className="flex flex-wrap items-center gap-1">
                        <span className={chip("warning")}>{ACTION_LABEL.unsent}</span>
                        <span className="text-[11px] text-fg-muted">
                          Ended {new Date(item.past.occurred_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </span>
                    </span>
                    <Link
                      href={`/meetings/${item.past.room_code}/report#follow-up`}
                      className="fx-btn shrink-0 rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-[#0d0d10] hover:opacity-90"
                    >
                      Review follow-up
                    </Link>
                  </div>
                ) : null,
              )
            )}
          </div>

          <div id="panel-today" role="tabpanel" aria-labelledby="tab-today" hidden={tab !== "today"} className="flex flex-col gap-4">
            {tab === "today"
              ? dayList(today, {
                  title: "Nothing on today",
                  body: "Today's meetings appear here with a countdown, who's in the room, and a way in.",
                })
              : null}
          </div>

          <div id="panel-upcoming" role="tabpanel" aria-labelledby="tab-upcoming" hidden={tab !== "upcoming"} className="flex flex-col gap-4">
            {tab === "upcoming"
              ? dayList(upcomingShown, {
                  title: range ? `Nothing ${weekLabel(range, weekOffset ?? 0).toLowerCase()}` : "No upcoming meetings",
                  body: "Schedule a meeting, connect a calendar, or ask Earn to prepare your schedule.",
                })
              : null}
          </div>

          {/* Kept mounted once seen: it holds an open row and a search. */}
          <div id="panel-past" role="tabpanel" aria-labelledby="tab-past" hidden={tab !== "past"}>
            <MeetingLogs meetings={initialLogs} query={query} />
          </div>
        </div>

        {previewing ? (
          <MeetingPreview
            meeting={previewing}
            status={statusOf(previewing)}
            ended={previewTime?.phase === "ended" || previewing.status === "ended"}
            live={(presence[previewing.id]?.count ?? 0) > 0 || previewTime?.phase === "in_progress"}
            room={presence[previewing.id] ?? null}
            reminder={reminded[previewing.id] ?? null}
            busy={busy === previewing.id}
            confirmingDelete={deleteId === previewing.id}
            onClose={() => setPreviewId(null)}
            onPrep={() => prepareWithEarn(previewing)}
            onFollowUp={() => followUpWithEarn(previewing)}
            onEdit={() => setEditingId(previewing.id)}
            onRemind={() => void sendReminder(previewing.id)}
            onRetrySync={() => void retrySync(previewing.id)}
            onRemoveFromCalendar={() => void removeFromCalendar(previewing.id)}
            onAskDelete={() => setDeleteId(previewing.id)}
            onCancelDelete={() => setDeleteId(null)}
            onDelete={(scope) => {
              void deleteMeeting(previewing.id, scope).then(() => setDeleteId(null));
            }}
          />
        ) : null}
      </div>

      {editingMeeting ? (
        <MeetingEditScreen
          mode="edit"
          initial={toEditInitial(editingMeeting)}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** The workspace's shape, while the browser works out what "today" is. */
function WorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading meetings">
      <div className="flex gap-2 border-b border-line pb-3">
        {[96, 64, 88, 52].map((w) => (
          <div key={w} className="h-7 animate-pulse rounded-lg bg-surface-2" style={{ width: w }} />
        ))}
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-2xl bg-surface-1" />
      ))}
    </div>
  );
}

function EmptyState({ title, body, query }: { title: string; body: string; query: string }) {
  const q = query.trim();
  return (
    <div className={`${CARD} border-dashed px-6 py-10 text-center`}>
      <p className="text-sm font-medium text-fg-primary">{q ? `Nothing matches “${q}”` : title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">
        {q ? "Search looks at titles, types, objectives, tags and the people on each meeting." : body}
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
