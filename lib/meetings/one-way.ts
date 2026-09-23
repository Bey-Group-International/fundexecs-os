// lib/meetings/one-way.ts
// A call with nobody on the other end of the software.
//
// The product's meetings are rooms: two or more people, signalling, a waiting
// room, tiles. A one-way session is the same record of a conversation with all
// of that removed — somebody on a phone call, recording their side of it so
// there is a transcript and a report afterwards.
//
// It is deliberately the SAME KIND OF ROW as a meeting. The recording bucket
// is keyed `<meeting_id>/<recording_id>/…`, the Storage read policy resolves
// through `live_meetings`, and both the orphan sweep and the delete cleanup
// read that table. A separate table would have sat outside all of it and
// orphaned its own recordings the first time one was deleted — the exact
// failure that took a whole pass to fix for meetings.
//
// What is different is what the row MEANS, and this file holds that: how it is
// titled, what consent was acknowledged before it could start, what was being
// captured, and which lists it must stay out of.
//
// Pure: no React, no DOM, no Supabase.

/**
 * The `kind` of a live_meetings row.
 *
 * "meeting" is every row that existed before this, which is why it is the
 * column's default — a backfill that guessed would have been a backfill that
 * could be wrong about a meeting somebody held.
 */
export const MEETING_KIND = "meeting";
export const ONE_WAY_KIND = "one_way";

export type MeetingKind = typeof MEETING_KIND | typeof ONE_WAY_KIND;

/** Every kind the column may hold, for validating what a route was handed. */
export function isMeetingKind(value: unknown): value is MeetingKind {
  return value === MEETING_KIND || value === ONE_WAY_KIND;
}

/**
 * What can be captured.
 *
 * "microphone" is the phone on speaker beside the laptop, which is the case
 * this was built for. "computer" is a browser tab or the system's own output,
 * for a call taken on the machine itself — a softphone, a dial-in bridge, a
 * meeting in another product.
 */
export type CaptureSource = "microphone" | "computer";

/**
 * The microphone is not optional.
 *
 * Capturing only the computer's output records the far end and not the person
 * holding the call, which is a recording of half a conversation — and, in a
 * two-party-consent state, a recording of the ONLY party who did not agree to
 * it. The toggle in the UI adds the computer; it cannot take the mic away.
 */
export function captureSources(withComputerAudio: boolean): CaptureSource[] {
  return withComputerAudio ? ["microphone", "computer"] : ["microphone"];
}

/** What the recorder says it is capturing, in the words a person would use. */
export function captureLabel(sources: readonly CaptureSource[]): string {
  const hasMic = sources.includes("microphone");
  const hasComputer = sources.includes("computer");
  if (hasMic && hasComputer) return "Microphone and computer audio";
  if (hasComputer) return "Computer audio";
  if (hasMic) return "Microphone";
  return "Nothing";
}

/**
 * The consent a person acknowledged before recording could start.
 *
 * Stored with the session rather than held in a component, because the point
 * of it is to still exist months later when somebody asks whether a call
 * should have been recorded. An acknowledgement that lived only in React state
 * would answer that question with silence.
 */
export interface ConsentAcknowledgement {
  /** When they confirmed. */
  at: string;
  /** The exact words they were shown, kept because they can change later. */
  disclosure: string;
  /** What they were told would be captured. */
  sources: CaptureSource[];
}

/**
 * The sentence to read to the other party before recording starts.
 *
 * Deliberately one sentence, in plain words, naming the two things that make
 * consent meaningful: that it is being recorded, and who is doing it. A
 * paragraph of legal text is not read aloud, which makes it worse than a
 * sentence that is.
 *
 * This is not legal advice and the product does not pretend it is — consent
 * law varies by state and by country, and the acknowledgement stored alongside
 * says the person confirmed they had consent, not that this sentence obtained
 * it for them.
 */
export function disclosureScript(hostName: string, orgName?: string | null): string {
  const who = cleanName(hostName) || "I";
  const on = cleanName(orgName);
  const speaker = on ? `${who} at ${on}` : who;
  const verb = who === "I" ? "am" : "is";
  return `Before we start — ${speaker} ${verb} recording this call so there's an accurate record of what we agree. Is that all right with you?`;
}

/**
 * Whether recording may begin.
 *
 * Both halves are required and they are different questions: the box confirms
 * the person takes responsibility for having consent, and the disclosure being
 * non-empty is what makes the stored acknowledgement mean something later.
 * A consent record that says "they ticked a box" without saying what the box
 * claimed is not a record.
 */
export function mayStartRecording(input: {
  acknowledged: boolean;
  disclosure: string;
  sources: readonly CaptureSource[];
}): boolean {
  if (!input.acknowledged) return false;
  if (!input.disclosure.trim()) return false;
  return input.sources.includes("microphone");
}

/** The reason recording is unavailable, for the line under the button. */
export function blockedReason(input: {
  acknowledged: boolean;
  disclosure: string;
  sources: readonly CaptureSource[];
}): string | null {
  if (!input.sources.includes("microphone")) return "The microphone is required to record a call.";
  if (!input.disclosure.trim()) return "There is no disclosure to read.";
  if (!input.acknowledged) return "Confirm you have consent to record before starting.";
  return null;
}

/** The acknowledgement to store, once it has been given. */
export function acknowledgement(input: {
  disclosure: string;
  sources: readonly CaptureSource[];
  now?: Date;
}): ConsentAcknowledgement {
  return {
    at: (input.now ?? new Date()).toISOString(),
    disclosure: input.disclosure.trim(),
    sources: [...input.sources],
  };
}

/**
 * Read a stored acknowledgement back.
 *
 * Tolerant, because this is read on a report page months later and a row
 * written by an older version of this code must not throw the page away. What
 * it will not do is invent one: a row with nothing usable is null, and the
 * report says consent was not recorded rather than implying it was.
 */
export function readAcknowledgement(value: unknown): ConsentAcknowledgement | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const at = typeof row.at === "string" ? row.at.trim() : "";
  const disclosure = typeof row.disclosure === "string" ? row.disclosure.trim() : "";
  if (!at || !disclosure) return null;
  const sources = Array.isArray(row.sources)
    ? row.sources.filter((s): s is CaptureSource => s === "microphone" || s === "computer")
    : [];
  return { at, disclosure, sources };
}

/**
 * What to call a call nobody named.
 *
 * Dated and timed, because a list of twenty "Recorded call" rows is a list of
 * twenty identical rows. The time is what a person actually remembers a phone
 * call by.
 */
export function defaultCallTitle(now: Date = new Date()): string {
  const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Call · ${date}, ${time}`;
}

/** A title the person typed, or the dated default if they typed nothing. */
export function callTitle(typed: string | null | undefined, now: Date = new Date()): string {
  const clean = (typed ?? "").trim();
  return clean || defaultCallTitle(now);
}

/**
 * Whether a row belongs in the meeting lists.
 *
 * `/api/meetings/upcoming` lists anything not ended, and the calendar draws
 * every row with a scheduled_at. A one-way session is neither scheduled nor
 * attended, so without this it would appear in Upcoming forever — a meeting
 * the host can neither join nor cancel, because there is no room behind it.
 */
export function isOneWay(row: { kind?: string | null } | null | undefined): boolean {
  return (row?.kind ?? MEETING_KIND) === ONE_WAY_KIND;
}

/** Seconds as the clock a call is remembered by: 9:05, 1:02:11. */
export function callClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}

function cleanName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}
