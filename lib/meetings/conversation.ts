// lib/meetings/conversation.ts
// Starting an inbox conversation with one person from a meeting's report.
//
// The report knows who was there and what they agreed to; the inbox is where a
// conversation with them lives. This is the opening message the composer on
// the report starts from — built from what the page already holds, with no
// model call, so opening the composer costs nothing. "Draft with Earn"
// (conversation-draft.server.ts) is the paid step, and only when asked.
//
// Pure: no database, no clock, no network. Safe in the browser.

export interface ConversationTemplateInput {
  meetingTitle: string | null;
  recipientName: string;
  /** The report's action items, as the page shows them. */
  actionItems: readonly string[];
}

export interface ConversationDraft {
  subject: string;
  body: string;
}

/** How many action items the template carries before it stops listing them. */
export const TEMPLATE_ACTION_ITEMS = 5;
export const SUBJECT_MAX = 200;
export const BODY_MAX = 10_000;

/** "Ana" from "Ana Lopez"; nothing from an address used as a name. */
export function firstName(name: string): string {
  const n = name.trim();
  if (!n || n.includes("@")) return "";
  return n.split(/\s+/)[0];
}

export function conversationTemplate(input: ConversationTemplateInput): ConversationDraft {
  const title = (input.meetingTitle ?? "").trim() || "our meeting";
  const who = firstName(input.recipientName);
  const items = input.actionItems
    .map((i) => i.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, TEMPLATE_ACTION_ITEMS);
  const lines = [`Hi${who ? ` ${who}` : ""},`, "", `Thanks again for your time in ${title}.`];
  if (items.length) {
    lines.push("", "Picking up from where we left off:", ...items.map((i) => `- ${i}`));
  }
  lines.push("", "");
  return { subject: (input.meetingTitle ?? "").trim() || "Following up", body: lines.join("\n") };
}

/** What a send needs before it goes anywhere; null when it is ready. */
export function conversationProblem(draft: { subject: string; body: string }): string | null {
  if (!draft.subject.trim()) return "Add a subject.";
  if (draft.subject.length > SUBJECT_MAX) return "The subject is too long.";
  if (!draft.body.trim()) return "Write a message first.";
  if (draft.body.length > BODY_MAX) return "The message is too long.";
  return null;
}
