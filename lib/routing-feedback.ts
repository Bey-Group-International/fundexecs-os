// lib/routing-feedback.ts
// Closing the routing feedback loop: when an operator corrects a mis-routed
// workflow on the Execution Grid, that "reroute" lands in operator_feedback.
// This module reads recent corrections and turns them into a short planning
// preamble so the Intelligence Layer stops repeating the same mis-routes.
// The formatter is PURE and unit-tested; the DB reader is thin and best-effort.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OperatorFeedback } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

// Recent reroute rows are summarized from `metadata`; the columns are loose
// (jsonb), so we read defensively rather than trusting any single shape.
export interface RoutingCorrectionRow {
  subject: string;
  metadata: unknown;
  created_at?: string;
}

interface RerouteFacts {
  from_engine: string;
  to_engine: string;
  title: string;
}

const MAX_CORRECTIONS = 5;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Pull from→to→title out of a row, preferring structured metadata and falling
// back to the "<From> → <To>" subject when metadata is missing/partial.
function rerouteFacts(row: RoutingCorrectionRow): RerouteFacts | null {
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  let from = asString(meta.from_engine);
  let to = asString(meta.to_engine);
  if ((!from || !to) && row.subject) {
    const [subjFrom, subjTo] = row.subject.split("→").map((s) => s.trim());
    from = from || asString(subjFrom);
    to = to || asString(subjTo);
  }
  const title = asString(meta.title);
  if (!from || !to) return null;
  return { from_engine: from, to_engine: to, title };
}

/**
 * Pure formatter: summarize up to ~5 distinct recent reroute corrections into a
 * short preamble for the planner. De-duplicates repeated from→to pairs (keeping
 * the newest, since rows arrive newest-first) and returns undefined when there
 * is nothing to say. Deterministic and null-safe.
 */
export function formatRoutingCorrections(rows: RoutingCorrectionRow[] | null | undefined): string | undefined {
  if (!rows?.length) return undefined;
  const seen = new Set<string>();
  const facts: RerouteFacts[] = [];
  for (const row of rows) {
    const fact = rerouteFacts(row);
    if (!fact) continue;
    const key = `${fact.from_engine}→${fact.to_engine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(fact);
    if (facts.length >= MAX_CORRECTIONS) break;
  }
  if (!facts.length) return undefined;

  const corrections = facts
    .map((f) => {
      const like = f.title ? `requests like "${f.title}"` : "such requests";
      return `${like} belong in ${f.to_engine} (was mis-routed to ${f.from_engine})`;
    })
    .join("; ");
  return `Operator routing corrections to respect: ${corrections}. Prefer the corrected engine for similar work.`;
}

/**
 * Best-effort reader: recent org-scoped reroute corrections, newest first.
 * Returns [] on any error so planning is never blocked by feedback reads.
 */
export async function getRoutingCorrections(
  supabase: Client,
  orgId: string,
): Promise<RoutingCorrectionRow[]> {
  try {
    const { data } = await supabase
      .from("operator_feedback")
      .select("subject, metadata, created_at")
      .eq("organization_id", orgId)
      .eq("signal", "reroute")
      .order("created_at", { ascending: false })
      .limit(20);
    return (data ?? []) as Pick<OperatorFeedback, "subject" | "metadata" | "created_at">[] as RoutingCorrectionRow[];
  } catch {
    return [];
  }
}

export const __test = {
  formatRoutingCorrections,
};
