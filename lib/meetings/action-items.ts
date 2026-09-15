// lib/meetings/action-items.ts
// Reading the owner out of an action item.
//
// The report prompt asks for items "prefixed with owner name, e.g. 'Sarah: Send
// deck by Friday'", and the model obliges. Then every one of those became a
// task assigned to whoever ended the meeting — so the host collected a list of
// other people's commitments, and Sarah was never told about hers.
//
// Pure, because the cost of getting this wrong is a task filed against the
// wrong colleague. The matching rule is the same one the invitation path
// uses: unique or nothing.

/** An action item split into who it is for and what it is. */
export interface ParsedActionItem {
  /** The name written in front of the item, when the prefix looks like one. */
  owner: string | null;
  /** The item with that prefix removed. Never empty for a usable item. */
  task: string;
  /** The line exactly as the model wrote it. */
  line: string;
}

/** Longest a prefix can be and still plausibly be somebody's name. */
const MAX_OWNER_CHARS = 40;
/** Most words a prefix can hold and still be a name rather than a clause. */
const MAX_OWNER_WORDS = 3;

/**
 * Prefixes that are labels, not people.
 *
 * A model asked for "Owner: task" will sometimes answer "Action: task" or
 * "Follow-up: task" instead, and "Action" is not on the team.
 */
const NOT_A_NAME = new Set([
  "action", "action item", "actions", "all", "any", "decision", "deadline", "due",
  "everyone", "follow up", "follow-up", "followup", "item", "n/a", "na", "next",
  "next step", "next steps", "none", "note", "notes", "owner", "task", "tbd",
  "team", "todo", "to do", "unassigned",
]);

/** Separators that mean the prefix names more than one person. */
const MULTIPLE = /(\band\b|&|\/|,|\+|\bwith\b)/i;

/**
 * Split an action item into its owner and its text.
 *
 * The prefix is only read as a name when it looks like one: short, a word or
 * three, no sentence punctuation, not one of the labels above, and not naming
 * two people at once. Anything else leaves `owner` null and the line intact —
 * there is no harm in an item that stays with the host, and real harm in
 * deciding "Review the model, then:" is a person.
 */
export function parseActionItem(line: string): ParsedActionItem {
  const text = (line ?? "").trim().replace(/\s+/g, " ");
  if (!text) return { owner: null, task: "", line: "" };

  const colon = text.indexOf(":");
  if (colon <= 0) return { owner: null, task: text, line: text };

  const prefix = text.slice(0, colon).trim();
  const rest = text.slice(colon + 1).trim();
  // A prefix with nothing after it is not an owner, it is punctuation.
  if (!rest) return { owner: null, task: text, line: text };

  if (prefix.length > MAX_OWNER_CHARS) return { owner: null, task: text, line: text };
  if (prefix.split(" ").length > MAX_OWNER_WORDS) return { owner: null, task: text, line: text };
  // Sentence punctuation inside the prefix means the colon ended a clause.
  if (/[.!?;]/.test(prefix)) return { owner: null, task: text, line: text };
  if (NOT_A_NAME.has(prefix.toLowerCase())) return { owner: null, task: text, line: text };
  // Two people named at once resolve to neither, the same way an ambiguous
  // directory match does: a task on the wrong person's list is worse than one
  // that stayed with the host.
  if (MULTIPLE.test(prefix)) return { owner: null, task: text, line: text };

  return { owner: prefix, task: rest, line: text };
}

/**
 * An item cut to fit a task title without cutting a word in half.
 *
 * The old `slice(0, 120)` ended tasks like "Send the updated cap table to the
 * inves" — which is a worse record of a commitment than a slightly shorter one.
 */
export function clampTitle(text: string, limit = 120): string {
  const clean = (text ?? "").trim().replace(/\s+/g, " ");
  if (clean.length <= limit) return clean;

  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  // Only break on a space when one is reasonably near the end; a single
  // enormous word would otherwise collapse the title to almost nothing.
  const head = space > Math.floor(limit * 0.6) ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.\-–—]+$/, "")}…`;
}
