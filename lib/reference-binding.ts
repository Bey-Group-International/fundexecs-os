// Reference binding — decide whether a follow-up workflow in a session refers
// to the session's EXISTING deal/asset (and should update it in place) or is a
// genuinely new record. Pure and deterministic so the decision holds in
// fallback mode (no API key) and is unit-testable in isolation.
//
// The engine (lib/engine.ts) seeds a deal/asset from each completed workflow.
// The first workflow in a session creates the record; a follow-up like "update
// the deal" or "revise the model" clearly means the same record — but without a
// binding rule the engine would mint a duplicate. shouldReuseRecord supplies the
// conservative cue test the engine uses to bind instead.

// Reference cues that point back at the session's existing record. Conservative
// on purpose: a noun-anchored phrase ("the deal", "our model").
const REFERENCE_PHRASE =
  /\b(the|this|that|our|same)\s+(deal|asset|model|company|target|investment|acquisition|property|fund|opportunity)\b/i;

// Standalone cues: an edit/continuation verb or pronoun that only makes sense
// against an existing record. "it" is matched as a whole word so it can't fire
// on a substring (e.g. "items").
const CONTINUATION_CUE = /\b(update|revise|amend|adjust|refine|tweak|the above|it)\b/i;

/** Normalize for loose, case-insensitive name comparison. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Decide whether a follow-up workflow should REUSE (update in place) the
 * session's existing deal/asset rather than create a new one.
 *
 * Reuse when EITHER:
 *  - the prompt carries a reference cue (a noun-anchored phrase like "the deal"
 *    / "our model", or a continuation verb/pronoun like "update"/"revise"/"it"
 *    /"the above"), OR
 *  - the extracted name closely matches the existing record's name
 *    (case-insensitive equality, or one name contains the other).
 *
 * Otherwise create a new record — the operator means a genuinely different one.
 * Returns false when there is no existing record to bind to.
 */
export function shouldReuseRecord(args: {
  promptText: string;
  existingName?: string | null;
  extractedName?: string | null;
}): boolean {
  const existingName = args.existingName ?? "";
  // Nothing to bind to — never reuse.
  if (!existingName.trim()) return false;

  const prompt = args.promptText ?? "";
  if (REFERENCE_PHRASE.test(prompt) || CONTINUATION_CUE.test(prompt)) return true;

  // Name match: equality or containment (case-insensitive), guarding against an
  // empty extracted name matching everything.
  const a = norm(existingName);
  const b = norm(args.extractedName ?? "");
  if (b && a && (a === b || a.includes(b) || b.includes(a))) return true;

  return false;
}
