// lib/meetings/scheduling.ts
// Calendly-style scheduling links: the pure logic behind a public booking page.
//
// A host publishes weekly working hours in their own timezone; each event type
// adds a duration and a slot granularity. Open slots are those working-hour
// windows, minus everything the host is already busy with, minus a buffer on
// both sides, no sooner than the minimum notice and no further out than the
// booking window. Every function here is deterministic and side-effect free so
// the same engine renders the public page, re-validates a booking server-side,
// and is unit-testable without a database.
import { localToIso } from "@/lib/meetings/schedule";

/** One weekly working-hours window, in the host's own timezone. */
export interface SchedulingAvailabilityRule {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** Local wall clock, "HH:mm". */
  start: string;
  end: string;
}

export interface BusyInterval {
  start: string; // ISO
  end: string; // ISO
}

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_LABELS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Weekdays 9–5: the default a new scheduling page starts from. */
export const DEFAULT_AVAILABILITY: SchedulingAvailabilityRule[] = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: "09:00",
  end: "17:00",
}));

export const DEFAULT_EVENT_TYPES = [
  { slug: "intro-15", title: "Intro call", description: "A quick introduction.", durationMinutes: 15 },
  { slug: "meeting-30", title: "30 minute meeting", description: null, durationMinutes: 30 },
] as const;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True when a string is a valid "HH:mm" 24-hour wall-clock time. */
export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function timeOfMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Coerce arbitrary JSON (a `scheduling_pages.availability` column, or a request
 * body) into well-formed rules. Anything malformed is dropped rather than
 * throwing — a corrupt row should show an empty calendar, not 500 the page.
 * Overlapping windows on the same day are merged so a slot can't be offered
 * twice.
 */
export function parseAvailability(value: unknown): SchedulingAvailabilityRule[] {
  if (!Array.isArray(value)) return [];
  const clean: SchedulingAvailabilityRule[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const day = Number(r.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!isValidTime(r.start) || !isValidTime(r.end)) continue;
    if (minutesOfDay(r.start) >= minutesOfDay(r.end)) continue;
    clean.push({ day, start: r.start, end: r.end });
  }
  return mergeAvailability(clean);
}

/** Merge overlapping/adjacent windows per weekday and sort the result. */
export function mergeAvailability(rules: SchedulingAvailabilityRule[]): SchedulingAvailabilityRule[] {
  const byDay = new Map<number, Array<[number, number]>>();
  for (const rule of rules) {
    const list = byDay.get(rule.day) ?? [];
    list.push([minutesOfDay(rule.start), minutesOfDay(rule.end)]);
    byDay.set(rule.day, list);
  }
  const merged: SchedulingAvailabilityRule[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const spans = byDay.get(day)!.sort((a, b) => a[0] - b[0]);
    let [curStart, curEnd] = spans[0];
    for (const [start, end] of spans.slice(1)) {
      if (start <= curEnd) {
        curEnd = Math.max(curEnd, end);
      } else {
        merged.push({ day, start: timeOfMinutes(curStart), end: timeOfMinutes(curEnd) });
        [curStart, curEnd] = [start, end];
      }
    }
    merged.push({ day, start: timeOfMinutes(curStart), end: timeOfMinutes(curEnd) });
  }
  return merged;
}

/**
 * Public handle for a booking page or event type. Lowercase, alphanumeric and
 * hyphens only, no leading/trailing/repeated hyphens. Returns "" when nothing
 * usable survives, which callers treat as "ask the user for a slug".
 */
export function normalizeSlug(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * A first-guess handle for a new page: the display name, falling back to the
 * local part of the email, falling back to a stable prefix of the user id.
 */
export function suggestSlug(opts: { displayName?: string | null; email?: string | null; userId: string }): string {
  return (
    normalizeSlug(opts.displayName ?? "") ||
    normalizeSlug((opts.email ?? "").split("@")[0] ?? "") ||
    `member-${opts.userId.replace(/-/g, "").slice(0, 8)}`
  );
}

/** Slugs that would collide with a real route under /book or read as a system page. */
export const RESERVED_SLUGS = new Set([
  "api", "admin", "app", "book", "booking", "login", "logout", "signup", "settings",
  "meetings", "meeting", "manage", "new", "edit", "cancel", "reschedule", "support",
  "fundexecs", "www", "static", "public",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

const TOKEN_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * The invitee's capability to manage their booking without an account. 32
 * chars of CSPRNG over a 32-symbol alphabet — 160 bits, unguessable, and free
 * of the character pairs people misread when a link is retyped.
 */
export function generateManageToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let token = "";
  for (const byte of bytes) token += TOKEN_CHARS[byte % TOKEN_CHARS.length];
  return token;
}

/**
 * The date and time shapes this module formats, each built at most once per
 * zone.
 *
 * Constructing an Intl.DateTimeFormat costs far more than formatting a date
 * with one, and every function below used to build a fresh one per call. The
 * public booking page pays that per slot and per render: grouping a 21-day
 * window built 336 formatters, and each keystroke in the invitee's name
 * rebuilt 60 more, because the picker re-renders along with the form it sits
 * above. Measured on a 336-slot window, the page cost 833 formatter
 * constructions to paint and 60 per keystroke; it now builds six in total.
 *
 * Safe to keep because a formatter is immutable and determined entirely by its
 * locale, its options and its zone — none of which depend on the instant being
 * formatted. lib/meetings/schedule.ts keeps its offset formatters for the same
 * reason.
 */
const SHAPES = {
  /** "2026-10-05". en-CA is already YYYY-MM-DD, which is the shape we store. */
  isoDate: { locale: "en-CA", options: { year: "numeric", month: "2-digit", day: "2-digit" } },
  /** "2:00 PM" — one slot button. */
  time: { locale: "en-US", options: { hour: "numeric", minute: "2-digit" } },
  /** "Monday, October 5" — the heading above a day's times. */
  longDate: { locale: "en-US", options: { weekday: "long", month: "long", day: "numeric" } },
  /** "Monday, October 5, 2026 at 2:00 PM GMT-4" — the one-line stamp. */
  full: {
    locale: "en-US",
    options: {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    },
  },
  /** "Mon" — the top line of a day in the picker's rail. */
  weekday: { locale: "en-US", options: { weekday: "short" } },
  /** "Oct 5" — the line under it. */
  dayMonth: { locale: "en-US", options: { day: "numeric", month: "short" } },
} satisfies Record<string, { locale: string; options: Intl.DateTimeFormatOptions }>;

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * One shape in one zone.
 *
 * Throws for a zone this runtime does not know, exactly as the constructor
 * does, and caches nothing in that case — so every caller keeps its own
 * plain-ISO fallback, and a bogus zone arriving from a browser cannot grow the
 * map. The map is otherwise bounded by the real IANA zones times six shapes.
 */
function zoned(shape: keyof typeof SHAPES, timezone: string): Intl.DateTimeFormat {
  const key = `${shape}\u0000${timezone}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const { locale, options } = SHAPES[shape];
  const dtf = new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone });
  formatters.set(key, dtf);
  return dtf;
}

/** The calendar date ("YYYY-MM-DD") an instant falls on in a given zone. */
export function dateInTimezone(instant: Date, timezone: string): string {
  try {
    return zoned("isoDate", timezone).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** Add whole days to a "YYYY-MM-DD" calendar date, staying DST-agnostic. */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a calendar date, independent of any timezone. */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Inclusive list of calendar dates from `start` to `end`, capped for safety. */
export function datesBetween(start: string, end: string, maxDays = 400): string[] {
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end && out.length < maxDays) {
    out.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return out;
}

export interface SlotWindow {
  /** ISO instant the slot starts. */
  start: string;
  /** ISO instant the slot ends (start + the event type's duration). */
  end: string;
}

/** Highest daily booking limit a host can set; the column's check matches. */
export const MAX_BOOKINGS_PER_DAY = 50;

export interface GenerateSlotsInput {
  /** Host's IANA timezone — the zone the availability rules are written in. */
  timezone: string;
  availability: SchedulingAvailabilityRule[];
  durationMinutes: number;
  /** Granularity of offered start times, e.g. 15 → :00, :15, :30, :45. */
  slotIntervalMinutes: number;
  /** Dead time kept clear either side of anything already booked. */
  bufferMinutes: number;
  /** Nothing bookable sooner than this from `now`. */
  minNoticeMinutes: number;
  /** Everything the host is already committed to, as ISO intervals. */
  busy: BusyInterval[];
  /**
   * Most bookings the host takes on one host-local day; null or absent for no
   * limit. A day that has reached it offers nothing more.
   */
  maxBookingsPerDay?: number | null;
  /** Start instants of the host's live bookings, counted against that limit. */
  bookingStarts?: string[];
  /** First and last calendar date (host-local) to consider, inclusive. */
  fromDate: string;
  toDate: string;
  now: Date;
}

/**
 * Every open slot in the window, ascending. Slots are generated in host-local
 * wall clock (so "09:00" stays 09:00 across a DST change) and returned as
 * absolute instants, which is what both the invitee's browser and the database
 * want.
 */
export function generateSlots(input: GenerateSlotsInput): SlotWindow[] {
  const duration = Math.max(5, Math.trunc(input.durationMinutes));
  const interval = Math.max(5, Math.trunc(input.slotIntervalMinutes));
  const buffer = Math.max(0, Math.trunc(input.bufferMinutes));
  const durationMs = duration * 60_000;
  const bufferMs = buffer * 60_000;
  const earliest = input.now.getTime() + Math.max(0, input.minNoticeMinutes) * 60_000;

  // Pre-resolve busy intervals to epoch ms once, rather than per candidate slot.
  const busy = input.busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .sort((a, b) => a.start - b.start);

  // Live bookings per host-local date, only when a daily limit is in force.
  const limit = input.maxBookingsPerDay && input.maxBookingsPerDay > 0 ? Math.trunc(input.maxBookingsPerDay) : null;
  const bookedPerDay = new Map<string, number>();
  if (limit !== null) {
    for (const iso of input.bookingStarts ?? []) {
      const at = new Date(iso);
      if (isNaN(at.getTime())) continue;
      const day = dateInTimezone(at, input.timezone);
      bookedPerDay.set(day, (bookedPerDay.get(day) ?? 0) + 1);
    }
  }

  const byDay = new Map<number, SchedulingAvailabilityRule[]>();
  for (const rule of input.availability) {
    byDay.set(rule.day, [...(byDay.get(rule.day) ?? []), rule]);
  }

  const slots: SlotWindow[] = [];
  const seen = new Set<number>();

  for (const date of datesBetween(input.fromDate, input.toDate)) {
    const rules = byDay.get(weekdayOfDate(date));
    if (!rules) continue;
    if (limit !== null && (bookedPerDay.get(date) ?? 0) >= limit) continue;

    for (const rule of rules) {
      const windowStart = minutesOfDay(rule.start);
      const windowEnd = minutesOfDay(rule.end);
      // Only offer starts that leave room for the whole meeting inside the window.
      for (let minute = windowStart; minute + duration <= windowEnd; minute += interval) {
        const startMs = new Date(localToIso(date, timeOfMinutes(minute), input.timezone)).getTime();
        if (!Number.isFinite(startMs)) continue;
        const endMs = startMs + durationMs;
        if (startMs < earliest) continue;
        // A DST jump can map two wall-clock times onto the same instant.
        if (seen.has(startMs)) continue;

        const blocked = busy.some((b) => startMs - bufferMs < b.end && endMs + bufferMs > b.start);
        if (blocked) continue;

        seen.add(startMs);
        slots.push({ start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() });
      }
    }
  }

  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Whether a specific instant is one of the offered slots. The booking routes
 * re-run this server-side: the public page's slot list is a suggestion, and a
 * request naming any other time — stale, hand-crafted, or racing another
 * booking — must be rejected.
 */
export function isSlotAvailable(startIso: string, input: Omit<GenerateSlotsInput, "fromDate" | "toDate">): boolean {
  const start = new Date(startIso);
  if (isNaN(start.getTime())) return false;
  // Generate the day either side too: a slot near midnight in the host's zone
  // can belong to the previous or next host-local date.
  const date = dateInTimezone(start, input.timezone);
  const slots = generateSlots({
    ...input,
    fromDate: addCalendarDays(date, -1),
    toDate: addCalendarDays(date, 1),
  });
  return slots.some((s) => new Date(s.start).getTime() === start.getTime());
}

/**
 * The date range a page offers: from today (host-local) through the booking
 * window, intersected with any explicit range the caller asked for.
 */
export function bookingWindowRange(opts: {
  now: Date;
  timezone: string;
  bookingWindowDays: number;
  fromDate?: string | null;
  toDate?: string | null;
}): { fromDate: string; toDate: string } {
  const today = dateInTimezone(opts.now, opts.timezone);
  const windowEnd = addCalendarDays(today, Math.max(1, Math.trunc(opts.bookingWindowDays)));
  const fromDate = opts.fromDate && opts.fromDate > today ? opts.fromDate : today;
  const toDate = opts.toDate && opts.toDate < windowEnd ? opts.toDate : windowEnd;
  return { fromDate, toDate: toDate < fromDate ? fromDate : toDate };
}

/** Group slots by calendar date in the viewer's zone, for the day-by-day picker. */
export function groupSlotsByDate(slots: SlotWindow[], timezone: string): Array<{ date: string; slots: SlotWindow[] }> {
  const groups = new Map<string, SlotWindow[]>();
  for (const slot of slots) {
    const key = dateInTimezone(new Date(slot.start), timezone);
    // Push rather than rebuild the bucket: copying it per slot made grouping
    // quadratic in the size of the biggest day, which is the whole list when a
    // host opens a single long day.
    const bucket = groups.get(key);
    if (bucket) bucket.push(slot);
    else groups.set(key, [slot]);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, s]) => ({ date, slots: s }));
}

/**
 * Whether a string is an IANA zone this runtime actually knows. Guards the one
 * place a timezone arrives from the browser: a page stored with a bogus zone
 * would silently generate every slot in UTC.
 */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The viewer's own timezone, with a safe fallback where Intl is unavailable. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function formatSlotTime(iso: string, timezone: string): string {
  try {
    return zoned("time", timezone).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

export function formatSlotDate(iso: string, timezone: string): string {
  try {
    return zoned("longDate", timezone).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

/** "Mon" — the weekday the picker's day rail labels a column with. */
export function formatSlotWeekday(iso: string, timezone: string): string {
  try {
    return zoned("weekday", timezone).format(new Date(iso));
  } catch {
    return DAY_LABELS_SHORT[new Date(iso).getUTCDay()] ?? "";
  }
}

/** "Oct 5" — the date under it. */
export function formatSlotDayMonth(iso: string, timezone: string): string {
  try {
    return zoned("dayMonth", timezone).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

/** "Thursday, March 5, 2026 at 2:00 PM GMT+1" — the one-line stamp emails use. */
export function formatSlotFull(iso: string, timezone: string): string {
  try {
    return zoned("full", timezone).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

export interface BookingValidation {
  name?: string;
  email?: string;
  notes?: string;
  guests?: string;
  slot?: string;
}

/**
 * Ceilings on what the public booking form accepts. The form is open to anyone,
 * and every one of these fields is copied into the meeting title or
 * description, both confirmation emails and the calendar invite — without a cap
 * a single rate-limited request could store and send megabytes. 254 is the
 * longest address SMTP allows.
 */
export const BOOKING_NAME_MAX = 200;
export const BOOKING_EMAIL_MAX = 254;
export const BOOKING_NOTES_MAX = 2000;
/** Longest cancellation or decline reason kept and emailed. */
export const BOOKING_REASON_MAX = 1000;
/** Most extra people an invitee can bring; the column's check matches. */
export const BOOKING_GUESTS_MAX = 10;

/**
 * The extra guests an invitee added, as stored: lowercased, deduplicated, the
 * invitee's own address dropped. Accepts a list or one comma/semicolon/space
 * separated string, since that is what people paste.
 *
 * Every address here receives the meeting's emails, so an invalid one is an
 * error rather than something to drop quietly: better the invitee fixes a
 * typo than a colleague never hears about the meeting.
 */
export function parseBookingGuests(
  raw: unknown,
  inviteeEmail: string,
): { guests: string[] } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { guests: [] };
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : null;
  if (!parts) return { error: "List guests as email addresses." };

  const self = inviteeEmail.trim().toLowerCase();
  const seen = new Set<string>();
  const guests: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") return { error: "List guests as email addresses." };
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (email.length > BOOKING_EMAIL_MAX || !EMAIL_RE.test(email) || CONTROL_CHARS.test(email)) {
      return { error: `"${email.slice(0, 60)}" isn't a valid email address.` };
    }
    if (email === self || seen.has(email)) continue;
    seen.add(email);
    guests.push(email);
  }
  if (guests.length > BOOKING_GUESTS_MAX) return { error: `Add up to ${BOOKING_GUESTS_MAX} guests.` };
  return { guests };
}

/**
 * A cancellation or decline reason as it is stored and emailed: text only,
 * trimmed, capped, and null when there is nothing to say.
 *
 * The invitee's side comes from an anonymous request body, so it can be
 * anything JSON can carry. A number there used to throw on `.trim()` halfway
 * through a cancel, after the meeting room was already deleted, leaving a
 * booking still "confirmed" with no room behind it.
 */
export function normalizeBookingReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().slice(0, BOOKING_REASON_MAX).trim();
  return text || null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A line ending here becomes a header break downstream: the name reaches the
// host's subject line, and the email reaches a To. lib/email-headers.ts makes
// that harmless on the wire, but a booking is also stored and rendered in the
// app, and a name is not a place for a control character under any reading.
// Rejecting says so plainly instead of silently keeping a mangled name.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/** Field-level validation for the public booking form. */
export function validateBookingRequest(input: {
  name?: string | null;
  email?: string | null;
  notes?: string | null;
  startIso?: string | null;
}): BookingValidation {
  const errors: BookingValidation = {};
  const name = input.name ?? "";
  if (!name.trim()) errors.name = "Your name is required.";
  else if (CONTROL_CHARS.test(name)) errors.name = "Your name can't contain line breaks.";
  else if (name.trim().length > BOOKING_NAME_MAX) errors.name = `Keep your name under ${BOOKING_NAME_MAX} characters.`;

  const email = input.email?.trim() ?? "";
  if (!email) errors.email = "Your email is required.";
  // EMAIL_RE rejects whitespace but not the other control characters, and a
  // valid address contains none of them.
  else if (email.length > BOOKING_EMAIL_MAX || !EMAIL_RE.test(email) || CONTROL_CHARS.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if ((input.notes?.trim().length ?? 0) > BOOKING_NOTES_MAX) {
    errors.notes = `Keep this under ${BOOKING_NOTES_MAX} characters.`;
  }

  if (!input.startIso || isNaN(new Date(input.startIso).getTime())) errors.slot = "Pick a time.";
  return errors;
}

/** Who is booking, when a link already knows: a name and email to start the form with. */
export interface BookingPrefill {
  name?: string;
  email?: string;
}

function firstParam(value: unknown): string {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === "string" ? one : "";
}

/**
 * The `?name=&email=` a booking link can carry, as safe starting values for the
 * form: trimmed, capped, and dropped when they could never be submitted.
 *
 * This only fills in fields the visitor can see and change before booking; the
 * server validates the submission as it always did. It is what lets a declined
 * invitee pick another time without typing themselves in again, and lets a
 * host send a link that already knows who it is for.
 */
export function parseBookingPrefill(params: Record<string, unknown> | null | undefined): BookingPrefill {
  const prefill: BookingPrefill = {};
  const name = firstParam(params?.name).trim();
  if (name && name.length <= BOOKING_NAME_MAX && !CONTROL_CHARS.test(name)) prefill.name = name;
  const email = firstParam(params?.email).trim();
  if (email && email.length <= BOOKING_EMAIL_MAX && EMAIL_RE.test(email) && !CONTROL_CHARS.test(email)) {
    prefill.email = email;
  }
  return prefill;
}

/** The query string that carries a prefill, "" when there is nothing to carry. */
export function bookingPrefillQuery(prefill: BookingPrefill | null | undefined): string {
  const params = new URLSearchParams();
  if (prefill?.name) params.set("name", prefill.name);
  if (prefill?.email) params.set("email", prefill.email);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Public URL of a booking page, or of one event type on it, optionally knowing who is booking. */
export function buildBookingPageUrl(
  origin: string,
  slug: string,
  eventSlug?: string,
  prefill?: BookingPrefill | null,
): string {
  const base = `${origin.replace(/\/$/, "")}/book/${slug}`;
  return `${eventSlug ? `${base}/${eventSlug}` : base}${bookingPrefillQuery(prefill)}`;
}

/** The invitee's cancel/reschedule link for a booking. */
export function buildBookingManageUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/booking/${token}`;
}

/**
 * The "Save to calendar" URL for a booking: a one-event .ics, served off the
 * same manage token the invitee was already emailed.
 *
 * The token, not the booking id: the id is unguessable in practice but it is a
 * database key, not a credential anybody was handed, and the manage token is
 * what this product already treats as the whole capability for one booking.
 * Reusing it grants the holder nothing they did not already have.
 */
export function buildBookingCalendarUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/api/scheduling/booking/${token}/calendar.ics`;
}
