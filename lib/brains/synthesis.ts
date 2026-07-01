// Knowledge Synthesis Engine — Feature 05
//
// Automatically synthesizes accumulated artifacts into coherent knowledge
// articles via Claude Haiku. Synthesis items are queued in `synthesis_queue`,
// reviewed by an operator, then approved or discarded.
//
// Claude claude-haiku-4-5-20251001 is used for cheap, fast synthesis. Falls
// back to a template string when ANTHROPIC_API_KEY is absent so the module
// never crashes in environments without a key.

import { createServiceClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SynthesisQueueItem {
  id: string;
  org_id: string;
  topic_key: string;
  source_artifact_ids: string[];
  synthesis_status: "pending" | "processing" | "approved" | "discarded";
  draft_content?: string;
  approved_at?: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const SYNTHESIS_MODEL = "claude-haiku-4-5-20251001";

const SYNTHESIS_SYSTEM_PROMPT =
  "You are a knowledge synthesizer for a private equity fund operator. " +
  "Synthesize the following artifact IDs into a clear, structured knowledge article. " +
  "The article should have a brief executive summary, key insights, and any action items. " +
  "Be concise but comprehensive. Format with markdown headings.";

async function callClaudeSynthesize(
  item: SynthesisQueueItem,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const userContent =
    `Topic: ${item.topic_key}\n\n` +
    `Artifact IDs to synthesize:\n${item.source_artifact_ids.map((id) => `- ${id}`).join("\n")}\n\n` +
    `Please produce a structured knowledge article synthesizing the insights from these artifacts.`;

  const body = {
    model: SYNTHESIS_MODEL,
    max_tokens: 2048,
    system: SYNTHESIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
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
    return null;
  }

  if (!resp.ok) return null;

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return null;
  }

  const text: unknown =
    json &&
    typeof json === "object" &&
    "content" in json &&
    Array.isArray((json as { content: unknown[] }).content) &&
    (json as { content: { type: string; text?: string }[] }).content[0]?.text;

  return typeof text === "string" ? text.trim() : null;
}

function buildFallbackDraft(item: SynthesisQueueItem): string {
  return [
    `# Knowledge Synthesis: ${item.topic_key}`,
    "",
    "## Executive Summary",
    `This article synthesizes ${item.source_artifact_ids.length} artifact(s) related to the topic **${item.topic_key}**.`,
    "",
    "## Source Artifacts",
    ...item.source_artifact_ids.map((id) => `- \`${id}\``),
    "",
    "## Notes",
    "_Synthesis was generated without an AI model. Please review and enrich this article manually._",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Check which pending synthesis topics have accumulated enough source
 * artifacts to warrant synthesis (threshold: >= 5 artifact IDs).
 *
 * Stub: currently returns all pending topics regardless of count so early
 * pipelines can exercise the queue freely. Swap the commented filter in once
 * the queue has real volume.
 */
export async function checkSynthesisThreshold(
  orgId: string,
): Promise<string[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("synthesis_queue" as never)
    .select("topic_key, source_artifact_ids")
    .eq("org_id" as never, orgId)
    .eq("synthesis_status" as never, "pending");

  if (error || !data) return [];

  const rows = data as Pick<
    SynthesisQueueItem,
    "topic_key" | "source_artifact_ids"
  >[];

  // Stub: return all pending topics regardless of count.
  // To enforce the >= 5 threshold, uncomment the filter below:
  // return rows
  //   .filter((r) => r.source_artifact_ids.length >= 5)
  //   .map((r) => r.topic_key);
  return rows.map((r) => r.topic_key);
}

/**
 * Generate a synthesis draft for the given queue item using Claude Haiku.
 *
 * Flow:
 *   1. Set synthesis_status = 'processing'
 *   2. Call Claude (or build a fallback template if no API key)
 *   3. Set draft_content = <result>, synthesis_status = 'pending' (awaiting approval)
 *
 * Returns the draft content string.
 */
export async function generateSynthesisDraft(
  item: SynthesisQueueItem,
): Promise<string> {
  const supabase = createServiceClient();

  // Mark as processing so concurrent callers skip this item.
  await supabase
    .from("synthesis_queue" as never)
    .update({
      synthesis_status: "processing",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, item.id);

  // Attempt AI synthesis; fall back to deterministic template.
  const aiDraft = await callClaudeSynthesize(item);
  const draft = aiDraft ?? buildFallbackDraft(item);

  // Store draft and reset status to 'pending' to await operator approval.
  await supabase
    .from("synthesis_queue" as never)
    .update({
      draft_content: draft,
      synthesis_status: "pending",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, item.id);

  return draft;
}

/**
 * Mark a synthesis item as approved by the given user.
 */
export async function approveSynthesis(
  itemId: string,
  userId: string,
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("synthesis_queue" as never)
    .update({
      synthesis_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: userId,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, itemId);

  if (error) {
    throw new Error(`approveSynthesis: ${error.message}`);
  }
}

/**
 * Mark a synthesis item as discarded (will not be promoted to the knowledge base).
 */
export async function discardSynthesis(itemId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("synthesis_queue" as never)
    .update({
      synthesis_status: "discarded",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, itemId);

  if (error) {
    throw new Error(`discardSynthesis: ${error.message}`);
  }
}

/**
 * Enqueue or update a synthesis topic for the given org.
 *
 * Upserts on (org_id, topic_key). If a row already exists its
 * source_artifact_ids array is extended with any new IDs (deduped).
 * Returns the resulting row.
 */
export async function enqueueSynthesisTopic(
  orgId: string,
  topicKey: string,
  artifactIds: string[],
): Promise<SynthesisQueueItem> {
  const supabase = createServiceClient();

  // Fetch any existing row so we can merge artifact IDs client-side.
  const { data: existing } = await supabase
    .from("synthesis_queue" as never)
    .select("*")
    .eq("org_id" as never, orgId)
    .eq("topic_key" as never, topicKey)
    .maybeSingle();

  const existingRow = existing as SynthesisQueueItem | null;

  if (existingRow) {
    const merged = Array.from(
      new Set([...existingRow.source_artifact_ids, ...artifactIds]),
    );

    const { data: updated, error } = await supabase
      .from("synthesis_queue" as never)
      .update({
        source_artifact_ids: merged,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id" as never, existingRow.id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(
        `enqueueSynthesisTopic: failed to update row — ${error?.message ?? "no data"}`,
      );
    }

    return updated as SynthesisQueueItem;
  }

  // No existing row — insert fresh.
  const { data: inserted, error: insertError } = await supabase
    .from("synthesis_queue" as never)
    .insert({
      org_id: orgId,
      topic_key: topicKey,
      source_artifact_ids: artifactIds,
      synthesis_status: "pending",
    } as never)
    .select()
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `enqueueSynthesisTopic: failed to insert row — ${insertError?.message ?? "no data"}`,
    );
  }

  return inserted as SynthesisQueueItem;
}

/**
 * List all synthesis items for an org that are in 'pending' or 'processing'
 * status, ordered oldest-first.
 */
export async function listPendingSyntheses(
  orgId: string,
): Promise<SynthesisQueueItem[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("synthesis_queue" as never)
    .select("*")
    .eq("org_id" as never, orgId)
    .in("synthesis_status" as never, ["pending", "processing"])
    .order("created_at" as never, { ascending: true });

  if (error || !data) return [];

  return data as SynthesisQueueItem[];
}
