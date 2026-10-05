// lib/meetings/report-gaps.ts
// What a report does when the transcript could not tell it something.
//
// A meeting with a bad line, a muffled speaker or a recording that cut out
// used to come back with a "Decisions" list holding one entry: "None could be
// confirmed from the available recording due to audio quality issues." That
// is not a decision, it went into the follow-up email as one, and it left the
// host nothing to act on. The host was in the room; they know what was
// decided. What they need is to be asked.
//
// So a report carries `open_questions`: the specific things only the host can
// settle, one question each. The page shows them, the host answers, and the
// answers go back through the correction path as authoritative. And whatever
// the model does, a disclaimer never stands where a decision should: it is
// dropped here, and if the model asked nothing in its place, the host is asked
// the one question that line was failing to ask.
//
// Pure: no model, no database.
import { normalizeNoteList } from "@/lib/meetings/live-notes";

/** On `analysis`: the questions the host must answer to complete the report. */
export const OPEN_QUESTIONS_KEY = "open_questions";

/**
 * What a model writes when it is admitting it could not hear rather than
 * reporting something that happened. Matched on the whole line so an actual
 * decision about audio ("Decided to buy new conference-room microphones")
 * is not mistaken for one.
 */
const DISCLAIMER = [
  /\b(?:none|nothing|no decisions?)\b.*\b(?:could|can)\s*(?:not|n't)?\s*be\s+(?:confirmed|determined|identified|verified|extracted)/i,
  /\b(?:could|can)\s*(?:not|n't)\s+be\s+(?:confirmed|determined|identified|verified|extracted)\b/i,
  /\bunable to (?:confirm|determine|identify|verify|extract)\b/i,
  /\b(?:audio|recording|sound)\s+quality\b/i,
  /\b(?:poor|bad|low[- ]quality|garbled|muffled|unclear)\s+(?:audio|recording|sound)\b/i,
  /\binaudible\b/i,
  /\btranscript\s+(?:was|is)\s+(?:incomplete|unclear|garbled|too short|insufficient)\b/i,
  /\bno (?:clear |explicit )?decisions? (?:were|was) (?:reached|made|recorded|captured)\b/i,
];

/** Whether a line is the model saying it could not hear, not something decided. */
export function isGapDisclaimer(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  return DISCLAIMER.some((re) => re.test(text));
}

/** Asked when a disclaimer was dropped and the model asked nothing in its place. */
export const FALLBACK_QUESTION =
  "What was decided in this meeting? The recording did not capture it clearly enough to list.";

export interface ReportGaps {
  /** The decisions, with every "could not be confirmed" line removed. */
  decisions: string[];
  /** What the host is asked, so the report can be completed from their answers. */
  openQuestions: string[];
}

/**
 * The decisions a report may state and the questions it must ask instead.
 *
 * A disclaimer in `decisions` is removed. If one was removed and the model
 * asked nothing, the host is asked what was decided, because the alternative
 * is a report that says nothing and asks nothing.
 */
export function reportGaps(raw: { decisions?: unknown; open_questions?: unknown }): ReportGaps {
  const listed = normalizeNoteList(raw.decisions);
  const decisions = listed.filter((d) => !isGapDisclaimer(d));
  const dropped = decisions.length < listed.length;
  const openQuestions = normalizeNoteList(raw.open_questions).filter((q) => !isGapDisclaimer(q) || /\?\s*$/.test(q));
  if (dropped && openQuestions.length === 0) openQuestions.push(FALLBACK_QUESTION);
  return { decisions, openQuestions };
}

/**
 * The host's answers, as the correction the regenerate route takes.
 *
 * "Q: … / A: …" pairs rather than bare answers: the model reading the
 * correction needs to know which gap each answer fills, and the history panel
 * shows the correction as the host wrote it. Unanswered questions are left
 * out; they are asked again on the next version if they still stand.
 */
export function answersAsCorrection(pairs: Array<{ question: string; answer: string }>): string {
  return pairs
    .map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() }))
    .filter(({ question, answer }) => question && answer)
    .map(({ question, answer }) => `Q: ${question}\nA: ${answer}`)
    .join("\n\n");
}
