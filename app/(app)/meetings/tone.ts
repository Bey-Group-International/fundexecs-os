import type { MeetingDisplayStatus, MeetingTimePhase } from "@/lib/meetings/schedule";

/**
 * The visual language of the Meetings section, defined once.
 *
 * Two build-time rules sit behind every value in this file. Both fail silently,
 * which is why the section drifted off-system in the first place.
 *
 * 1. An opacity modifier only works on a colour Tailwind can resolve while
 *    compiling. Written as an arbitrary value — bg-[var(--gold-400)] with a
 *    /10 — Tailwind cannot parse the var(), so it does not emit the rule AT
 *    ALL: no fill, no border colour, nothing. Every "soft" chip in this section
 *    was authored that way (52 of the app's 62 occurrences lived here), so all
 *    seven meeting statuses rendered as the same transparent pill behind the
 *    same grey hairline, and colour carried no information. Tinted fills and
 *    borders must therefore use Tailwind's own scale — `bg-gold-400/10`,
 *    `border-status-success/45` — which tailwind.config declares as
 *    `rgb(var(--fx-…) / <alpha-value>)` and which does accept a modifier.
 *
 * 2. The modifier itself must be a multiple of 5. Tailwind resolves it against
 *    its opacity scale, which runs 0-100 in steps of 5; a value off that scale
 *    (`/12`, `/8`) is not an error, it just never generates a rule. Use `/10`,
 *    or bracket it as `/[0.12]`.
 *
 * Solid text is the exception that needs neither rule: `text-[var(--status-…)]`
 * carries no modifier, so nothing can be dropped, and those CSS variables are
 * the deeper light-page-corrected hues (#12784A against the pastel #5FB87A on
 * Tailwind's scale). So: fills and borders from the Tailwind scale, text from
 * the CSS variables. Mixing the two is deliberate, not an oversight.
 */

/** One chip shape for the whole section — status, countdown, presence, counts. */
export const CHIP =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-[3px] font-mono text-[10px] font-medium uppercase leading-none tracking-[0.1em]";

export const TONE = {
  neutral: "border-line bg-surface-2 text-fg-muted",
  accent: "border-gold-400/30 bg-gold-400/10 text-[var(--gold-300)]",
  success: "border-status-success/45 bg-status-success/10 text-[var(--status-success)]",
  warning: "border-status-warning/45 bg-status-warning/10 text-[var(--status-warning)]",
  info: "border-status-info/40 bg-status-info/10 text-[var(--status-info)]",
  danger: "border-status-danger/40 bg-status-danger/10 text-[var(--status-danger)]",
} as const;

export type Tone = keyof typeof TONE;

export function chip(tone: Tone): string {
  return `${CHIP} ${TONE[tone]}`;
}

/**
 * Seven statuses, four tones. Colour carries the *class* of thing — this needs
 * you, this is fine, this is running — and the label carries the specific. Prep
 * Needed and Follow-Up Needed share a tone because they are the same fact at
 * two ends of a meeting: it is waiting on you.
 */
export const STATUS_TONE: Record<MeetingDisplayStatus, Tone> = {
  Scheduled: "accent",
  "Prep Needed": "warning",
  Ready: "success",
  Updated: "info",
  Live: "success",
  Completed: "neutral",
  "Follow-Up Needed": "warning",
};

export const COUNTDOWN_TONE: Record<MeetingTimePhase, Tone> = {
  upcoming: "neutral",
  imminent: "accent",
  in_progress: "success",
  ended: "neutral",
};

/** A meeting row / panel. `fx-card` is the app-wide card, so Meetings uses it. */
export const CARD = "fx-card";

/** Section eyebrow — the small mono label that titles a block. */
export const EYEBROW =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-secondary";
