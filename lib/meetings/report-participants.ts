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
 * Who the transcript proves was in the room, for people the attendance table
 * structurally cannot hold.
 *
 * `live_meeting_participants` has an RLS policy of `user_id = auth.uid()` and
 * the join path writes a row only `if (user)` -- so an unauthenticated guest
 * leaves NO attendance row at all. An invitee who opens the link without
 * signing in is therefore absent from every attendance read, and the report
 * told the host they did not join.
 *
 * Their lines in the transcript are the evidence that survives. They are
 * written through an API route rather than straight to the table, so a guest
 * CAN write them, and `speaker` is the name they chose at the door -- which is
 * the only identity this system has for them either way.
 *
 * Only guest rows. A member who spoke already has an attendance row with a
 * directory name and address against it, and `loadPresentPeople` prefers the
 * directory's name over the one typed into a join screen -- so adding their
 * typed name here would introduce an identity nothing can match and turn every
 * known absence into "cannot tell".
 *
 * Pure, and takes the rows the report page has already loaded: this is not
 * worth a query of its own.
 */
export function presenceFromSpeech(
  rows: readonly { speaker?: string | null; speaker_user_id?: string | null }[],
): PresentPerson[] {
  const seen = new Set<string>();
  const people: PresentPerson[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    // A row stamped with an account is a member, already in attendance. Rows
    // written before the column existed are null and are read as guests: the
    // cost is an unmatched name, which makes an absence unknown rather than
    // false, and that is the safe direction.
    if (row.speaker_user_id) continue;
    const name = typeof row.speaker === "string" ? row.speaker.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ name, email: null });
  }
  return people;
}

/**
 * The identities the room actually recorded, split by what they pin down.
 *
 * `live_meeting_participants` carries a user id and a display name and NO
 * address; `recipients.server.ts` fills the address in from `principals`, which
 * it can only do for somebody who was signed in. So a row is either pinned to
 * an address or it is a NAME and nothing else — and the name is the only
 * identity this system has for that person.
 */
interface RoomIdentities {
  /** Addresses in the room. Matching one of these is certainty. */
  emails: Set<string>;
  /** Names of rows with no address, lowercased. Matching one is a judgement. */
  anonymousNames: Set<string>;
  /** Rows with neither an address nor a name: they could be anybody. */
  nameless: number;
}

function roomIdentities(present: readonly PresentPerson[]): RoomIdentities {
  const emails = new Set<string>();
  const anonymousNames = new Set<string>();
  let nameless = 0;
  for (const person of present) {
    if (!person || typeof person !== "object") continue;
    const email = lower(person.email);
    if (email) {
      // Already fully identified. Its name is deliberately NOT added below: a
      // row that resolved to one address must not be used to claim that a
      // DIFFERENT address was in the room because two people share a name.
      emails.add(email);
      continue;
    }
    const name = lower(person.name);
    if (name) anonymousNames.add(name);
    else nameless += 1;
  }
  return { emails, anonymousNames, nameless };
}

/**
 * Everyone in the meeting, host first, then in the order the follow-up's own
 * recipient rule lists them — so the people shown here are exactly the people
 * a send would reach, plus the host and anyone with no address.
 *
 * ── Why attendance is three-valued, and why it has to be ────────────────────
 *
 * This matched attendance on ADDRESS alone, and the room often has no address
 * for somebody who was unmistakably in it: an invitee who opened the link
 * without signing in has a row with `email: null`. The report then told the
 * host "didn't join" about a person they had just spent an hour talking to —
 * which is the bug this answers, and the worst kind, because it is a confident
 * false statement about a fact the reader cannot check from the page.
 *
 * So there are three answers rather than two:
 *
 *   true   their address is in the room, OR a row with no address carries their
 *          name. A guest row's display name is the only identity available, and
 *          `recipients.ts` already treats a name match as the same person when
 *          it decides who is unreachable — this makes the two agree.
 *   false  every row in the room was pinned to an ADDRESS, or to a name that is
 *          somebody else on this list, and theirs is not among them. Only then
 *          is absence something that is known rather than assumed.
 *   null   somebody in the room could not be accounted for. One of those rows
 *          may be this person under a name nothing can match — "sarah's
 *          iPhone", a nickname, a blank that became "Guest". The page prints
 *          nothing for null and "didn't join" only for false, so this is the
 *          distinction that stops the report inventing an absence.
 */
export function reportParticipants(input: {
  host: { name: string | null; email: string | null } | null;
  invited: unknown;
  present: readonly PresentPerson[];
}): ReportParticipant[] {
  const hostEmail = lower(input.host?.email) || null;
  const room = roomIdentities(input.present);
  const invited = invitedEmails(input.invited);
  const audience = meetingRecipients({
    invited: input.invited,
    present: input.present,
    senderEmail: hostEmail,
  });

  /** Anonymous rows this list has claimed, so the rest can still be told apart. */
  const claimed = new Set<string>();
  const wasInRoom = (email: string | null, name: string): boolean => {
    if (email && room.emails.has(email)) return true;
    const key = lower(name);
    if (key && room.anonymousNames.has(key)) {
      claimed.add(key);
      return true;
    }
    return false;
  };

  const hostName = (input.host?.name ?? "").trim() || hostEmail || "Host";
  const seats: Array<{ person: ReportParticipant; matched: boolean }> = [];

  if (input.host && (input.host.name || hostEmail)) {
    seats.push({
      person: {
        name: hostName,
        email: hostEmail,
        role: "host",
        // Resolved below for a match; left null otherwise rather than false.
        // The host is not necessarily recorded as a participant on every path
        // that creates a meeting, and "the host didn't join their own meeting"
        // is too strong a claim to make off a row that may never be written.
        attended: null,
        receivesFollowUp: false,
      },
      matched: wasInRoom(hostEmail, hostName),
    });
  }

  for (const r of audience.recipients) {
    const email = lower(r.email);
    seats.push({
      person: {
        name: r.name,
        email,
        role: invited.has(email) ? "invitee" : "attendee",
        attended: null,
        receivesFollowUp: true,
      },
      matched: wasInRoom(email, r.name),
    });
  }

  // Whether anybody in the room is still unaccounted for, which is what decides
  // between "did not join" and "cannot tell". Computed after every seat has had
  // its chance to claim a name: one unmatchable guest must not make the whole
  // invite list unknown when the rest of the room is fully identified.
  const unaccounted =
    room.nameless > 0 || [...room.anonymousNames].some((name) => !claimed.has(name));

  const people = seats.map(({ person, matched }) => {
    if (matched) return { ...person, attended: true };
    // No attendance rows at all — a meeting held before they were kept — is
    // unknown rather than empty.
    if (input.present.length === 0) return person;
    if (unaccounted) return person;
    // The host keeps the benefit of the doubt. See the seat above.
    return person.role === "host" ? person : { ...person, attended: false };
  });

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
  | { kind: "awaiting_approval" }
  | { kind: "sent" }
  | { kind: "replied" };

/**
 * Read off what is stored: `followup_status` is "done" once a send reached
 * everyone or an approved copy went out, "pending_approval" while copies wait on
 * an approver, "replied" once somebody answered; drafts are rows on the inbox
 * threads this meeting wrote to.
 */
export function followUpState(input: {
  hasDraft: boolean;
  followupStatus: string | null | undefined;
  draftedThreads: number;
}): FollowUpState {
  if (input.followupStatus === "replied") return { kind: "replied" };
  if (input.followupStatus === "done") return { kind: "sent" };
  if (input.followupStatus === "pending_approval") return { kind: "awaiting_approval" };
  if (!input.hasDraft) return { kind: "none" };
  if (input.draftedThreads > 0) return { kind: "drafted", threads: input.draftedThreads };
  return { kind: "not_sent" };
}

export function followUpStateLabel(state: FollowUpState): string {
  switch (state.kind) {
    case "replied":
      return "Replied";
    case "sent":
      return "Sent";
    case "awaiting_approval":
      return "Awaiting approval";
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
