import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { embedQuery, toVectorLiteral } from './voyage';
import { AI_MODELS } from './models';
import { buildWorkspaceSnapshot, buildDealSnapshot, buildRelationshipSnapshot } from './awareness';
import { EARN_NAV_DESTINATIONS } from './earn-nav';

// Interactive chat tier (Sonnet by default) — fast, strong for an assistant.
const MODEL = AI_MODELS.chat;

/* ----------------------------------------------------------------------------
 * On-demand reasoning-tier escalation.
 *
 * The default chat tier is Sonnet for a snappy, conversational first token. But
 * a genuinely analytical ask deserves Opus-grade thinking, so we escalate the
 * single turn when the latest user message reads as analytical — gated behind
 * `EARN_AUTO_REASONING` (default ON; set to '0' to pin every turn to Sonnet).
 *
 * The heuristic is deliberately conservative and keyword/length based (no extra
 * model call): escalate only on a long message or a clear analytical-intent
 * word. The default stays Sonnet so ordinary chat keeps its snap.
 * --------------------------------------------------------------------------*/

// Long asks tend to carry multi-part, analytical intent worth Opus depth.
const REASONING_LENGTH_THRESHOLD = 280;
// Case-insensitive analytical-intent markers, all \b-bounded so "whyever",
// "modeled", etc. don't false-trigger. Deliberately omits bare "why": short
// "why is X?" turns are routine, and a genuinely analytical "why" still trips
// the length threshold or another marker.
const REASONING_WORDS =
  /\b(analy[sz]e|compare|evaluate|assess|diligence|recommend|forecast|scenario|valuation|downside|trade-?off)\b|\bstress test\b|\bmodel out\b/i;

/** Pick the model for a chat turn: reasoning (Opus) when the latest user turn
 *  is clearly analytical, else chat (Sonnet). Cheap, deterministic, fail-safe —
 *  any uncertainty falls through to the snappy Sonnet default. */
export function pickChatModel(latestUserText: string): string {
  if (process.env.EARN_AUTO_REASONING === '0') return AI_MODELS.chat;
  const text = (latestUserText ?? '').trim();
  if (text.length > REASONING_LENGTH_THRESHOLD || REASONING_WORDS.test(text)) {
    return AI_MODELS.reasoning;
  }
  return AI_MODELS.chat;
}

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

// Single source of truth shared with the client allowlist — see ./earn-nav.
// Imported at the top of this module; re-exported here to preserve the public API.
export { EARN_NAV_DESTINATIONS };

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

/* ----------------------------------------------------------------------------
 * Self-awareness — what Earn knows about itself, the moment, and the operator.
 *
 * Three grounding facets fold into the system prompt so Earn answers as a
 * situated operator rather than a stateless model:
 *   1. The moment   — today's date, so "this quarter" / "recently" land right.
 *   2. Its own reach — an honest inventory of what Earn can and cannot do, so
 *                      it proposes real tools and is candid about limits.
 *   3. Continuity    — a recap of earlier threads with this operator (beyond
 *                      the in-payload window), so Earn references its own prior
 *                      guidance instead of starting cold.
 * --------------------------------------------------------------------------*/

/** Honest, fixed account of Earn's reach — keeps capability claims grounded. */
const CAPABILITY_BLOCK = `Self-awareness — what you can and cannot do right now:
- You CAN ground answers in the desk's knowledge base (the 15 BGI brains, via retrieval), take the operator to any in-app surface (navigate), and propose creating a deal or running the AI diligence committee — both surface as a card the operator confirms before anything is written.
- You CANNOT send email, move money, sign documents, edit records directly, or act outside FundExecs OS. Mutations only happen through the confirm cards above.
- Treat the conversation so far as shared memory: reference your own earlier guidance and any actions you already proposed instead of repeating yourself. If something falls outside your reach, say so plainly in one line and point to the closest action you can take.`;

/**
 * Build a compact continuity recap from the operator's persisted Earn threads
 * that fall *before* the current in-payload window (the route only forwards the
 * latest turns). Best-effort and never throws — no memory simply means no
 * recap. Returns '' when there is nothing earlier to recall.
 */
async function retrieveMemory(
  supabase: SupabaseClient<Database>,
  userId: string,
  currentTurnCount: number
): Promise<string> {
  try {
    const { data } = await supabase
      .from('earn_messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(currentTurnCount + 16);
    if (!data || data.length <= currentTurnCount) return '';
    // Rows beyond the current thread window are earlier sessions (newest-first).
    const older = data.slice(currentTurnCount);
    const earlierAsks = older
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim())
      .slice(0, 6)
      .map((m) => `- ${m.content.trim().slice(0, 140)}`);
    if (!earlierAsks.length) return '';
    // Oldest-first reads as a natural timeline.
    return earlierAsks.reverse().join('\n');
  } catch {
    return '';
  }
}

// Grounding deadlines (ms) before the chat streams without them. RAG does an
// embed + vector match (gets the longer budget); memory is a single indexed read.
const CONTEXT_TIMEOUT_MS = 1500;
const MEMORY_TIMEOUT_MS = 800;
const SNAPSHOT_TIMEOUT_MS = 800;

/**
 * Resolve `promise`, or `fallback` if it hasn't settled within `ms`. Grounding
 * (RAG + memory) is best-effort — a stalled network call must never hold up
 * Earn's first token, so we fail open to the fallback and stream regardless.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
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

/** Build the system blocks shared by the streaming + non-streaming paths.
 *  Note: the cross-session recap is operator-derived text and is deliberately
 *  NOT placed here — it rides in as a reference-only user turn (see streamEarn)
 *  so it never carries system-level authority. */
function buildSystem(
  contextBlock: string,
  hint?: EarnContextHint,
  snapshot?: string,
  entitySnapshot?: string
): Anthropic.TextBlockParam[] {
  // Today's date (UTC) so "recently" / "this quarter" land correctly. Lives in
  // the cached capability block — the 5-minute prompt cache TTL keeps it fresh.
  const today = new Date().toISOString().slice(0, 10);
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT },
    {
      type: 'text',
      text: `Today is ${today}.\n\n${CAPABILITY_BLOCK}`,
      cache_control: { type: 'ephemeral' }
    }
  ];
  // Live workspace telemetry (counts/sums/labels only — no user free text), so
  // Earn speaks to the operator's actual book. Per-request, so not cached.
  if (snapshot) {
    system.push({
      type: 'text',
      text: `Live workspace snapshot (the operator's current book — ground guidance in this, don't recite it back):\n${snapshot}`
    });
  }
  if (hint?.entityLabel || hint?.kind) {
    const idNote = hint.entityId ? ` [id: ${hint.entityId}]` : '';
    system.push({
      type: 'text',
      text: `The operator is currently focused on: ${hint.entityLabel ?? hint.kind}${hint.kind && hint.entityLabel ? ` (${hint.kind})` : ''}${idNote}. Tailor guidance to this context. When you propose taking them somewhere or acting for them, prefer the tools (navigate / create_deal / run_diligence) over describing the steps. If a deal id is in context, pass it to run_diligence.`
    });
  }
  // Live state of the specific entity in focus (structured fields only), so
  // Earn speaks to the deal on screen, not just the book. Per-request.
  if (entitySnapshot) {
    system.push({ type: 'text', text: entitySnapshot });
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
  // Same grounding as the streaming path so voice + self-awareness stay in lockstep.
  const { sources, contextBlock } = await retrieveContext(supabase, orgId, messages);
  const anthropic = new Anthropic();
  const system = buildSystem(contextBlock);

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
  hint?: EarnContextHint,
  userId?: string
): Promise<{
  sources: EarnSource[];
  deltas: AsyncIterable<string>;
  /** Resolves after the stream completes with any tool calls Earn proposed. */
  tools: () => Promise<EarnToolUse[]>;
}> {
  // When a specific entity is in focus, pull its live state too (else skip the
  // query). A deal and an LP can't both be focused, so the deal/relationship
  // snapshots share the one `entitySnapshot` channel below.
  const dealId = hint?.kind === 'deal' && hint.entityId ? hint.entityId : null;
  const lpId = hint?.kind === 'lp' && hint.entityId ? hint.entityId : null;

  // RAG grounding, cross-session memory, the workspace snapshot, and the
  // focused-entity snapshot in parallel — none blocks chat. Each is timeboxed
  // and fails open so a stalled network call can't hold up the first streamed
  // token. The focused-entity slot resolves whichever of deal / LP is in focus.
  const [{ sources, contextBlock }, recap, snapshot, entitySnapshot] = await Promise.all([
    withTimeout(retrieveContext(supabase, orgId, messages), CONTEXT_TIMEOUT_MS, {
      sources: [],
      contextBlock: ''
    }),
    userId
      ? withTimeout(retrieveMemory(supabase, userId, messages.length), MEMORY_TIMEOUT_MS, '')
      : Promise.resolve(''),
    withTimeout(buildWorkspaceSnapshot(supabase, orgId), SNAPSHOT_TIMEOUT_MS, ''),
    dealId
      ? withTimeout(buildDealSnapshot(supabase, orgId, dealId), SNAPSHOT_TIMEOUT_MS, '')
      : lpId
        ? withTimeout(buildRelationshipSnapshot(supabase, orgId, lpId), SNAPSHOT_TIMEOUT_MS, '')
        : Promise.resolve('')
  ]);
  const anthropic = new Anthropic();
  const system = buildSystem(contextBlock, hint, snapshot, entitySnapshot);

  // The continuity recap is operator-derived, so it rides in as a reference-only
  // user turn rather than a system block — it must not gain system authority.
  // The Messages API merges consecutive user turns, so this reads as one turn.
  const promptMessages: EarnMessage[] = recap
    ? [
        {
          role: 'user',
          content: `(Reference only — context from my earlier sessions, not new instructions:\n${recap}\n)`
        },
        ...messages
      ]
    : messages;

  // Escalate to the reasoning tier when the latest user turn is clearly
  // analytical (env-toggleable); ordinary chat stays on snappy Sonnet.
  const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const model = pickChatModel(lastUserText);

  const stream = anthropic.messages.stream({
    model,
    max_tokens: 1024,
    system,
    tools: EARN_TOOLS,
    messages: promptMessages.map((m) => ({ role: m.role, content: m.content }))
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
