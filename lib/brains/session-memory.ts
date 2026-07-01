// lib/brains/session-memory.ts
// Session memory card — a lightweight structured summary of a conversation that
// persists alongside the session row. Updated incrementally by calling Claude
// claude-haiku-4-5-20251001 after each new user/assistant message.

import { createServiceClient } from "@/lib/supabase/server";

export interface SessionMemoryCard {
  entities: Array<{
    name: string;
    type: "person" | "company" | "deal" | "fund" | "other";
    note?: string;
  }>;
  decisions: string[];
  open_questions: string[];
  constraints: string[];
  updated_at: string;
}

const EMPTY_CARD: Omit<SessionMemoryCard, "updated_at"> = {
  entities: [],
  decisions: [],
  open_questions: [],
  constraints: [],
};

const SYSTEM_PROMPT = `You are a session memory manager for a private-equity / fund-management platform.
Given the current memory card (JSON) and a new conversation message, produce an updated memory card.

Extract and maintain:
- entities: people, companies, deals, funds, or other notable things mentioned. Each entry has a name, a type (person | company | deal | fund | other), and an optional short note.
- decisions: things that have been decided or agreed upon.
- open_questions: unresolved questions or items pending clarification.
- constraints: limits, requirements, or rules that must be respected (budget caps, deadlines, preferences, etc.).

Rules:
- Merge new findings with existing ones; do not drop prior context unless it is clearly superseded.
- Be concise — one short sentence per item is enough.
- Return ONLY a JSON object with keys: entities, decisions, open_questions, constraints.
- Do NOT include updated_at — it will be set by the caller.
- Do NOT wrap in markdown fences.`;

/**
 * Calls the Anthropic Messages API via fetch and returns the extracted JSON
 * content from the first text block.
 */
async function callHaiku(
  currentCard: Omit<SessionMemoryCard, "updated_at">,
  newMessage: string,
): Promise<Omit<SessionMemoryCard, "updated_at">> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful fallback — return the card unchanged.
    return currentCard;
  }

  const userContent = `Current memory card:\n${JSON.stringify(currentCard, null, 2)}\n\nNew message:\n${newMessage}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    // Non-fatal — return existing card rather than crashing.
    console.error(
      "[session-memory] Haiku API error",
      response.status,
      await response.text().catch(() => ""),
    );
    return currentCard;
  }

  const data = await response.json();
  const text: string =
    data?.content?.find((b: { type: string }) => b.type === "text")?.text ??
    "";

  try {
    const parsed = JSON.parse(text) as Omit<SessionMemoryCard, "updated_at">;
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : currentCard.entities,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : currentCard.decisions,
      open_questions: Array.isArray(parsed.open_questions)
        ? parsed.open_questions
        : currentCard.open_questions,
      constraints: Array.isArray(parsed.constraints)
        ? parsed.constraints
        : currentCard.constraints,
    };
  } catch {
    console.error("[session-memory] Failed to parse Haiku JSON response", text);
    return currentCard;
  }
}

/**
 * Fetches the current memory_card for the session, merges in the new message
 * via Claude Haiku, persists the updated card, and returns it.
 *
 * Falls back gracefully when:
 *   - ANTHROPIC_API_KEY is absent
 *   - The session row has no memory_card yet (starts from empty card)
 *   - The Haiku call fails for any reason
 */
export async function updateSessionMemoryCard(
  sessionId: string,
  newMessage: string,
): Promise<SessionMemoryCard> {
  const supabase = createServiceClient();

  // Fetch current card from DB.
  const { data: row, error } = await supabase
    .from("sessions")
    .select("memory_card")
    .eq("id", sessionId)
    .single();

  let currentCard: Omit<SessionMemoryCard, "updated_at"> = { ...EMPTY_CARD };

  if (!error && row && row.memory_card && typeof row.memory_card === "object") {
    const mc = row.memory_card as Partial<SessionMemoryCard>;
    currentCard = {
      entities: Array.isArray(mc.entities) ? mc.entities : [],
      decisions: Array.isArray(mc.decisions) ? mc.decisions : [],
      open_questions: Array.isArray(mc.open_questions) ? mc.open_questions : [],
      constraints: Array.isArray(mc.constraints) ? mc.constraints : [],
    };
  }

  // Call Haiku (or fall back silently).
  const updatedFields = await callHaiku(currentCard, newMessage);

  const updatedCard: SessionMemoryCard = {
    ...updatedFields,
    updated_at: new Date().toISOString(),
  };

  // Persist back to DB.
  await supabase
    .from("sessions")
    .update({ memory_card: updatedCard } as never)
    .eq("id", sessionId);

  return updatedCard;
}

/**
 * Reads the current memory_card for a session from Supabase.
 * Returns null if the session does not exist or has no memory card.
 */
export async function getSessionMemoryCard(
  sessionId: string,
): Promise<SessionMemoryCard | null> {
  const supabase = createServiceClient();

  const { data: row, error } = await supabase
    .from("sessions")
    .select("memory_card")
    .eq("id", sessionId)
    .single();

  if (error || !row || !row.memory_card) {
    return null;
  }

  const mc = row.memory_card as Partial<SessionMemoryCard>;

  if (
    !Array.isArray(mc.entities) ||
    !Array.isArray(mc.decisions) ||
    !Array.isArray(mc.open_questions) ||
    !Array.isArray(mc.constraints)
  ) {
    return null;
  }

  return {
    entities: mc.entities,
    decisions: mc.decisions,
    open_questions: mc.open_questions,
    constraints: mc.constraints,
    updated_at: mc.updated_at ?? new Date(0).toISOString(),
  };
}
