// lib/meetings/invite-advice.ts
// What an invitation still needs before it goes out, as questions.
//
// Scheduling a meeting emails everyone on it. What they receive is the title,
// the time and a join button — so a guest asked to a board review learns
// nothing about what it is for, what to read first, or whether they will be
// waiting for someone to let them in. Each of those is a question the host can
// answer in a sentence; this decides which ones are worth asking for THIS
// meeting, in the order they matter, and drafts the answer where it can.
//
// Pure: no React, no network.

import { INVITE_NOTE_MAX } from "@/lib/meetings/invite-note";

export type InviteQuestionId = "guests" | "unreachable" | "access" | "hours" | "prep" | "agenda" | "note";

export interface InviteContext {
  meetingType: string;
  title: string;
  /** Guests with an address. */
  attendees: Array<{ email: string; type: "internal" | "external" }>;
  /** Names on the record with no address — never emailed. */
  unreachableCount: number;
  objective: string;
  agenda: string;
  preparationRequirements: string;
  /** Guests with the link join straight in. */
  guestQuickAccess: boolean;
  /** Guests for whom the start is outside working hours. */
  offHoursGuests: number;
  /** The personal message, as written so far. */
  note: string;
  durationMinutes: number;
  /**
   * Whether this save can carry a personal note. Only a new or published
   * meeting sends one; an edit to a meeting already out sends change notices,
   * which do not, so asking for a note there would be asking for something
   * that never arrives.
   */
  noteSupported: boolean;
}

export interface InviteQuestion {
  id: InviteQuestionId;
  prompt: string;
  /** Why it is being asked, in a line. */
  why: string;
  /** The answer changes whether the invitation can go out at all. */
  blocking: boolean;
  /** Still worth the host's attention given what is filled in now. */
  open: boolean;
}

const WAITING_ROOM_TYPES = new Set(["board_meeting", "lp_review", "diligence", "investor_update"]);
const PREP_TYPES = new Set(["board_meeting", "lp_review", "diligence", "deal_review", "portfolio_review"]);

export function externalCount(ctx: Pick<InviteContext, "attendees">): number {
  return ctx.attendees.filter((a) => a.type === "external").length;
}

/**
 * Whether outside guests should wait to be admitted.
 *
 * Quick access suits an open working call; a meeting where confidentiality is
 * the point (a board pack, an LP review, diligence) is better with a person
 * deciding who comes in.
 */
export function recommendedAccess(meetingType: string): "waiting-room" | "quick-access" {
  return WAITING_ROOM_TYPES.has(meetingType) ? "waiting-room" : "quick-access";
}

export function needsPrepQuestion(meetingType: string): boolean {
  return PREP_TYPES.has(meetingType);
}

/** The questions worth asking for this meeting, most important first. */
export function inviteQuestions(ctx: InviteContext): InviteQuestion[] {
  const out: InviteQuestion[] = [];
  const outside = externalCount(ctx);
  const guests = ctx.attendees.length;

  out.push({
    id: "guests",
    prompt: guests === 0 ? "Who should be invited?" : `Is this everyone? ${guests} ${guests === 1 ? "guest" : "guests"} will be emailed.`,
    why: "Invitations only go to people with an email address.",
    blocking: guests === 0,
    open: guests === 0,
  });

  if (ctx.unreachableCount > 0) {
    out.push({
      id: "unreachable",
      prompt: `${ctx.unreachableCount} ${ctx.unreachableCount === 1 ? "person has" : "people have"} no email address. Who are they?`,
      why: "They were added by name only, so they have never been invited and won't be.",
      blocking: false,
      open: true,
    });
  }

  if (outside > 0) {
    const want = recommendedAccess(ctx.meetingType);
    const current = ctx.guestQuickAccess ? "quick-access" : "waiting-room";
    out.push({
      id: "access",
      prompt: `Should the ${outside} outside ${outside === 1 ? "guest" : "guests"} join straight away, or wait for you to let them in?`,
      why:
        want === "waiting-room"
          ? "This is a confidential kind of meeting, so a waiting room is the safer default."
          : "For a working call, letting guests straight in avoids them sitting in a lobby you are not watching.",
      blocking: false,
      open: current !== want,
    });
  }

  if (ctx.offHoursGuests > 0) {
    out.push({
      id: "hours",
      prompt: `${ctx.offHoursGuests} ${ctx.offHoursGuests === 1 ? "guest is" : "guests are"} being asked outside working hours. Keep this time?`,
      why: "Their local time is very early or very late. Say so in the message, or move the meeting.",
      blocking: false,
      open: true,
    });
  }

  if (needsPrepQuestion(ctx.meetingType)) {
    out.push({
      id: "prep",
      prompt: "Do guests need to read or prepare anything first?",
      why: "A board, LP or diligence meeting goes better when people arrive having read the material.",
      blocking: false,
      open: !ctx.preparationRequirements.trim(),
    });
  }

  if (outside > 0 && ctx.durationMinutes >= 45) {
    out.push({
      id: "agenda",
      prompt: "What will you cover? Guests are more likely to come with an agenda.",
      why: "Outside guests only see the title and time. A longer meeting is easier to say yes to when it says what it is for.",
      blocking: false,
      open: !ctx.agenda.trim() && !ctx.objective.trim(),
    });
  }

  if (ctx.noteSupported) {
    out.push({
      id: "note",
      prompt: "Add a personal note to the invitation?",
      why: "It appears above the join button. A line from you is more likely to be read than the standard text.",
      blocking: false,
      open: !ctx.note.trim() && guests > 0,
    });
  }

  return out;
}

/**
 * A first draft of the invitation note from what the host has already written.
 * A starting point the host edits, never sent unseen.
 */
export function suggestInviteNote(ctx: Pick<InviteContext, "title" | "objective" | "agenda" | "preparationRequirements" | "offHoursGuests">): string {
  const lines: string[] = [];
  const title = ctx.title.trim();
  lines.push(title ? `I'd like to invite you to "${title}".` : "I'd like to invite you to a meeting.");

  const objective = ctx.objective.trim();
  if (objective) lines.push(`What we need to get to: ${objective}`);

  const agenda = ctx.agenda
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (agenda.length === 1) lines.push(`On the agenda: ${agenda[0]}`);
  else if (agenda.length > 1) lines.push(`On the agenda:\n${agenda.map((l) => `• ${l.replace(/^[-•*]\s*/, "")}`).join("\n")}`);

  const prep = ctx.preparationRequirements.trim();
  if (prep) lines.push(`Before we meet: ${prep}`);

  if (ctx.offHoursGuests > 0) lines.push("I know this time is outside normal hours for some of you — thank you for making it work.");

  lines.push("Looking forward to it.");
  return lines.join("\n\n").slice(0, INVITE_NOTE_MAX);
}

/** How many questions are still worth the host's attention, excluding any they have already reviewed. */
export function openQuestionCount(questions: InviteQuestion[], reviewed: ReadonlySet<InviteQuestionId>): number {
  return questions.filter((q) => q.open && !reviewed.has(q.id)).length;
}
