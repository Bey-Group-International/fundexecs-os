// lib/meetings/conversation-draft.server.ts
// "Draft with Earn" for a conversation started from a meeting report.
//
// Only runs when somebody presses the button, on the small model, from what the
// report already holds — its summary, decisions and action items — never the
// transcript. The opening message is a few sentences; a large model and the
// whole meeting would cost more and say no more.
//
// Never throws. No key, a timeout or an unusable answer all return the
// deterministic template the composer opened with, and say so.

import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, isAnthropicTimeout } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import { conversationTemplate, type ConversationDraft, SUBJECT_MAX, BODY_MAX } from "@/lib/meetings/conversation";

export const CONVERSATION_DRAFT_MODEL = process.env.CLAUDE_FAST_MODEL || "claude-haiku-4-5";

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string", description: "A short, specific email subject." },
    body: {
      type: "string",
      description: "The email body, greeting included, no signature. Plain text, a few short paragraphs at most.",
    },
  },
  required: ["subject", "body"],
} as const;

export interface DraftConversationInput {
  meetingTitle: string | null;
  recipientName: string;
  summary: string | null;
  decisions: readonly string[];
  actionItems: readonly string[];
}

export async function draftMeetingConversation(
  input: DraftConversationInput,
): Promise<ConversationDraft & { live: boolean }> {
  const fallback = { ...conversationTemplate(input), live: false };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;

  const context = [
    `Meeting: ${(input.meetingTitle ?? "").trim() || "(untitled)"}`,
    `Writing to: ${input.recipientName}`,
    input.summary?.trim() ? `Summary: ${input.summary.trim().slice(0, 2000)}` : null,
    input.decisions.length ? `Decisions:\n${input.decisions.slice(0, 10).map((d) => `- ${d}`).join("\n")}` : null,
    input.actionItems.length ? `Action items:\n${input.actionItems.slice(0, 10).map((a) => `- ${a}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const message = await anthropicClient(apiKey).messages.create({
      model: CONVERSATION_DRAFT_MODEL,
      max_tokens: 600,
      system:
        "You draft the first email of a new conversation for a private-markets operator, to one person " +
        "who was in a meeting with them. Use only what the meeting record says; never invent figures, " +
        "dates or commitments. Concise, warm, professional, first person. Move the relationship forward " +
        "with one clear next step. Greet the person by first name. No signature.",
      ...effortConfig(CONVERSATION_DRAFT_MODEL, "low", DRAFT_SCHEMA),
      messages: [{ role: "user", content: context }],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return fallback;
    const raw = JSON.parse(text) as { subject?: unknown; body?: unknown };
    const subject = typeof raw.subject === "string" ? raw.subject.trim().slice(0, SUBJECT_MAX) : "";
    const body = typeof raw.body === "string" ? raw.body.trim().slice(0, BODY_MAX) : "";
    if (!subject || !body) return fallback;
    return { subject, body, live: true };
  } catch (err) {
    if (isAnthropicTimeout(err)) console.warn("[meetings/conversation-draft] timed out — template fallback");
    return fallback;
  }
}
