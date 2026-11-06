// lib/meetings/follow-up-loop.ts
// The follow-up as a loop: written in a tone, from a template, with each
// reader's own next steps; sent now, later, or with a nudge if nobody answers;
// tracked per recipient; and its action items chased when they go overdue.
//
// Pure: no React, no Supabase. The routes, the panel and the hourly sweep all
// read their rules from here.

import { FIRST_NAME_TOKEN } from "@/lib/meetings/follow-up-greeting";
import { parseActionItem } from "@/lib/meetings/action-items";

// ─── Tone ───────────────────────────────────────────────────────────────────

export type FollowUpTone = "formal" | "warm" | "brief";

export const FOLLOW_UP_TONES: ReadonlyArray<{ value: FollowUpTone; label: string; instruction: string }> = [
  { value: "formal", label: "Formal", instruction: "Rewrite it in a formal, polished register suitable for an LP or an investment committee." },
  { value: "warm", label: "Warm", instruction: "Rewrite it in a warm, personable register, as to someone you have a good relationship with." },
  { value: "brief", label: "Brief", instruction: "Rewrite it as briefly as possible: a line of thanks, the decisions, the next steps, the sign-off." },
];

export function isTone(raw: unknown): raw is FollowUpTone {
  return raw === "formal" || raw === "warm" || raw === "brief";
}

/** A free-text instruction for the rewrite, cleaned; null for none. */
export function cleanInstruction(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return t || null;
}

// ─── Templates ──────────────────────────────────────────────────────────────

export const TEMPLATE_TOKENS = [
  { token: FIRST_NAME_TOKEN, meaning: "each recipient's first name" },
  { token: "{{meeting_title}}", meaning: "the meeting's title" },
  { token: "{{host_name}}", meaning: "your name" },
  { token: "{{summary}}", meaning: "the report's summary" },
  { token: "{{decisions}}", meaning: "the decisions, as a list" },
  { token: "{{action_items}}", meaning: "the action items, as a numbered list" },
] as const;

export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_BODY_MAX = 10_000;
export const MAX_TEMPLATES = 50;

export function cleanTemplateName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= TEMPLATE_NAME_MAX ? t : null;
}

export function cleanTemplateBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  return t.length >= 1 && t.length <= TEMPLATE_BODY_MAX ? t : null;
}

export interface TemplateContext {
  meetingTitle: string;
  hostName: string | null;
  summary: string;
  decisions: readonly string[];
  actionItems: readonly string[];
}

/**
 * A template with the meeting filled in. {{first_name}} is left for the send
 * to personalise per recipient; a token with nothing to fill is removed with
 * its line, rather than left as "{{decisions}}" in a client's inbox.
 */
export function fillTemplate(body: string, ctx: TemplateContext): string {
  const values: Record<string, string> = {
    "{{meeting_title}}": ctx.meetingTitle.trim(),
    "{{host_name}}": (ctx.hostName ?? "").trim(),
    "{{summary}}": ctx.summary.trim(),
    "{{decisions}}": ctx.decisions.map((d) => `- ${d}`).join("\n"),
    "{{action_items}}": ctx.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n"),
  };
  const lines = body.split("\n").flatMap((line) => {
    let out = line;
    let emptied = false;
    for (const [token, value] of Object.entries(values)) {
      if (!out.includes(token)) continue;
      if (!value) emptied = true;
      out = out.split(token).join(value);
    }
    // A line that was only a token with nothing behind it goes.
    if (emptied && !out.replace(/[-:•*\s]/g, "")) return [];
    return out.split("\n");
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Each reader's own next steps ───────────────────────────────────────────

function nameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The action items that name this recipient as their owner: by full name,
 * first name, or the local part of their address. A first name shared by two
 * recipients matches neither — the same unique-or-nothing rule the task
 * routing uses, because telling Ana Ruiz she owns Ana Lopez's item is worse
 * than telling her nothing.
 */
export function itemsFor(
  recipient: { name: string; email: string },
  items: readonly string[],
  everyone: ReadonlyArray<{ name: string; email: string }> = [recipient],
): string[] {
  const full = nameKey(recipient.name);
  const first = full.split(" ")[0] ?? "";
  const local = nameKey((recipient.email.split("@")[0] ?? "").replace(/[._-]+/g, " "));
  const firstShared = everyone.filter((p) => nameKey(p.name).split(" ")[0] === first).length > 1;
  const out: string[] = [];
  for (const line of items) {
    const { owner, task } = parseActionItem(line);
    if (!owner) continue;
    const o = nameKey(owner);
    const mine = (full && o === full) || (local && o === local) || (!firstShared && first && o === first);
    if (mine) out.push(task);
  }
  return out;
}

// The whole first line is the sign-off phrase — "Thanks for today." is a sentence, "Thanks," is a sign-off.
const SIGN_OFF = /^(best|best regards|thanks|thank you|many thanks|regards|kind regards|warm regards|cheers|sincerely|all the best|talk soon)[,.!]?\s*(\n|$)/i;

/**
 * The body with a "Your next steps" block for this reader, placed before the
 * sign-off (or at the end when there is none). Unchanged when they own nothing.
 */
export function withPersonalItems(body: string, items: readonly string[]): string {
  if (!items.length) return body;
  const block = `Your next steps from this meeting:\n${items.map((t) => `- ${t}`).join("\n")}`;
  const paragraphs = body.split(/\n{2,}/);
  const signAt = paragraphs.findIndex((p, i) => i > 0 && SIGN_OFF.test(p.trim()));
  if (signAt === -1) return `${body.trimEnd()}\n\n${block}`;
  return [...paragraphs.slice(0, signAt), block, ...paragraphs.slice(signAt)].join("\n\n");
}

// ─── Due dates on action items ──────────────────────────────────────────────

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function endOfDayUtc(d: Date): string {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 0));
  return out.toISOString();
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * When an action item says it is due — "by Friday", "by Nov 12", "by 11/12",
 * "tomorrow", "end of week", "next week" — as the end of that day (UTC), from
 * the day of the meeting. Null when it says nothing a person would agree on.
 */
export function dueFromText(line: string, meetingDay: Date): string | null {
  const t = ` ${line.toLowerCase().replace(/[,.;()]/g, " ").replace(/\s+/g, " ")} `;
  const today = new Date(Date.UTC(meetingDay.getUTCFullYear(), meetingDay.getUTCMonth(), meetingDay.getUTCDate()));

  if (/\b(today|eod|end of (the )?day)\b/.test(t)) return endOfDayUtc(today);
  if (/\b(tomorrow|tmrw)\b/.test(t)) return endOfDayUtc(addDays(today, 1));
  if (/\b(end of (the )?week|eow|this week)\b/.test(t)) {
    const toFriday = (5 - today.getUTCDay() + 7) % 7;
    return endOfDayUtc(addDays(today, toFriday));
  }
  if (/\bnext week\b/.test(t)) {
    const toNextFriday = ((5 - today.getUTCDay() + 7) % 7) + 7;
    return endOfDayUtc(addDays(today, toNextFriday));
  }
  if (/\b(end of (the )?month|eom)\b/.test(t)) {
    return endOfDayUtc(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)));
  }

  const weekday = / (?:by|before|on|due|until) (?:next )?(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]* /.exec(t);
  if (weekday) {
    const wd = WEEKDAYS.findIndex((d) => d.startsWith(weekday[1]));
    let ahead = (wd - today.getUTCDay() + 7) % 7;
    if (ahead === 0) ahead = 7;
    if (/ next (mon|tue|wed|thu|fri|sat|sun)/.test(weekday[0])) ahead += ahead <= (7 - today.getUTCDay()) % 7 ? 7 : 0;
    return endOfDayUtc(addDays(today, ahead));
  }

  const monthDay = / (?:by|before|on|due|until) ([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)? /.exec(t);
  if (monthDay) {
    const m = MONTHS.findIndex((x) => monthDay[1].startsWith(x));
    const day = Number(monthDay[2]);
    if (m >= 0 && day >= 1 && day <= 31) {
      let d = new Date(Date.UTC(today.getUTCFullYear(), m, day));
      if (d.getUTCMonth() !== m) return null;
      if (d < today) d = new Date(Date.UTC(today.getUTCFullYear() + 1, m, day));
      return endOfDayUtc(d);
    }
  }

  const numeric = / (?:by|before|on|due|until) (\d{1,2})\/(\d{1,2}) /.exec(t);
  if (numeric) {
    const m = Number(numeric[1]) - 1;
    const day = Number(numeric[2]);
    if (m >= 0 && m < 12 && day >= 1 && day <= 31) {
      let d = new Date(Date.UTC(today.getUTCFullYear(), m, day));
      if (d.getUTCMonth() !== m) return null;
      if (d < today) d = new Date(Date.UTC(today.getUTCFullYear() + 1, m, day));
      return endOfDayUtc(d);
    }
  }
  return null;
}

// ─── Review before send ─────────────────────────────────────────────────────

function domainOf(email: string | null | undefined): string {
  return (email ?? "").split("@")[1]?.toLowerCase().trim() ?? "";
}

/**
 * Recipients outside the sender's firm: a different domain from the host's.
 * A host on a personal address has no firm domain to compare with, so nobody
 * is flagged rather than everybody.
 */
export function externalRecipients<T extends { email: string | null }>(recipients: readonly T[], hostEmail: string | null): T[] {
  const own = domainOf(hostEmail);
  const PERSONAL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "live.com"]);
  if (!own || PERSONAL.has(own)) return [];
  return recipients.filter((r) => {
    const d = domainOf(r.email);
    return d && d !== own;
  });
}

/** Seconds a Send can be taken back before anything leaves. */
export const UNDO_SECONDS = 10;

// ─── Schedule and nudge ─────────────────────────────────────────────────────

export const NUDGE_DAYS = [2, 3, 5, 7] as const;
/** Earliest a scheduled send may be: later than this is "later", sooner is "now". */
export const MIN_SCHEDULE_MS = 5 * 60_000;
export const MAX_SCHEDULE_MS = 30 * 86_400_000;

export function cleanNudgeDays(raw: unknown): number | null {
  const n = Number(raw);
  return (NUDGE_DAYS as readonly number[]).includes(n) ? n : null;
}

/**
 * When a send was asked to go: null for now, a Date for later, undefined for
 * a time that cannot be honoured (malformed, in the past, or more than 30 days
 * off). The sweep runs hourly, so "later" means within the hour after.
 */
export function cleanSendAt(raw: unknown, now: number): Date | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return undefined;
  if (at - now < MIN_SCHEDULE_MS) return at > now - 60_000 ? null : undefined;
  if (at - now > MAX_SCHEDULE_MS) return undefined;
  return new Date(at);
}

export interface SendRow {
  id: string;
  email: string;
  name: string | null;
  status: "scheduled" | "sent" | "failed" | "cancelled";
  scheduled_for: string | null;
  sent_at: string | null;
  error: string | null;
  nudge_after_days: number | null;
  nudged_at: string | null;
  replied_at: string | null;
  created_at: string;
}

/** Whether a sent follow-up is owed its nudge now. */
export function nudgeDue(row: Pick<SendRow, "status" | "sent_at" | "nudge_after_days" | "nudged_at" | "replied_at">, now: number): boolean {
  if (row.status !== "sent" || !row.sent_at || !row.nudge_after_days || row.nudged_at || row.replied_at) return false;
  return now - Date.parse(row.sent_at) >= row.nudge_after_days * 86_400_000;
}

/** The nudge itself: short, on the same subject so it threads. */
export function nudgeEmail(input: { name: string | null; subject: string; hostName: string | null }): { subject: string; body: string } {
  const first = (input.name ?? "").trim().split(/\s+/)[0];
  const subject = /^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`;
  const body = [
    first ? `Hi ${first},` : "Hi,",
    "Just bringing my note from our meeting back to the top of your inbox, in case it got buried. Happy to answer anything on it.",
    input.hostName ? `Best,\n${input.hostName}` : "Best,",
  ].join("\n\n");
  return { subject, body };
}

export type DeliveryState = "scheduled" | "sent" | "failed" | "cancelled" | "replied" | "nudged";

export interface DeliveryLine {
  id: string;
  email: string;
  name: string | null;
  state: DeliveryState;
  /** When the state happened (or will, for scheduled). */
  at: string | null;
  error: string | null;
  nudgeAfterDays: number | null;
}

/**
 * One line per recipient: their most recent send, read as what a host needs
 * to know — replied outranks nudged outranks sent. A cancelled row is shown
 * only when nothing newer exists for that person.
 */
export function deliveryLines(rows: readonly SendRow[]): DeliveryLine[] {
  const latest = new Map<string, SendRow>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    latest.set(row.email.toLowerCase(), row);
  }
  return [...latest.values()]
    .map((r): DeliveryLine => {
      const state: DeliveryState =
        r.status === "sent" ? (r.replied_at ? "replied" : r.nudged_at ? "nudged" : "sent") : r.status;
      const at =
        state === "replied" ? r.replied_at : state === "nudged" ? r.nudged_at : state === "scheduled" ? r.scheduled_for : r.sent_at ?? r.created_at;
      return { id: r.id, email: r.email, name: r.name, state, at, error: r.error, nudgeAfterDays: r.nudge_after_days };
    })
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

// ─── Chasing overdue action items ───────────────────────────────────────────

export const CHASE_EVERY_MS = 3 * 86_400_000;
export const MAX_CHASES = 3;

const OPEN_STATUSES = new Set(["pending", "in_progress", "blocked"]);

/** Whether an action item from a meeting is overdue and owed a reminder now. */
export function chaseDue(
  task: { status: string; due_at: string | null; chased_at: string | null; chase_count: number | null },
  now: number,
): boolean {
  if (!OPEN_STATUSES.has(task.status) || !task.due_at) return false;
  if (Date.parse(task.due_at) > now) return false;
  if ((task.chase_count ?? 0) >= MAX_CHASES) return false;
  return !task.chased_at || now - Date.parse(task.chased_at) >= CHASE_EVERY_MS;
}

/** The reminder an owner gets for an overdue item. */
export function chaseEmail(input: { ownerName: string | null; title: string; meetingTitle: string | null; dueAt: string; link: string }): {
  subject: string;
  body: string;
} {
  const first = (input.ownerName ?? "").trim().split(/\s+/)[0];
  const due = new Date(input.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return {
    subject: `Overdue: ${input.title}`.slice(0, 160),
    body: [
      first ? `Hi ${first},` : "Hi,",
      `A reminder that this action item${input.meetingTitle ? ` from "${input.meetingTitle}"` : ""} was due ${due} and is still open:`,
      `- ${input.title}`,
      `Mark it done or update it here: ${input.link}`,
    ].join("\n\n"),
  };
}

// ─── The follow-up dashboard ────────────────────────────────────────────────

export interface QueueMeeting {
  id: string;
  title: string | null;
  room_code: string | null;
  ended_at: string | null;
  followup_status: string | null;
}

export interface QueueTask {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  meeting_id: string | null;
  assignee: string | null;
}

export interface FollowUpQueue {
  /** Ended meetings whose follow-up has not gone out. */
  notSent: QueueMeeting[];
  /** People sent a follow-up who have not answered, oldest first. */
  awaiting: Array<{ meeting: QueueMeeting; name: string; email: string; sentAt: string; days: number }>;
  /** Follow-ups still to go out at a set time. */
  scheduled: Array<{ meeting: QueueMeeting; count: number; at: string }>;
  /** Open action items from these meetings past their due date. */
  overdue: Array<QueueTask & { meeting: QueueMeeting | null; daysLate: number }>;
}

const DONE_FOLLOWUP = new Set(["done", "replied", "pending_approval"]);
/** How long a sent follow-up can sit unanswered before it is worth showing. */
export const AWAITING_AFTER_MS = 2 * 86_400_000;

/**
 * What the host still owes their meetings, grouped: follow-ups not sent,
 * people not answering, sends scheduled, and action items overdue.
 */
export function followUpQueue(
  meetings: readonly QueueMeeting[],
  sends: ReadonlyArray<Pick<SendRow, "email" | "name" | "status" | "sent_at" | "scheduled_for" | "replied_at" | "created_at"> & { meeting_id: string }>,
  tasks: readonly QueueTask[],
  now: number,
): FollowUpQueue {
  const byId = new Map(meetings.map((m) => [m.id, m]));
  const notSent = meetings
    .filter((m) => m.ended_at && !DONE_FOLLOWUP.has(m.followup_status ?? ""))
    .sort((a, b) => Date.parse(b.ended_at ?? "") - Date.parse(a.ended_at ?? ""));

  // Each person's latest row per meeting.
  const latest = new Map<string, (typeof sends)[number]>();
  for (const s of [...sends].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    latest.set(`${s.meeting_id}:${s.email.toLowerCase()}`, s);
  }
  const awaiting: FollowUpQueue["awaiting"] = [];
  const scheduledBy = new Map<string, { count: number; at: string }>();
  for (const s of latest.values()) {
    const meeting = byId.get(s.meeting_id);
    if (!meeting) continue;
    if (s.status === "sent" && s.sent_at && !s.replied_at && now - Date.parse(s.sent_at) >= AWAITING_AFTER_MS) {
      awaiting.push({ meeting, name: s.name ?? s.email, email: s.email, sentAt: s.sent_at, days: Math.floor((now - Date.parse(s.sent_at)) / 86_400_000) });
    }
    if (s.status === "scheduled" && s.scheduled_for) {
      const cur = scheduledBy.get(s.meeting_id);
      scheduledBy.set(s.meeting_id, { count: (cur?.count ?? 0) + 1, at: cur && cur.at < s.scheduled_for ? cur.at : s.scheduled_for });
    }
  }
  awaiting.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  const scheduled = [...scheduledBy.entries()]
    .map(([id, v]) => ({ meeting: byId.get(id)!, ...v }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const overdue = tasks
    .filter((t) => OPEN_STATUSES.has(t.status) && t.due_at && Date.parse(t.due_at) < now)
    .map((t) => ({ ...t, meeting: t.meeting_id ? byId.get(t.meeting_id) ?? null : null, daysLate: Math.max(0, Math.floor((now - Date.parse(t.due_at!)) / 86_400_000)) }))
    .sort((a, b) => b.daysLate - a.daysLate);

  return { notSent, awaiting, scheduled, overdue };
}
