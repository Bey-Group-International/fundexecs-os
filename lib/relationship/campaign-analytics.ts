// lib/relationship/campaign-analytics.ts
// Campaign analytics for the Relationship Intelligence Engine — the reporting
// layer over the sequences prospects get enrolled into. sequence_enrollments
// has no status column: state is DERIVED from completed_at / stopped_at /
// stopped_reason (a "replied" stop is a reply). Pure summarizers are
// unit-tested; loadCampaignAnalytics does the RLS-scoped reads.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type EnrollmentDerivedStatus = "replied" | "completed" | "stopped" | "active";

export interface EnrollmentRow {
  sequence_id?: string | null;
  completed_at?: string | null;
  stopped_at?: string | null;
  stopped_reason?: string | null;
}

// Derive an enrollment's state from its timestamps. A stop whose reason mentions
// a reply counts as "replied"; other stops are "stopped".
export function deriveStatus(e: EnrollmentRow): EnrollmentDerivedStatus {
  if (e.stopped_at) return /repl/i.test(e.stopped_reason ?? "") ? "replied" : "stopped";
  if (e.completed_at) return "completed";
  return "active";
}

export interface EnrollmentSummary {
  total: number;
  active: number;
  completed: number;
  stopped: number;
  replied: number;
  replyRate: number; // replied / total, as a 0–100 integer percent
}

export function summarizeEnrollments(rows: EnrollmentRow[]): EnrollmentSummary {
  const counts = { active: 0, completed: 0, stopped: 0, replied: 0 };
  for (const e of rows) counts[deriveStatus(e)] += 1;
  const total = rows.length;
  return {
    total,
    ...counts,
    replyRate: total ? Math.round((counts.replied / total) * 100) : 0,
  };
}

export interface CampaignStat extends EnrollmentSummary {
  id: string;
  name: string;
}

export interface CampaignAnalytics {
  campaigns: CampaignStat[]; // most-enrolled first
  totals: EnrollmentSummary;
}

// Group enrollments by sequence and summarize each, plus org-wide totals.
export function buildCampaignAnalytics(
  sequences: { id: string; name: string }[],
  enrollments: EnrollmentRow[],
): CampaignAnalytics {
  const bySeq = new Map<string, EnrollmentRow[]>();
  for (const e of enrollments) {
    if (!e.sequence_id) continue;
    const list = bySeq.get(e.sequence_id) ?? [];
    list.push(e);
    bySeq.set(e.sequence_id, list);
  }
  const campaigns = sequences
    .map((s) => ({ id: s.id, name: s.name, ...summarizeEnrollments(bySeq.get(s.id) ?? []) }))
    .sort((a, b) => b.total - a.total);
  return { campaigns, totals: summarizeEnrollments(enrollments) };
}

function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

// Load the org's campaigns + enrollment stats. RLS-scoped via the request
// server client. Filters sequences by organization_id (the NOT NULL column
// present on every row). Never throws — returns empty analytics on failure.
export async function loadCampaignAnalytics(
  db: SupabaseClient<Database>,
  orgId: string,
): Promise<CampaignAnalytics> {
  try {
    const { data: seqData } = await loose(db)
      .from("outreach_sequences")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    const sequences = ((seqData ?? []) as { id: string; name: string | null }[]).map((s) => ({
      id: s.id,
      name: s.name ?? "Untitled cadence",
    }));
    if (sequences.length === 0) return { campaigns: [], totals: summarizeEnrollments([]) };

    const { data: enrData } = await loose(db)
      .from("sequence_enrollments")
      .select("sequence_id, completed_at, stopped_at, stopped_reason")
      .in("sequence_id", sequences.map((s) => s.id));

    return buildCampaignAnalytics(sequences, (enrData ?? []) as EnrollmentRow[]);
  } catch {
    return { campaigns: [], totals: summarizeEnrollments([]) };
  }
}
