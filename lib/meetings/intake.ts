// lib/meetings/intake.ts
// The questions a meeting type asks the person booking it — "Which fund?",
// "What would you like to cover?" — and the answers they give.
//
// The questions are the host's, stored on the event type. The answers are
// folded into the booking's notes as plain "Question: answer" lines, so they
// travel everywhere the notes already go without a second column to keep in
// step: the meeting's description, the host's emails and bookings list, the
// calendar entry, and the brief the AI reads when it writes the report.
//
// Everything is read through here, because the questions are JSON the host
// wrote and the answers are text from an anonymous visitor.
//
// Pure: no React, no Supabase.

export type IntakeKind = "short" | "long" | "choice";

export interface IntakeQuestion {
  /** Stable within the meeting type, so an answer is tied to its question. */
  id: string;
  label: string;
  kind: IntakeKind;
  /** The choices, for a "choice" question; empty otherwise. */
  options: string[];
  required: boolean;
}

/** A meeting type asks at most this many: a booking page is not a survey. */
export const INTAKE_MAX_QUESTIONS = 5;
export const INTAKE_LABEL_MAX = 120;
export const INTAKE_OPTION_MAX = 80;
export const INTAKE_MAX_OPTIONS = 8;
export const INTAKE_SHORT_MAX = 200;
export const INTAKE_LONG_MAX = 1000;

const KINDS: readonly IntakeKind[] = ["short", "long", "choice"];

function oneLine(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A short id from a label, for a question the host has just written. */
export function intakeIdFor(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "q";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The questions, however they were stored.
 *
 * Drops anything without a label, keeps only a choice question's non-empty,
 * distinct options (a choice with fewer than two is asked as a short answer
 * instead), makes ids unique, and caps the list.
 */
export function normalizeIntakeQuestions(raw: unknown): IntakeQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: IntakeQuestion[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const label = oneLine(o.label, INTAKE_LABEL_MAX);
    if (!label) continue;
    let kind: IntakeKind = KINDS.includes(o.kind as IntakeKind) ? (o.kind as IntakeKind) : "short";
    let options: string[] = [];
    if (kind === "choice") {
      const seen = new Set<string>();
      for (const opt of Array.isArray(o.options) ? o.options : []) {
        const text = oneLine(opt, INTAKE_OPTION_MAX);
        if (!text || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        options.push(text);
        if (options.length >= INTAKE_MAX_OPTIONS) break;
      }
      if (options.length < 2) {
        kind = "short";
        options = [];
      }
    }
    const wanted = oneLine(o.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, "");
    const id = wanted && !ids.has(wanted) ? wanted : intakeIdFor(label, ids);
    ids.add(id);
    out.push({ id, label, kind, options, required: o.required === true });
    if (out.length >= INTAKE_MAX_QUESTIONS) break;
  }
  return out;
}

export interface IntakeAnswer {
  label: string;
  answer: string;
}

/**
 * Check what a visitor sent against the questions.
 *
 * Answers are keyed by question id. A required question left blank, a choice
 * that is not one of the options, or an answer over its length is an error
 * keyed by that id; unknown ids are ignored. The answers come back in the
 * order the questions are asked, blanks left out.
 */
export function validateIntakeAnswers(
  questions: readonly IntakeQuestion[],
  raw: unknown,
): { answers: IntakeAnswer[]; errors: Record<string, string> } {
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: IntakeAnswer[] = [];
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const value = given[q.id];
    const text =
      typeof value === "string"
        ? q.kind === "long"
          ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim()
          : oneLine(value, Number.MAX_SAFE_INTEGER)
        : "";
    if (!text) {
      if (q.required) errors[q.id] = "Please answer this.";
      continue;
    }
    const max = q.kind === "long" ? INTAKE_LONG_MAX : INTAKE_SHORT_MAX;
    if (text.length > max) {
      errors[q.id] = `Keep this under ${max} characters.`;
      continue;
    }
    if (q.kind === "choice") {
      const match = q.options.find((o) => o.toLowerCase() === text.toLowerCase());
      if (!match) {
        errors[q.id] = "Pick one of the options.";
        continue;
      }
      answers.push({ label: q.label, answer: match });
      continue;
    }
    answers.push({ label: q.label, answer: text });
  }
  return { answers, errors };
}

/**
 * The booking's notes with the answers in front of them.
 *
 * "Question: answer" a line each, a blank line, then whatever the visitor
 * typed in the free notes box. A multi-line answer keeps its lines, indented
 * under its question so it still reads as one answer.
 */
export function notesWithIntake(answers: readonly IntakeAnswer[], notes: string | null | undefined): string | null {
  const free = (notes ?? "").trim();
  const lines = answers.map(({ label, answer }) => {
    const [first, ...rest] = answer.split("\n");
    const q = /[?:]$/.test(label) ? label : `${label}:`;
    return [`${q} ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
  });
  const body = [lines.join("\n"), free].filter(Boolean).join("\n\n");
  return body || null;
}
