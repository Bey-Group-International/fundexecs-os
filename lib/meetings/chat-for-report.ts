// lib/meetings/chat-for-report.ts
// The meeting's typed chat, as the report model reads it.
//
// What people type during a call is often what they did not say: the link to
// the deck, the figure somebody pasted, "can we move the close to the 14th?"
// asked while someone else was talking. The report used to be built from the
// transcript alone, so all of that was missing from the summary, the decisions
// and the action items. Now the chat goes in beside it.
//
// Only the room's shared chat. Private messages are never stored, so they can
// never reach the report.
//
// Pure formatting here; the read is chat-for-report.server.ts.

/** A stored chat row, as the report needs it. */
export interface ChatRowForReport {
  author_name: string | null;
  body: string | null;
  ts: string | null;
}

/** At most this many characters of chat go to the model; the latest are kept. */
export const CHAT_FOR_REPORT_LIMIT = 20_000;

/**
 * The chat as "[14:05] Priya: text" lines, oldest first, trimmed from the front
 * to the budget — a meeting ends where it decided things, as the transcript
 * budget assumes too. Empty when nobody typed.
 */
export function chatForReport(rows: readonly ChatRowForReport[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const text = (row.body ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const who = (row.author_name ?? "").trim() || "Guest";
    const at = row.ts ? Date.parse(row.ts) : NaN;
    const clock = Number.isNaN(at)
      ? ""
      : `[${String(new Date(at).getUTCHours()).padStart(2, "0")}:${String(new Date(at).getUTCMinutes()).padStart(2, "0")} UTC] `;
    lines.push(`${clock}${who}: ${text}`);
  }
  let out = lines.join("\n");
  if (out.length <= CHAT_FOR_REPORT_LIMIT) return out;
  out = out.slice(-CHAT_FOR_REPORT_LIMIT);
  const firstBreak = out.indexOf("\n");
  return `[Earlier chat omitted]\n${firstBreak >= 0 ? out.slice(firstBreak + 1) : out}`;
}
