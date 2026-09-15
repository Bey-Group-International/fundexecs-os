// lib/meetings/report-analysis.ts
// Turning a meeting transcript into the structured report the log and the
// report page render.
//
// Extracted from app/api/meetings/report so it has two callers: the one that
// runs when a meeting ends, and the one that regenerates a report later from
// the transcript already on file. Duplicating a sixty-line prompt across those
// two is how they drift, and a regenerated report that does not match the
// original shape breaks the log — `decisions` in particular is read straight
// off `analysis` and exists in no other column.
import Anthropic from "@anthropic-ai/sdk";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";

/**
 * Model context / cost budget, in characters. The tail is kept: a meeting ends
 * where it decided things.
 *
 * Was 12,000 — around 3,000 tokens, or twenty minutes of speech. Every meeting
 * longer than that had most of itself silently thrown away before the model saw
 * a word of it, and the report then described the last twenty minutes as though
 * they were the whole conversation: an hour of context for a decision, cut, and
 * the decision summarised without it.
 *
 * 120,000 characters is roughly 30,000 tokens and covers something like two and
 * a half hours of talking, so in practice nothing is cut at all. It is a small
 * fraction of the model's context window and it is spent once per meeting.
 */
export const TRANSCRIPT_LIMIT = 120_000;

/** Prefixed to a transcript that had to be cut, so the model knows it is reading a fragment. */
export const TRUNCATION_NOTE =
  "[Earlier discussion omitted — this transcript begins partway through the meeting.]";

/**
 * Cut an over-long transcript down to the budget, from the front.
 *
 * Two things the old one-line slice got wrong, both of which the model then
 * repeated as fact:
 *
 *  - it cut mid-sentence, and usually mid-WORD, so the transcript opened on a
 *    fragment attributed to nobody — which reads exactly like a speaker whose
 *    name was not captured, and got summarised as one.
 *  - it said nothing about having cut. A model handed the last portion of a
 *    meeting with no marker will describe it as the meeting, and write a
 *    follow-up email that opens on whatever the transcript happens to start
 *    with.
 *
 * So the cut lands on a line boundary and announces itself. Idempotent: a
 * transcript already carrying the note and already inside the budget is handed
 * back untouched, because this runs on both the route and the analysis path.
 */
export function clampTranscript(transcript: string): string {
  const text = transcript ?? "";
  if (text.length <= TRANSCRIPT_LIMIT) return text;

  const budget = TRANSCRIPT_LIMIT - TRUNCATION_NOTE.length - 2;
  const tail = text.slice(-budget);
  // Drop the partial first line. `indexOf` rather than a split so a transcript
  // with no newline at all — one enormous unbroken line — still yields
  // something rather than nothing.
  const firstBreak = tail.indexOf("\n");
  const whole = firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
  return `${TRUNCATION_NOTE}\n${whole}`;
}

/**
 * The shape every report is stored in.
 *
 * Deliberately the same object for a first generation and a regeneration: the
 * log reads `analysis.decisions`, the export reads `analysis.next_meeting_suggestion`,
 * and a second writer producing a different set of keys would leave those
 * reading a record that no longer has what they need.
 */
export const MEETING_REPORT_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: { type: "string", description: "2-3 sentence meeting summary" },
    key_points: { type: "array", items: { type: "string" }, description: "Main discussion points" },
    action_items: {
      type: "array",
      items: { type: "string" },
      description: "Action items prefixed with owner name, e.g. 'Sarah: Send deck by Friday'",
    },
    decisions: { type: "array", items: { type: "string" }, description: "Key decisions reached" },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
    next_meeting_suggestion: {
      type: "string",
      description: "One sentence suggesting when to meet next and why, or empty string if not applicable",
    },
    follow_up_draft: {
      type: "string",
      description:
        "Complete follow-up email including: greeting, 1-paragraph summary, bullet list of decisions made, numbered action items with owners, next meeting proposal (if applicable), and professional sign-off. Use plain text, no markdown.",
    },
  },
  required: ["summary", "key_points", "action_items", "decisions", "sentiment", "next_meeting_suggestion", "follow_up_draft"],
};

const SYSTEM = `You are an expert meeting analyst for a venture-capital / investor-relations platform.
Produce comprehensive, actionable meeting reports. Transcript lines are prefixed "SpeakerName: text" — use speaker names when assigning action items.
For the follow_up_draft, write a ready-to-send professional email covering: (1) brief summary paragraph, (2) decisions made, (3) numbered action items with owners and deadlines where stated, (4) proposed next meeting if relevant, (5) professional closing. Plain text only.`;

/** What a report holds before it is written. Empty is a valid answer. */
export const EMPTY_REPORT: Record<string, unknown> = {
  summary: "",
  key_points: [],
  action_items: [],
};

export interface ReportAnalysisInput {
  title: string;
  participants: string[];
  transcript: string;
  /** Meeting length in seconds, if known. */
  durationSeconds?: number | null;
}

/**
 * Ask the model for a report.
 *
 * Returns the empty report rather than throwing when there is no client or the
 * model declines to use the tool: this runs at the moment a meeting ends, and
 * losing the whole request there would lose the transcript with it.
 *
 * The list fields are coerced because they are rendered as strings and turned
 * into team tasks, and a model answering a prompt about "action items with
 * owners" does not always return plain strings.
 */
export async function generateMeetingReport(
  client: Anthropic | null,
  model: string,
  input: ReportAnalysisInput,
): Promise<Record<string, unknown>> {
  if (!client) return { ...EMPTY_REPORT };

  const durationMin = input.durationSeconds ? Math.round(input.durationSeconds / 60) : null;

  const msg = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Meeting: ${input.title || "Untitled"}
Participants: ${input.participants.join(", ") || "Unknown"}
${durationMin ? `Duration: ~${durationMin} minutes` : ""}

FULL TRANSCRIPT:
${clampTranscript(input.transcript)}

Generate a comprehensive post-meeting report.`,
      },
    ],
    tools: [
      {
        name: "meeting_report",
        description: "Generate structured meeting report",
        input_schema: MEETING_REPORT_SCHEMA,
      },
    ],
    tool_choice: { type: "any" },
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return { ...EMPTY_REPORT };

  const raw = toolUse.input as Record<string, unknown>;
  return {
    ...raw,
    summary: normalizeNoteText(raw.summary),
    key_points: normalizeNoteList(raw.key_points),
    action_items: normalizeNoteList(raw.action_items),
    decisions: normalizeNoteList(raw.decisions),
  };
}
