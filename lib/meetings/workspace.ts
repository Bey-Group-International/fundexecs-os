// lib/meetings/workspace.ts
// The meetings page's working view: which tab a meeting belongs in, how a list
// is grouped by day, what a search matches, which week is on screen, and what
// is waiting on the host.
//
// The landing used to be two tabs — Upcoming, a flat list of up to a hundred
// meetings in date order, and Logs. Nothing said which of them needed doing
// something about, and the meeting at 10:00 today sat in the same undifferentiated
// list as the one three weeks out. These rules are what the new view is built
// on, kept pure so they can be tested without a browser or a clock.
//
// Pure: no DOM, no database. "Now" and the time zone are always passed in.

export type WorkspaceTab = "needs" | "today" | "upcoming" | "past";

export const WORKSPACE_TABS: readonly WorkspaceTab[] = ["needs", "today", "upcoming", "past"];

/** The query-string key for the tab. The calendar overlay owns `?view=`. */
export const TAB_PARAM = "tab";

export function parseTab(raw: string | null | undefined): WorkspaceTab | null {
  return WORKSPACE_TABS.includes(raw as WorkspaceTab) ? (raw as WorkspaceTab) : null;
}

/** The fields of a meeting these rules read. */
export interface WorkspaceMeeting {
  id: string;
  title: string;
  scheduled_at: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  meeting_type?: string | null;
  objective?: string | null;
  tags?: string[] | null;
  attendees?: Array<{ name?: string | null; email?: string | null }> | null;
  priority?: string | null;
  preparation_status?: string | null;
  followup_status?: string | null;
  /** Trigger-maintained counts of the meeting's inbox threads (20261003151646). */
  followup_threads?: number | null;
  followup_replies?: number | null;
  followup_unread?: number | null;
  deal_id?: string | null;
}

/** The calendar date of an instant in a time zone, as YYYY-MM-DD. */
export function dayKey(at: number | string | Date, timeZone?: string): string {
  const d = new Date(at);
  // en-CA formats as YYYY-MM-DD, which also sorts.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

/** "Today", "Tomorrow", or "Thu, Oct 9" (with the year when it is not this one). */
export function dayLabel(key: string, now: number, timeZone?: string): string {
  const today = dayKey(now, timeZone);
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  if (key === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

export interface DayGroup<T> {
  key: string;
  label: string;
  meetings: T[];
}

/**
 * Meetings grouped by the day they are on, in order. A meeting with no time yet
 * goes in a "Time TBD" group at the end rather than being dropped.
 */
export function groupByDay<T extends WorkspaceMeeting>(meetings: readonly T[], now: number, timeZone?: string): DayGroup<T>[] {
  const groups = new Map<string, T[]>();
  const unscheduled: T[] = [];
  const sorted = [...meetings].sort((a, b) => time(a) - time(b));
  for (const m of sorted) {
    if (!m.scheduled_at) {
      unscheduled.push(m);
      continue;
    }
    const key = dayKey(m.scheduled_at, timeZone);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  const out: DayGroup<T>[] = [...groups.entries()].map(([key, list]) => ({
    key,
    label: dayLabel(key, now, timeZone),
    meetings: list,
  }));
  if (unscheduled.length) out.push({ key: "tbd", label: "Time TBD", meetings: unscheduled });
  return out;
}

function time(m: WorkspaceMeeting): number {
  return m.scheduled_at ? new Date(m.scheduled_at).getTime() : Number.POSITIVE_INFINITY;
}

export function isToday(m: WorkspaceMeeting, now: number, timeZone?: string): boolean {
  return Boolean(m.scheduled_at) && dayKey(m.scheduled_at!, timeZone) === dayKey(now, timeZone);
}

/**
 * A week, Monday to Sunday, as day keys: offset 0 is the week containing now,
 * 1 the next one, -1 the last. Inclusive of both ends.
 */
export function weekRange(now: number, offset: number, timeZone?: string): { start: string; end: string } {
  const today = dayKey(now, timeZone);
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  const start = addDays(today, -sinceMonday + offset * 7);
  return { start, end: addDays(start, 6) };
}

export function weekLabel(range: { start: string; end: string }, offset: number): string {
  if (offset === 0) return "This week";
  if (offset === 1) return "Next week";
  if (offset === -1) return "Last week";
  const fmt = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
      new Date(Date.UTC(y, m - 1, d, 12)),
    );
  };
  return `${fmt(range.start)} – ${fmt(range.end)}`;
}

export function inWeek(m: WorkspaceMeeting, range: { start: string; end: string }, timeZone?: string): boolean {
  if (!m.scheduled_at) return false;
  const key = dayKey(m.scheduled_at, timeZone);
  return key >= range.start && key <= range.end;
}

/**
 * Whether a meeting matches the search box: every word somewhere in its title,
 * type, objective, tags or the names and addresses of the people on it.
 */
export function matchesQuery(m: WorkspaceMeeting, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [
    m.title,
    m.meeting_type?.replace(/_/g, " "),
    m.objective,
    ...(m.tags ?? []),
    ...(m.attendees ?? []).flatMap((a) => [a.name, a.email]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/**
 * A past meeting still owed something on its follow-up: drafted and never sent
 * ("unsent"), or sent days ago with nobody answering yet ("awaiting").
 */
export interface PendingFollowUp {
  id: string;
  room_code: string;
  title: string;
  occurred_at: string;
  /** Absent means "unsent", which is all this list held before. */
  kind?: "unsent" | "awaiting";
  /** When the follow-up went out; for "awaiting". */
  sent_at?: string | null;
  /** How many people were written to; for "awaiting". */
  threads?: number;
}

/** Days after sending with no reply before a meeting counts as awaiting one. */
export const AWAITING_REPLY_DAYS = 3;

export type ActionReason = "prep" | "followup" | "unsent" | "awaiting";

export interface ActionItem<T> {
  reason: ActionReason;
  /** The upcoming meeting this is about, when it is one. */
  meeting: T | null;
  /** The past meeting this is about, when it is one. */
  past: PendingFollowUp | null;
}

/** How far ahead an unprepared meeting counts as needing attention. */
export const PREP_HORIZON_DAYS = 7;

/**
 * What is waiting on the host, most urgent first:
 *  - a meeting in the next week that still needs preparing;
 *  - a meeting that has run and wants a follow-up;
 *  - a past meeting whose follow-up was drafted and never sent;
 *  - a past meeting whose follow-up went out days ago and nobody has answered.
 * `status` is the display status the page already derives for each meeting.
 */
export function needsAction<T extends WorkspaceMeeting>(
  upcoming: readonly T[],
  statusOf: (m: T) => string,
  pending: readonly PendingFollowUp[],
  now: number,
): ActionItem<T>[] {
  const horizon = now + PREP_HORIZON_DAYS * 86_400_000;
  const prep: ActionItem<T>[] = [];
  const followUp: ActionItem<T>[] = [];
  const seen = new Set<string>();

  for (const m of [...upcoming].sort((a, b) => time(a) - time(b))) {
    const status = statusOf(m);
    if (status === "Follow-Up Needed") {
      followUp.push({ reason: "followup", meeting: m, past: null });
      seen.add(m.id);
    } else if (status === "Prep Needed" && time(m) <= horizon) {
      prep.push({ reason: "prep", meeting: m, past: null });
    }
  }
  const unsent: ActionItem<T>[] = [];
  const awaiting: ActionItem<T>[] = [];
  for (const p of pending) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.kind === "awaiting") awaiting.push({ reason: "awaiting", meeting: null, past: p });
    else unsent.push({ reason: "unsent", meeting: null, past: p });
  }

  return [...prep, ...followUp, ...unsent, ...awaiting];
}

export const ACTION_LABEL: Record<ActionReason, string> = {
  prep: "Needs prep",
  followup: "Follow-up needed",
  unsent: "Follow-up not sent",
  awaiting: "Awaiting reply",
};

export type ChipTone = "neutral" | "accent" | "success" | "warning" | "info" | "danger";

export interface RowChip {
  label: string;
  tone: ChipTone;
}

/**
 * The facts a row shows beside its status, beyond what the status already says:
 * priority when it is raised, where the follow-up stands once there is one, a
 * linked deal, and up to two tags.
 */
export function rowChips(m: WorkspaceMeeting): RowChip[] {
  const chips: RowChip[] = [];
  if (m.priority === "critical") chips.push({ label: "Critical", tone: "danger" });
  else if (m.priority === "high") chips.push({ label: "High priority", tone: "warning" });

  // Replies outrank "sent": once somebody has answered, that is the news.
  const reply = replyChip(m);
  if (reply) chips.push(reply);
  else if (m.followup_status === "replied") chips.push({ label: "Replied", tone: "success" });
  else if (m.followup_status === "done") chips.push({ label: "Follow-up sent", tone: "success" });
  else if (m.followup_status === "pending_approval") chips.push({ label: "Follow-up awaiting approval", tone: "warning" });
  else if (m.followup_status === "draft") chips.push({ label: "Follow-up drafted", tone: "info" });

  if (m.deal_id) chips.push({ label: "Deal", tone: "accent" });
  for (const tag of (m.tags ?? []).slice(0, 2)) chips.push({ label: tag, tone: "neutral" });
  return chips;
}

/**
 * Where the meeting's conversations stand: unread replies first (that is the
 * badge — something to read), then how many of the people written to answered.
 * Null when nobody has replied yet, so the follow-up chip says the rest.
 */
export function replyChip(m: WorkspaceMeeting): RowChip | null {
  const threads = m.followup_threads ?? 0;
  const replies = m.followup_replies ?? 0;
  const unread = m.followup_unread ?? 0;
  if (unread > 0) return { label: `${unread} new ${unread === 1 ? "reply" : "replies"}`, tone: "accent" };
  if (replies > 0) return { label: `Replied ${replies}/${Math.max(threads, replies)}`, tone: "success" };
  return null;
}

/** Up to two letters for an avatar: letters only, first and last word. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "")
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}
