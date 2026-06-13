import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { AI_MODELS } from '@/lib/ai/models';

/* ============================================================================
 * lib/inbox/draft.ts — Earn drafts a reply to an inbox conversation (P3).
 *
 * Pulls the conversation (subject + preview) and the resolved contact, asks
 * Claude (the chat tier — Sonnet, operator-facing) for a concise, ready-to-send
 * reply, and persists it onto `inbox_items.draft_reply`. The operator reviews,
 * edits, and approves before anything is sent — "the team works, you approve".
 *
 * Never-block, same contract as lib/ai/match-judge: a missing API key, a
 * missing item, a Claude error, or the 12s timeout all return `{ ok: false }`
 * and leave the row untouched. The caller (server action) authorizes the user
 * against the item's org before invoking this.
 * ========================================================================= */

const MODEL = AI_MODELS.chat;
const AI_TIMEOUT_MS = 12_000;

export interface DraftResult {
  ok: boolean;
  draft?: string;
  reason?: string;
}

/** Narrow typed escape over the not-yet-generated `inbox_items` table. */
interface InboxDraftReader {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (values: { draft_reply: string }) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Draft a reply for one inbox item and persist it. Returns the draft text on
 * success so the UI can show it immediately without a re-read.
 */
export async function draftInboxReply(itemId: string): Promise<DraftResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no_api_key' };
  if (!itemId) return { ok: false, reason: 'no_item' };

  const admin = createAdminClient();
  const reader = admin as unknown as InboxDraftReader;

  const { data: item } = await reader
    .from('inbox_items')
    .select('id, channel, subject, preview, contact_id')
    .eq('id', itemId)
    .maybeSingle();

  if (!item) return { ok: false, reason: 'not_found' };

  // Best-effort contact personalization — never blocks the draft.
  let contactName = '';
  let contactCompany = '';
  const contactId = asString(item.contact_id);
  if (contactId) {
    const { data: contact } = await admin
      .from('contacts')
      .select('full_name, company')
      .eq('id', contactId)
      .maybeSingle();
    if (contact) {
      contactName = contact.full_name ?? '';
      contactCompany = contact.company ?? '';
    }
  }

  const channel = asString(item.channel) || 'message';
  const subject = asString(item.subject);
  const preview = asString(item.preview);

  const who = contactName
    ? `from ${contactName}${contactCompany ? ` (${contactCompany})` : ''}`
    : 'from a contact';
  const prompt = `Inbound ${channel} ${who}.
Subject: ${subject || '(none)'}
Message: ${preview || '(no preview available)'}

Draft a reply the operator can send as-is. Match the channel: a brief, warm-but-professional email for email; a short, direct note for Slack. Move the relationship forward (answer, or propose a concrete next step). No subject line, no signature block, no placeholders like [Name] — use the contact's name only if you know it. Plain text only.`;

  let draft = '';
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 600,
        system:
          "You are Earn, the COO of the FundExecs OS executive team, drafting a reply on the operator's behalf. Write what they would send: concise, specific, and human. Never invent facts beyond the supplied context; when a detail is unknown, keep the reply general rather than guessing.",
        messages: [{ role: 'user', content: prompt }]
      },
      { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }
    );
    draft = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch {
    return { ok: false, reason: 'draft_failed' };
  }

  if (!draft) return { ok: false, reason: 'empty_reply' };

  const { error } = await reader
    .from('inbox_items')
    .update({ draft_reply: draft })
    .eq('id', itemId);
  if (error) return { ok: false, reason: error.message };

  return { ok: true, draft };
}
