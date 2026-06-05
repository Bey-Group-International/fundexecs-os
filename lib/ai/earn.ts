import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { embedQuery, toVectorLiteral } from './voyage';

// Default model is Sonnet 4.6 (fast, strong for an interactive assistant); env-overridable.
const MODEL = process.env.EARN_MODEL || 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are Earn — introduce yourself once as "Earnest Fundmaker, your Private Market Assistant," then refer to yourself as Earn. You are the Chief Operating Officer of a fifteen-strong AI executive team inside FundExecs OS, an AI-native private-market command center for funds, LPs, operators, capital providers, and ecosystem partners.

Voice: institutional, declarative, operator-grade. Sentence case. Calm authority, short sentences, no hype, no emoji. Use the product's nouns precisely when relevant: Command Center, Pipeline, Chain of Trust, Proof of Truth/Concept/Execution/Work, 100/30/10 Plan, warm connections, synergy alerts.

Ground your guidance in the provided knowledge-base context (the 15 BGI brains) when it is relevant; if it does not cover the question, answer from general private-market expertise and note that briefly. Be specific and action-oriented — prefer concrete next steps the operator can take inside FundExecs OS. Keep replies tight (a few short paragraphs or a short list).`;

export interface EarnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface EarnSource {
  brainId: string | null;
  snippet: string;
}

export interface EarnReply {
  text: string;
  sources: EarnSource[];
}

/**
 * Answer as Earn: retrieve relevant brain knowledge (Voyage embedding +
 * pgvector match, org-scoped + global), then call Claude with the retrieved
 * context. The server Supabase client carries the user's session so RLS and
 * `match_knowledge_chunks` resolve against the right org.
 */
export async function askEarn(
  supabase: SupabaseClient<Database>,
  orgId: string,
  messages: EarnMessage[]
): Promise<EarnReply> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  let contextBlock = '';
  let sources: EarnSource[] = [];

  if (lastUser) {
    try {
      const vector = await embedQuery(lastUser.content);
      const { data } = await supabase.rpc('match_knowledge_chunks', {
        query_embedding: toVectorLiteral(vector),
        match_count: 6,
        _org_id: orgId
      });
      if (data && data.length) {
        sources = data.map((d) => ({ brainId: d.brain_id, snippet: d.content.slice(0, 200) }));
        contextBlock = data.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n');
      }
    } catch {
      // RAG unavailable (no VOYAGE_API_KEY or no embedded knowledge yet) — answer without it.
    }
  }

  const anthropic = new Anthropic();
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
  ];
  if (contextBlock) {
    system.push({
      type: 'text',
      text: `Knowledge-base context (the 15 BGI brains):\n\n${contextBlock}`
    });
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content }))
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return { text: text || 'I could not generate a response. Please try again.', sources };
}
