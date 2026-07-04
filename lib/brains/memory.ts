// Agent Memory layer — extract, store, and retrieve typed memories from agent
// task outputs. Memories are scoped to (org_id, agent_key) and classified into
// one of five semantic types so the consuming agent can weight them differently.
//
// Extraction uses Claude claude-haiku-4-5-20251001 (cheap, fast) to parse up to 5
// memories from a task output string. Falls back to [] if ANTHROPIC_API_KEY is
// absent so the caller never breaks in environments without a key.
//
// Retrieval uses cosine similarity via the local HashingEmbedder + pgvector when
// the agent_memories table has an `embedding` column; otherwise falls back to a
// recency-ordered SELECT. The fallback is transparent to the caller.

import { createServerClient } from "@/lib/supabase/server";
import { getEmbedder, toVectorLiteral } from "@/lib/brains/embed";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MemoryType =
  | "decision"
  | "constraint"
  | "preference"
  | "outcome"
  | "open_item";

export interface AgentMemory {
  id: string;
  org_id: string;
  agent_key: string;
  memory_type: MemoryType;
  content: string;
  source_task_id?: string | null;
  source_session_id?: string | null;
  pinned: boolean;
  dismissed: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

interface RawMemory {
  memory_type: MemoryType;
  content: string;
}

const VALID_TYPES = new Set<MemoryType>([
  "decision",
  "constraint",
  "preference",
  "outcome",
  "open_item",
]);

function isValidMemoryType(v: unknown): v is MemoryType {
  return typeof v === "string" && VALID_TYPES.has(v as MemoryType);
}

async function callClaudeExtract(taskOutput: string): Promise<RawMemory[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const systemPrompt = `You are a memory extraction assistant for an AI agent system.
Given a task output, extract up to 5 concise, meaningful memories that an agent should retain for future context.
Classify each memory as one of: decision, constraint, preference, outcome, open_item.
- decision: a choice or resolution made during the task
- constraint: a hard limit or rule that must be respected
- preference: a soft preference or style the operator expressed
- outcome: a concrete result or finding from the task
- open_item: something unresolved that needs follow-up

Return ONLY a valid JSON array of objects with keys "memory_type" and "content". No prose, no markdown, no code fences.
Example: [{"memory_type":"decision","content":"Chose Series B term sheet from Acme Capital"},{"memory_type":"open_item","content":"Need to confirm LP wiring instructions"}]`;

  const body = {
    model: EXTRACTION_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Extract memories from this task output:\n\n${taskOutput.slice(0, 8000)}`,
      },
    ],
  };

  let resp: Response;
  try {
    resp = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return [];
  }

  if (!resp.ok) return [];

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return [];
  }

  // Extract text from first content block
  const text: unknown =
    json &&
    typeof json === "object" &&
    "content" in json &&
    Array.isArray((json as { content: unknown[] }).content) &&
    (json as { content: { type: string; text?: string }[] }).content[0]?.text;

  if (typeof text !== "string") return [];

  let parsed: unknown;
  try {
    // Strip any accidental markdown fences before parsing
    const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const memories: RawMemory[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      isValidMemoryType((item as Record<string, unknown>).memory_type) &&
      typeof (item as Record<string, unknown>).content === "string"
    ) {
      memories.push({
        memory_type: (item as Record<string, unknown>).memory_type as MemoryType,
        content: ((item as Record<string, unknown>).content as string).trim(),
      });
      if (memories.length >= 5) break;
    }
  }

  return memories;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Extract up to 5 typed memories from a task output string using Claude Haiku,
 * insert them into the `agent_memories` table, and return the inserted rows.
 *
 * Falls back to [] when ANTHROPIC_API_KEY is absent or the extraction produces
 * no usable memories.
 */
export async function extractAndStoreMemories(
  taskOutput: string,
  agentKey: string,
  taskId: string,
  orgId: string,
): Promise<AgentMemory[]> {
  const raw = await callClaudeExtract(taskOutput);
  if (raw.length === 0) return [];

  const supabase = await createServerClient();

  const rows = raw.map((m) => ({
    org_id: orgId,
    agent_key: agentKey,
    memory_type: m.memory_type,
    content: m.content,
    source_task_id: taskId,
    pinned: false,
    dismissed: false,
  }));

  const { data, error } = await supabase
    .from("agent_memories")
    .insert(rows as never[])
    .select();

  if (error || !data) return [];

  return (data as AgentMemory[]);
}

/**
 * Retrieve up to `limit` relevant memories for a given agent + org.
 *
 * When the `agent_memories` table exposes an `embedding` column and the
 * local embedder is available, performs cosine similarity search via the
 * `match_agent_memories` RPC (if present). Otherwise falls back to a
 * recency-ordered SELECT filtered to non-dismissed rows.
 */
export async function retrieveRelevantMemories(
  prompt: string,
  agentKey: string,
  orgId: string,
  limit = 5,
): Promise<AgentMemory[]> {
  const supabase = await createServerClient();

  // Attempt vector similarity search via RPC first.
  if (prompt.trim()) {
    try {
      const queryEmbedding = toVectorLiteral(await getEmbedder().embed(prompt, "query"));
      const { data: vecData, error: vecError } = await (supabase as Awaited<ReturnType<typeof createServerClient>>).rpc(
        "match_agent_memories" as never,
        {
          query_embedding: queryEmbedding,
          target_org: orgId,
          target_agent: agentKey,
          match_count: limit,
        } as never,
      );
      if (!vecError && Array.isArray(vecData) && (vecData as unknown[]).length > 0) {
        return vecData as AgentMemory[];
      }
    } catch {
      // RPC not yet deployed — fall through to keyword/recency fallback.
    }
  }

  // Recency fallback: most-recent non-dismissed memories for this agent + org.
  const { data, error } = await supabase
    .from("agent_memories")
    .select("*")
    .eq("org_id", orgId)
    .eq("agent_key", agentKey)
    .eq("dismissed", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data as AgentMemory[];
}
