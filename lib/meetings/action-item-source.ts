// lib/meetings/action-item-source.ts
// Where a report's action items come from, so that every report has some.
//
// The report asks the model for two things that should agree: an `action_items`
// list, and a follow-up email whose third section is "numbered action items with
// owners". They did not always agree. The email was the part the model wrote
// most carefully — it is prose, and it is what goes out — and the list was
// sometimes left empty. So the report said "No action items were captured" while
// the email below it listed four, the meeting log counted zero, no task was
// raised for anybody, and the commitments existed only in an email.
//
// The prompt now makes the list authoritative and the email a copy of it. This
// is the backstop for when the model still leaves it empty, and for every report
// written before it did: the list is read back out of the email's own "Action
// items" / "Next steps" section. Only that section, by its heading — a bulleted
// list of decisions above it is not a list of commitments.
//
// Pure: no database, no DOM.
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";

/** A heading line that introduces the email's commitments. */
const HEADING = /^\s*(?:\*\*|#+\s*)?(?:\d+[.)]\s*)?(?:action items?|next steps?|to-?dos?|follow-?ups?(?: items)?|owners? (?:and|&) (?:actions|next steps))\b[^\n]*:?\s*(?:\*\*)?\s*$/i;

/** A list line, with what follows the marker. */
const ITEM = /^\s*(?:\d+[.)]|[-•*])\s+(.+?)\s*$/;

/** Strip the light formatting a model or an editor puts on a line. */
function cleanItem(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)_(.+?)_(?=\s|$|[.,;:])/g, "$1$2")
    .replace(/\s+—\s+/g, ": ")
    .trim();
}

/**
 * The action items written into a follow-up email, in order.
 *
 * Reads the list under the first "Action items" / "Next steps" heading, up to
 * the first line that is neither a list item nor blank — the email's next
 * section. Empty when the email has no such section.
 */
export function actionItemsFromFollowUp(followUp: unknown): string[] {
  const lines = normalizeNoteText(followUp).split("\n");
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start === -1) return [];

  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // Blank lines inside the list are spacing, not its end; the next section's
    // first line of prose is.
    if (!line.trim()) continue;
    const match = ITEM.exec(line);
    if (!match) break;
    const item = cleanItem(match[1]);
    if (item) items.push(item);
  }
  return items;
}

/**
 * The action items a report should show: its own list, or, when that is empty,
 * the ones its follow-up email lists.
 */
export function reportActionItems(stored: unknown, analysis: Record<string, unknown> | null | undefined): string[] {
  const own = normalizeNoteList(stored);
  if (own.length) return own;
  return actionItemsFromFollowUp(analysis?.follow_up_draft);
}

/**
 * The action items to store with a freshly written report: never none.
 *
 * The model's list; else the follow-up's; else — a meeting that genuinely
 * settled nothing still leaves the host something to do — one item for the host
 * to close the meeting out, so the report, the log and the task list all carry
 * at least one commitment rather than none. Not applied to a report with no
 * summary: that is a failed analysis, and inventing a next step for it would
 * dress the failure up as a result.
 */
export function ensureActionItems(
  analysis: Record<string, unknown>,
  hostName: string | null | undefined,
): string[] {
  const items = reportActionItems(analysis.action_items, analysis);
  if (items.length) return items;
  if (!normalizeNoteText(analysis.summary)) return [];
  const owner = (hostName ?? "").trim() || "Host";
  return [`${owner}: Send the follow-up and confirm next steps with everyone in the meeting`];
}
