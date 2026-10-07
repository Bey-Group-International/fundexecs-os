// lib/inbox/revise-reply.server.ts
// "Send back to Earn" on a held reply: rewrite it with the approver's note and
// put it back in approvals — same thread, same recipient, same author.
//
// Before, sending an inbox reply back for revision withdrew it: the generic
// "regenerate" re-planned a workflow that had no plan, and the reply and the
// note were both lost. The rewrite runs on the small model, from the reply and
// the note alone — a rewrite needs nothing else, and costs nothing more.
//
// When there is no model to ask, or it says nothing usable, the reply goes back
// unchanged with the note recorded, so the approver can edit it themselves:
// nothing is lost either way.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { anthropicClient, isAnthropicTimeout } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import type { PendingInboxReply } from "@/lib/inbox/pending-action";

type Client = SupabaseClient<Database>;

export const REVISE_MODEL = process.env.CLAUDE_FAST_MODEL || "claude-haiku-4-5";
const BODY_MAX = 5000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { body: { type: "string", description: "The revised message, plain text, no signature." } },
  required: ["body"],
} as const;

export async function rewriteReply(input: {
  body: string;
  note: string;
  subject: string | null;
  recipient: string | null;
}): Promise<{ body: string; live: boolean }> {
  const fallback = { body: input.body, live: false };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !input.note.trim()) return fallback;
  try {
    const message = await anthropicClient(apiKey).messages.create({
      model: REVISE_MODEL,
      max_tokens: 900,
      system:
        "You revise an email a private-markets operator is about to send, following the reviewer's note exactly. " +
        "Keep everything the note does not ask to change. Never invent figures, dates or commitments. " +
        "Same voice, first person, no signature.",
      ...effortConfig(REVISE_MODEL, "low", SCHEMA),
      messages: [
        {
          role: "user",
          content:
            `To: ${input.recipient ?? "the recipient"}\nSubject: ${input.subject ?? ""}\n\n` +
            `Draft:\n${input.body.slice(0, BODY_MAX)}\n\nReviewer's note:\n${input.note.trim().slice(0, 1000)}`,
        },
      ],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return fallback;
    const body = String((JSON.parse(text) as { body?: unknown }).body ?? "").trim().slice(0, BODY_MAX);
    return body ? { body, live: true } : fallback;
  } catch (err) {
    if (isAnthropicTimeout(err)) console.warn("[inbox/revise-reply] timed out — kept the draft");
    return fallback;
  }
}

/** The description a reply task carries, in the shape the inbox has always written. */
export function replyDescription(channel: string, subject: string, body: string): string {
  return `Unified-inbox reply on the ${channel} thread "${subject}":\n\n${body}`;
}

/**
 * Rewrite a held reply with the approver's note and re-open its approval. The
 * old approval row is already decided ("regenerate"); a fresh pending one goes
 * on the same task, which stays awaiting approval with the new text on it.
 */
export async function reviseInboxReply(
  client: Client,
  input: {
    orgId: string;
    taskId: string;
    title: string;
    agent: string | null;
    reply: PendingInboxReply;
    note: string;
  },
): Promise<{ ok: boolean; revised: boolean; error?: string; notice?: string }> {
  const { reply } = input;
  const { data: thread } = await client
    .from("inbox_threads")
    .select("subject, channel, counterparty_name, counterparty_email")
    .eq("organization_id", input.orgId)
    .eq("id", reply.threadId)
    .maybeSingle();
  const t = thread as { subject: string; channel: string; counterparty_name: string | null; counterparty_email: string | null } | null;

  const rewritten = await rewriteReply({
    body: reply.body ?? "",
    note: input.note,
    subject: t?.subject ?? null,
    recipient: t?.counterparty_name ?? t?.counterparty_email ?? null,
  });

  const nextReply: PendingInboxReply = { ...reply, body: rewritten.body, delivered: false };
  const { error: taskError } = await client
    .from("tasks")
    .update({
      status: "awaiting_approval",
      description: replyDescription(t?.channel ?? "gmail", t?.subject ?? "", rewritten.body),
      result: {
        inboxReply: nextReply,
        revision: { note: input.note, rewritten: rewritten.live, at: new Date().toISOString() },
      } as unknown as Json,
    })
    .eq("organization_id", input.orgId)
    .eq("id", input.taskId);
  if (taskError) return { ok: false, revised: false, error: taskError.message };

  const { error: approvalError } = await client.from("approvals").insert({
    organization_id: input.orgId,
    task_id: input.taskId,
    requested_by_agent: input.agent,
    summary: rewritten.live ? `Revised — ${input.title}` : `Sent back — ${input.title}`,
  } as never);
  if (approvalError) return { ok: false, revised: rewritten.live, error: approvalError.message };

  return {
    ok: true,
    revised: rewritten.live,
    notice: rewritten.live
      ? "Earn revised it — it is back in approvals."
      : "Earn could not revise it; it is back in approvals unchanged — edit it yourself.",
  };
}
