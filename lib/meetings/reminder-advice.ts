// lib/meetings/reminder-advice.ts
// What reminder a meeting should get, and why.
//
// The schedule screen used to offer a flat list ("5 minutes before" … "1 day
// before") with 15 minutes preselected for everything — a board meeting with
// forty pages of pre-read and a ten-minute internal sync got the same nudge.
// This reads the meeting itself — its kind, its guests, how long it runs, and
// how far off it is — and recommends one, with the reasons in plain words so
// the host can disagree knowingly.
//
// Pure: no React, no network. `now` is a parameter so the timing rules are
// testable.

import { zonedDateTime } from "@/lib/meetings/schedule";

/** Every lead time the schedule screen offers, longest last. `null` = none. */
export const REMINDER_CHOICES: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 5, label: "5 minutes before" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 2880, label: "2 days before" },
];

export function reminderLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "No reminder";
  return REMINDER_CHOICES.find((c) => c.minutes === minutes)?.label ?? `${minutes} minutes before`;
}

/** How much it matters that people actually show up, as the host sees it. */
export type Stakes = "routine" | "important" | "critical";

export interface ReminderContext {
  meetingType: string;
  /** The meeting's start, or null until a whole date and time exist. */
  startIso: string | null;
  durationMinutes: number;
  timezone: string;
  /** Everyone on the guest list with an address, host excluded. */
  guestCount: number;
  externalCount: number;
  /** Guests for whom the start lands outside their working hours. */
  offHoursGuests: number;
  /** One of a repeating series. */
  repeating: boolean;
  /** The host listed preparation, or attached an agenda to read. */
  hasPrep: boolean;
  /** The host's own answer. Absent: inferred from the meeting type. */
  stakes?: Stakes;
  /** The host's own answer to "do people need to prepare?". Absent: inferred. */
  needsPrep?: boolean;
  now?: Date;
}

export interface Signal {
  label: string;
  value: string;
}

export interface ReminderAdvice {
  /** The recommended lead in minutes, or null for "no reminder". */
  minutes: number | null;
  /** Why, most important first. */
  reasons: string[];
  /** Things the host should know that are not reasons: limits, trade-offs. */
  cautions: string[];
  /** Other sensible picks, nearest to the recommendation first. */
  alternatives: Array<{ minutes: number | null; label: string; why: string }>;
  /** What was read from the meeting, for the wizard to show back. */
  context: Signal[];
  timing: Signal[];
}

const HEAVY_TYPES = new Set(["board_meeting", "lp_review", "diligence"]);
const EXTERNAL_TYPES = new Set(["investor_update", "external_pitch", "advisory", "deal_review"]);

const STEPS = REMINDER_CHOICES.map((c) => c.minutes);

/** The next standard lead above `minutes`, or the largest when none is. */
function stepUp(minutes: number): number {
  return STEPS.find((s) => s > minutes) ?? STEPS[STEPS.length - 1];
}

/** The largest standard lead that is strictly shorter than `limit`, or null. */
function largestBelow(limit: number): number | null {
  const fits = STEPS.filter((s) => s < limit);
  return fits.length ? fits[fits.length - 1] : null;
}

function describeLead(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

function typeLabel(type: string): string {
  return type.replace(/_/g, " ");
}

export function adviseReminder(ctx: ReminderContext): ReminderAdvice {
  const now = ctx.now ?? new Date();
  const reasons: string[] = [];
  const cautions: string[] = [];

  // ── Context: what kind of meeting, and who is in it ─────────────────────
  const heavy = HEAVY_TYPES.has(ctx.meetingType);
  const outward = EXTERNAL_TYPES.has(ctx.meetingType);
  const needsPrep = ctx.needsPrep ?? (heavy || ctx.hasPrep);
  const stakes: Stakes = ctx.stakes ?? (heavy ? "critical" : outward || ctx.externalCount > 0 ? "important" : "routine");

  let minutes: number;
  if (stakes === "critical") {
    minutes = 1440;
    reasons.push(
      heavy
        ? `A ${typeLabel(ctx.meetingType)} is one people prepare for, so the reminder should land the day before.`
        : "You marked attendance as critical, so the reminder should land the day before.",
    );
  } else if (stakes === "important") {
    minutes = 120;
    reasons.push(
      ctx.externalCount > 0
        ? "Outside guests don't share your calendar habits — an email a couple of hours ahead is what gets them there."
        : "Attendance matters here, so give people a couple of hours' notice rather than a last-minute ping.",
    );
  } else {
    minutes = 15;
    reasons.push("A routine meeting with a teammate or two only needs a short nudge before it starts.");
  }

  if (needsPrep && minutes < 1440) {
    minutes = 1440;
    reasons.push("People need to prepare, so the reminder goes the day before while there is still time to do it.");
  }

  // ── Scope: how many people, how long, how often ─────────────────────────
  if (ctx.guestCount >= 8 && minutes < 1440) {
    const bumped = stepUp(minutes);
    if (bumped !== minutes) {
      minutes = bumped;
      reasons.push(`With ${ctx.guestCount} guests, someone is always travelling — more notice means fewer late joins.`);
    }
  }
  if (ctx.durationMinutes >= 120 && minutes < 60) {
    minutes = 60;
    reasons.push("It runs two hours or more, so people need time to clear the slot, not just open a link.");
  }
  if (ctx.offHoursGuests > 0 && minutes < 1440) {
    minutes = 1440;
    reasons.push(
      `${ctx.offHoursGuests} guest${ctx.offHoursGuests === 1 ? " is" : "s are"} being asked outside working hours — a day's notice lets them plan for it.`,
    );
  }
  if (ctx.repeating && minutes > 60) {
    // The invitation already sits in everyone's calendar for every occurrence.
    minutes = 60;
    reasons.push("It repeats, and the series is already in everyone's calendar — a shorter reminder is enough.");
  }
  if (ctx.guestCount === 0) {
    minutes = Math.min(minutes, 15);
    reasons.length = 0;
    reasons.push("Nobody else is invited yet, so this only reaches you through your own calendar.");
    cautions.push("Reminder emails go to guests. Add guests and this recommendation will be re-worked.");
  }

  // ── Timing: how far off the meeting is ──────────────────────────────────
  const timing: Signal[] = [];
  let startMs: number | null = null;
  if (ctx.startIso) {
    const t = new Date(ctx.startIso).getTime();
    if (Number.isFinite(t)) startMs = t;
  }

  let none = false;
  if (startMs === null) {
    timing.push({ label: "Starts", value: "Pick a date and time first" });
    cautions.push("There is no start time yet, so timing rules aren't applied.");
  } else {
    const untilMs = startMs - now.getTime();
    timing.push({ label: "Starts in", value: untilMs <= 0 ? "Already started" : describeLead(untilMs) });

    if (untilMs <= 15 * 60_000) {
      none = true;
      reasons.length = 0;
      reasons.push(
        untilMs <= 0
          ? "That time has already passed, so there is nothing to remind anyone about."
          : "It starts within 15 minutes — the invitation itself is the notice, and a reminder would arrive with it.",
      );
    } else if (untilMs <= minutes * 60_000) {
      const fit = largestBelow(untilMs / 60_000);
      if (fit === null) {
        none = true;
        reasons.length = 0;
        reasons.push("It starts too soon for a reminder to arrive before the invitation does.");
      } else {
        reasons.push(
          `The meeting is only ${describeLead(untilMs)} away, so ${reminderLabel(minutes).toLowerCase()} has already passed — shortened to fit.`,
        );
        minutes = fit;
      }
    }

    if (!none) {
      const local = zonedDateTime(new Date(startMs), ctx.timezone);
      const hour = Number(local.time.slice(0, 2));
      const weekday = new Date(`${local.date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
      timing.push({ label: "Local start", value: `${local.time} (${ctx.timezone})` });

      // Only while a day-before reminder can still be sent: for a meeting less
      // than a day away that lead has passed, and recommending it would hand
      // back a reminder in the past.
      if (hour < 9 && minutes < 1440 && untilMs > 1440 * 60_000) {
        minutes = 1440;
        reasons.push(
          "It starts before 9am, when a reminder an hour or two ahead would arrive overnight — so it goes the day before.",
        );
      }
      if (weekday === 1 && hour >= 9 && minutes >= 1440 && needsPrep) {
        cautions.push("A day-before reminder for a Monday meeting arrives on Sunday. Prep is needed, so it is kept — send your pre-read on Friday as well.");
      } else if (weekday === 1 && hour >= 9 && minutes >= 1440) {
        // A day-before reminder for a Monday meeting is a Sunday email. Left
        // alone before 9am, where the alternative is an overnight one.
        minutes = 120;
        cautions.push("A day-before reminder for a Monday meeting would arrive on Sunday, so it was set to 2 hours before.");
      }
      if (untilMs > 14 * 24 * 3600_000) {
        cautions.push("It is more than two weeks away. Reminders only go out within two weeks of the start, so nothing is sent until then.");
      }
    }
  }

  if (!none && minutes < 60) {
    // Reminders are swept hourly (see reminder.ts REMINDER_SWEEP_LOOKAHEAD_MS):
    // a short lead can be sent up to an hour before its lead time.
    cautions.push(
      "Reminder emails go out in an hourly sweep, so a lead under an hour can arrive up to an hour before its lead time.",
    );
  }

  const chosen: number | null = none ? null : minutes;

  // ── Alternatives ────────────────────────────────────────────────────────
  const alternatives: ReminderAdvice["alternatives"] = [];
  const addAlt = (m: number | null, why: string) => {
    if (m === chosen || alternatives.some((a) => a.minutes === m)) return;
    if (m !== null && startMs !== null && startMs - now.getTime() <= m * 60_000) return;
    alternatives.push({ minutes: m, label: reminderLabel(m), why });
  };
  if (chosen === null) {
    const soon = startMs !== null ? largestBelow((startMs - now.getTime()) / 60_000) : null;
    if (soon !== null) addAlt(soon, "Still fits before the start.");
  } else {
    if (chosen >= 1440) {
      addAlt(120, "A same-day nudge instead of a day's notice.");
      addAlt(60, "Just before — for a meeting people already have in their diary.");
    } else if (chosen >= 60) {
      addAlt(1440, "Earlier, so people can prepare or rearrange.");
      addAlt(15, "A shorter nudge, if people are already expecting it.");
    } else {
      addAlt(60, "A little more notice.");
      addAlt(1440, "The day before, if it needs preparation.");
    }
    addAlt(null, "No email reminder. The invitation is the only notice.");
  }

  const context: Signal[] = [
    { label: "Meeting", value: typeLabel(ctx.meetingType) },
    {
      label: "Guests",
      value:
        ctx.guestCount === 0
          ? "None yet"
          : `${ctx.guestCount}${ctx.externalCount ? ` (${ctx.externalCount} external)` : ""}`,
    },
    { label: "Length", value: `${ctx.durationMinutes} min` },
  ];
  if (ctx.repeating) context.push({ label: "Repeats", value: "Yes" });
  if (ctx.offHoursGuests > 0) context.push({ label: "Outside hours", value: `${ctx.offHoursGuests} guest${ctx.offHoursGuests === 1 ? "" : "s"}` });
  context.push({ label: "Needs prep", value: needsPrep ? "Yes" : "No" });

  return { minutes: chosen, reasons, cautions, alternatives, context, timing };
}
