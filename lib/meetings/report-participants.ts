// lib/meetings/report-participants.ts
// Who was in a meeting, in the roles the report page shows them in, and the
// two other facts the page's sidebar answers: whether the follow-up has gone
// out, and which task each action item became.
//
// The page never said who the meeting was between. The follow-up was written
// for "the attendees" and sent to a list the host only saw after pressing Send.
// So the people come first now, each marked host, invitee or attendee, with
// whoever the follow-up cannot reach said plainly before anything is sent.
//
// Pure: no database, no DOM.
import { meetingRecipients, type PresentPerson } from "@/lib/meetings/recipients";
import { actionItemKey, parseActionItem } from "@/lib/meetings/action-items";

export type ParticipantRole = "host" | "invitee" | "attendee";

export interface ReportParticipant {
  name: string;
  email: string | null;
  role: ParticipantRole;
  /** Whether they were in the room. Null when attendance could not be told. */
  attended: boolean | null;
  /** Whether the follow-up will reach them: they are not the host and have an address. */
  receivesFollowUp: boolean;
}

function lower(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** The invite list's addresses, read as defensively as recipients.ts reads it. */
function invitedEmails(invited: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(invited)) return out;
  for (const entry of invited) {
    if (typeof entry === "string") out.add(lower(entry));
    else if (entry && typeof entry === "object") out.add(lower((entry as { email?: unknown }).email));
  }
  out.delete("");
  return out;
}

/**
 * Everyone in the meeting, host first, then in the order the follow-up's own
 * recipient rule lists them — so the people shown here are exactly the people
 * a send would reach, plus the host and anyone with no address.
 */
export function reportParticipants(input: {
  host: { name: string | null; email: string | null } | null;
  invited: unknown;
  present: readonly PresentPerson[];
}): ReportParticipant[] {
  const hostEmail = lower(input.host?.email) || null;
  const presentEmails = new Set(input.present.map((p) => lower(p.email)).filter(Boolean));
  const invited = invitedEmails(input.invited);
  const audience = meetingRecipients({
    invited: input.invited,
    present: input.present,
    senderEmail: hostEmail,
  });

  const people: ReportParticipant[] = [];
  if (input.host && (input.host.name || hostEmail)) {
    people.push({
      name: (input.host.name ?? "").trim() || hostEmail || "Host",
      email: hostEmail,
      role: "host",
      attended: hostEmail ? presentEmails.has(hostEmail) || null : null,
      receivesFollowUp: false,
    });
  }

  for (const r of audience.recipients) {
    const email = lower(r.email);
    const wasInvited = invited.has(email);
    people.push({
      name: r.name,
      email,
      role: wasInvited ? "invitee" : "attendee",
      // Attendance is only known for people the room recorded. Somebody on the
      // invitation who never joined is "did not join"; with no attendance rows
      // at all (a meeting held before they were kept) it is unknown.
      attended: presentEmails.has(email) ? true : input.present.length ? false : null,
      receivesFollowUp: true,
    });
  }

  for (const name of audience.unreachable) {
    people.push({ name, email: null, role: "attendee", attended: true, receivesFollowUp: false });
  }

  return people;
}

/** Where the follow-up has got to, in one word the page can show as a chip. */
export type FollowUpState =
  | { kind: "none" }
  | { kind: "not_sent" }
  | { kind: "drafted"; threads: number }
  | { kind: "sent" };

/**
 * Read off what is stored: `followup_status` is "done" only once a send reached
 * everyone, and drafts are rows on the inbox threads this meeting wrote to.
 */
export function followUpState(input: {
  hasDraft: boolean;
  followupStatus: string | null | undefined;
  draftedThreads: number;
}): FollowUpState {
  if (input.followupStatus === "done") return { kind: "sent" };
  if (!input.hasDraft) return { kind: "none" };
  if (input.draftedThreads > 0) return { kind: "drafted", threads: input.draftedThreads };
  return { kind: "not_sent" };
}

export function followUpStateLabel(state: FollowUpState): string {
  switch (state.kind) {
    case "sent":
      return "Sent to everyone";
    case "drafted":
      return state.threads === 1 ? "Drafted in inbox" : `Drafted in inbox (${state.threads})`;
    case "not_sent":
      return "Not sent";
    default:
      return "No follow-up";
  }
}

/** A task an action item became, as the page needs it. */
export interface ActionItemTask {
  id: string;
  title: string | null;
  status: string;
  dueAt: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  /** `context_snapshot.action_item`: the line verbatim, which is how it is matched. */
  actionItem: string | null;
}

export interface ReportActionItem {
  line: string;
  /** The task text without the owner prefix. */
  task: string;
  /** Who it is for: the person the task reached, else the name the line was written to. */
  owner: string | null;
  done: boolean;
  dueAt: string | null;
  taskId: string | null;
  assignedTo: string | null;
}

/**
 * Each action item with the task it became, matched the way the task writer
 * de-duplicates them: by the item's normalised text.
 */
export function linkActionItems(items: readonly string[], tasks: readonly ActionItemTask[]): ReportActionItem[] {
  const byKey = new Map<string, ActionItemTask>();
  for (const task of tasks) {
    const key = actionItemKey(task.actionItem || task.title || "");
    if (key && !byKey.has(key)) byKey.set(key, task);
  }
  return items.map((line) => {
    const parsed = parseActionItem(line);
    const task = byKey.get(actionItemKey(line)) ?? null;
    return {
      line,
      task: parsed.task || line,
      // The name the item was written to first: a task that could not be routed
      // fell back to the host, and naming the host as its owner would be wrong.
      owner: parsed.owner || task?.assigneeName || null,
      done: task?.status === "completed",
      dueAt: task?.dueAt ?? null,
      taskId: task?.id ?? null,
      assignedTo: task?.assignedTo ?? null,
    };
  });
}
