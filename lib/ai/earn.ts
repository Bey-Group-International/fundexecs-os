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

/** A hint about what the operator is currently looking at, so Earn can tailor
 *  its guidance (passed from the dock's EarnContext). */
export interface EarnContextHint {
  kind?: string;
  entityId?: string;
  entityLabel?: string;
}

/* ----------------------------------------------------------------------------
 * Earn tools — how Earn reactively acts on the app.
 *
 * `navigate` is a safe, read-only move (auto-runs client-side). The mutating
 * tools (`create_deal`, `run_diligence`) are surfaced as confirm cards the
 * operator approves before anything is written. Tool execution lives in
 * `lib/actions/earn-actions.ts`; this module only declares the contract.
 * --------------------------------------------------------------------------*/

export const EARN_NAV_DESTINATIONS = [
  '/command-center',
  '/pipeline',
  '/capital-stack',
  '/profile',
  '/trust',
  '/materials',
  '/partners',
  '/match-inbox',
  '/diligence',
  '/audit',
  '/integrations',
  '/settings'
] as const;

export type EarnToolMode = 'auto' | 'confirm';

export interface EarnToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  mode: EarnToolMode;
}

const EARN_TOOLS: Anthropic.Tool[] = [
  {
    name: 'navigate',
    description:
      'Open an in-app destination for the operator when the best next step is to take them to a specific surface. Safe and reversible.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string', enum: [...EARN_NAV_DESTINATIONS] },
        reason: { type: 'string', description: 'Short reason shown to the operator.' }
      },
      required: ['destination']
    }
  },
  {
    name: 'create_deal',
    description:
      'Create a new deal in the pipeline. The operator must confirm before it is created.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        stage: { type: 'string' },
        amount: { type: 'number' }
      },
      required: ['name']
    }
  },
  {
    name: 'run_diligence',
    description:
      'Run the AI diligence committee on a deal. The operator must confirm before it runs.',
    input_schema: {
      type: 'object',
      properties: {
        dealId: { type: 'string' },
        dealName: { type: 'string', description: 'Display name of the deal, for the confirm card.' }
      }
    }
  }
];

const AUTO_TOOLS = new Set(['navigate']);

/** Whether a tool runs immediately (read/navigate) or needs operator confirm. */
export function earnToolMode(name: string): EarnToolMode {
  return AUTO_TOOLS.has(name) ? 'auto' : 'confirm';
}

/**
 * Retrieve the org-scoped brain knowledge for the latest user turn. Factored out
 * of `askEarn` so the streaming path can reuse the exact same RAG step. Never
 * throws for a missing key / empty knowledge — returns empty context instead.
 */
async function retrieveContext(
  supabase: SupabaseClient<Database>,
  orgId: string,
  messages: EarnMessage[]
): Promise<{ sources: EarnSource[]; contextBlock: string }> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return { sources: [], contextBlock: '' };
  try {
    const vector = await embedQuery(lastUser.content);
    const { data } = await supabase.rpc('match_knowledge_chunks', {
      query_embedding: toVectorLiteral(vector),
      match_count: 6,
      _org_id: orgId
    });
    if (data && data.length) {
      return {
        sources: data.map((d) => ({ brainId: d.brain_id, snippet: d.content.slice(0, 200) })),
        contextBlock: data.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n')
      };
    }
  } catch {
    // RAG unavailable (no VOYAGE_API_KEY or no embedded knowledge yet).
  }
  return { sources: [], contextBlock: '' };
}

/** Build the system blocks shared by the streaming + non-streaming paths. */
function buildSystem(contextBlock: string, hint?: EarnContextHint): Anthropic.TextBlockParam[] {
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
  ];
  if (hint?.entityLabel || hint?.kind) {
    const idNote = hint.entityId ? ` [id: ${hint.entityId}]` : '';
    system.push({
      type: 'text',
      text: `The operator is currently focused on: ${hint.entityLabel ?? hint.kind}${hint.kind && hint.entityLabel ? ` (${hint.kind})` : ''}${idNote}. Tailor guidance to this context. When you propose taking them somewhere or acting for them, prefer the tools (navigate / create_deal / run_diligence) over describing the steps. If a deal id is in context, pass it to run_diligence.`
    });
  }
  if (contextBlock) {
    system.push({
      type: 'text',
      text: `Knowledge-base context (the 15 BGI brains):\n\n${contextBlock}`
    });
  }
  return system;
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

/**
 * Streaming variant of {@link askEarn}: runs the same RAG step, then returns the
 * retrieved `sources` up front plus an async iterable of text deltas from
 * Claude. The caller streams the deltas to the client and can accumulate the
 * full text for persistence. Mirrors `askEarn`'s grounding + voice exactly.
 */
export async function streamEarn(
  supabase: SupabaseClient<Database>,
  orgId: string,
  messages: EarnMessage[],
  hint?: EarnContextHint
): Promise<{
  sources: EarnSource[];
  deltas: AsyncIterable<string>;
  /** Resolves after the stream completes with any tool calls Earn proposed. */
  tools: () => Promise<EarnToolUse[]>;
}> {
  const { sources, contextBlock } = await retrieveContext(supabase, orgId, messages);
  const anthropic = new Anthropic();
  const system = buildSystem(contextBlock, hint);

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: EARN_TOOLS,
    messages: messages.map((m) => ({ role: m.role, content: m.content }))
  });

  async function* deltas(): AsyncIterable<string> {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  // Read tool_use blocks from the completed message (after deltas drain).
  const tools = async (): Promise<EarnToolUse[]> => {
    const final = await stream.finalMessage();
    return final.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: (b.input ?? {}) as Record<string, unknown>,
        mode: earnToolMode(b.name)
      }));
  };

  return { sources, deltas: deltas(), tools };
}
