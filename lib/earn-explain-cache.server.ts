// lib/earn-explain-cache.server.ts
// Org-wide 24h cache of Earn "Explain this" answers (table earn_explanations).
//
// Service-role only: the table has no RLS policies, because a cached answer can
// describe a record the reader may not see. Callers must have already loaded
// the record under the caller's own permissions before reading from here.
import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { ExplainRecordRef } from "@/lib/earn-explain";

export const EXPLAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedExplanation {
  content: string;
  createdAt: string;
}

function service() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createServiceClient() : null;
}

/** A saved answer for this record younger than the TTL, or null. */
export async function getCachedExplanation(
  orgId: string,
  ref: ExplainRecordRef,
  now = Date.now(),
): Promise<CachedExplanation | null> {
  const client = service();
  if (!client) return null;
  const { data } = await client
    .from("earn_explanations")
    .select("content, created_at")
    .eq("organization_id", orgId)
    .eq("record_type", ref.type)
    .eq("record_id", ref.id)
    .gte("created_at", new Date(now - EXPLAIN_CACHE_TTL_MS).toISOString())
    .maybeSingle();
  const row = data as { content: string; created_at: string } | null;
  return row?.content?.trim() ? { content: row.content, createdAt: row.created_at } : null;
}

/** Save (or replace) the answer for this record. Best-effort. */
export async function saveExplanation(
  orgId: string,
  ref: ExplainRecordRef,
  content: string,
  meta: { model: string; userId: string },
): Promise<void> {
  const client = service();
  if (!client || !content.trim()) return;
  await client
    .from("earn_explanations")
    .upsert(
      {
        organization_id: orgId,
        record_type: ref.type,
        record_id: ref.id,
        content,
        model: meta.model,
        created_by: meta.userId,
        created_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,record_type,record_id" },
    )
    .then(undefined, () => {});
}
