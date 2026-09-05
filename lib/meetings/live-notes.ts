// lib/meetings/live-notes.ts
// Making a model's structured output safe to render.
//
// The notes and report prompts ask for arrays of strings. A model asked for
// "action items with owners" will sometimes answer in the shape the words
// suggest instead of the shape the schema declares — `{ owner, task }` objects,
// or a nested list. The type assertion at the call site does not notice, and the
// object reaches JSX, where React throws "Objects are not valid as a React
// child". In the meeting room that throw hits the route's error boundary, which
// replaces the whole page: the call ends, camera and mic are released, and
// everyone in the room is dropped because one panel got an unexpected shape.
//
// So the output is coerced here, at the boundary, into exactly what the UI
// renders. An oddly shaped item becomes a sensible line of text rather than a
// crash, and anything that cannot be salvaged is dropped.

export interface LiveNotes {
  key_points: string[];
  action_items: string[];
  decisions: string[];
  summary: string;
}

export function emptyLiveNotes(): LiveNotes {
  return { key_points: [], action_items: [], decisions: [], summary: "" };
}

/** Field order for flattening an object item into a line, most useful first. */
const OWNER_KEYS = ["owner", "assignee", "who", "speaker", "name", "person"];
const BODY_KEYS = ["task", "item", "action", "action_item", "text", "description", "point", "decision", "title", "summary", "value"];
const DUE_KEYS = ["due", "due_date", "deadline", "by", "when"];

function readString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * One list entry, however the model chose to shape it, as a line of text.
 *
 * `{ owner: "Sarah", task: "Send deck", due: "Friday" }` becomes
 * "Sarah: Send deck (due Friday)" — which is the form the prompt asked for in
 * prose, so the reader sees what they were meant to see either way.
 */
export function normalizeNoteItem(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(normalizeNoteItem).filter(Boolean).join(" — ");
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const owner = readString(source, OWNER_KEYS);
    const body = readString(source, BODY_KEYS);
    const due = readString(source, DUE_KEYS);

    if (body) {
      const head = owner ? `${owner}: ${body}` : body;
      return due ? `${head} (due ${due})` : head;
    }
    // No key we recognize. Rather than render "[object Object]" or drop content
    // the meeting actually produced, join whatever strings it does hold.
    const salvaged = Object.values(source)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());
    return salvaged.join(" — ");
  }
  return "";
}

/** A list field coerced to renderable strings, empties and duplicates removed. */
export function normalizeNoteList(value: unknown, limit = 50): string[] {
  const items = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const line = normalizeNoteItem(item);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

/** A free-text field coerced to a single string. */
export function normalizeNoteText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  const line = normalizeNoteItem(value);
  return line;
}

/**
 * Model output narrowed to exactly the shape the notes UI renders.
 *
 * Unknown extra keys are dropped rather than spread through: the client types
 * this as `LiveNotes`, and anything else reaching a `.map()` there is the bug
 * this function exists to prevent.
 */
export function normalizeLiveNotes(value: unknown): LiveNotes {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyLiveNotes();
  const raw = value as Record<string, unknown>;
  return {
    key_points: normalizeNoteList(raw.key_points),
    action_items: normalizeNoteList(raw.action_items),
    decisions: normalizeNoteList(raw.decisions),
    summary: normalizeNoteText(raw.summary),
  };
}
