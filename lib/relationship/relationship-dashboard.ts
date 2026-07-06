// lib/relationship/relationship-dashboard.ts
// The Relationship Command Center — one aggregated view over the engine. Reuses
// the campaign-analytics and intent-signal loaders and adds CRM counts, then
// derives a short list of recommended next actions. Native, RLS-scoped, never
// throws (returns a zeroed dashboard on failure). buildRecommendations is pure
// and unit-tested.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadCampaignAnalytics, type EnrollmentSummary } from "@/lib/relationship/campaign-analytics";
import { loadInterestSignals, type PartyIntent } from "@/lib/relationship/interest-signals";

export interface RelationshipDashboard {
  contacts: { total: number; highConfidence: number; suppressed: number; lists: number };
  campaigns: EnrollmentSummary;
  signals: { total: number; topParties: PartyIntent[] };
  recommendations: string[];
}

const HIGH_CONFIDENCE = 70;

// Derive next-action recommendations from the aggregated numbers. Pure so the
// prioritization logic is testable independent of the DB.
export function buildRecommendations(d: Omit<RelationshipDashboard, "recommendations">): string[] {
  const recs: string[] = [];

  if (d.signals.topParties.length) {
    const top = d.signals.topParties[0];
    recs.push(`Follow up with ${top.party} — highest intent (${top.intent}) from ${top.events} engagement event${top.events === 1 ? "" : "s"}.`);
  }
  if (d.campaigns.active > 0) {
    recs.push(`${d.campaigns.active} contact${d.campaigns.active === 1 ? "" : "s"} mid-sequence — review replies and advance the ready ones.`);
  }
  if (d.campaigns.replied > 0) {
    recs.push(`${d.campaigns.replied} repl${d.campaigns.replied === 1 ? "y" : "ies"} to triage into the pipeline (reply rate ${d.campaigns.replyRate}%).`);
  }
  const lowConfidence = d.contacts.total - d.contacts.highConfidence;
  if (lowConfidence > 0) {
    recs.push(`${lowConfidence} contact${lowConfidence === 1 ? "" : "s"} below high-confidence — verify before bulk outreach.`);
  }
  if (d.contacts.total === 0) {
    recs.push("Build a plan in Prospecting and save it to seed the CRM.");
  }
  return recs.slice(0, 5);
}

function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

// A minimal thenable count-query view: chainable filters resolving to { count }.
interface CountQuery extends PromiseLike<{ count: number | null }> {
  eq: (column: string, value: unknown) => CountQuery;
  gte: (column: string, value: unknown) => CountQuery;
}

async function countRows(
  db: SupabaseClient<Database>,
  table: string,
  apply: (q: CountQuery) => CountQuery,
): Promise<number> {
  try {
    const base = loose(db).from(table).select("id", { count: "exact", head: true }) as unknown as CountQuery;
    const { count } = await apply(base);
    return count ?? 0;
  } catch {
    return 0;
  }
}

// Load the full dashboard for an org. Reuses the campaign + signal loaders and
// adds CRM counts. RLS-scoped; degrades to zeroes on any failure.
export async function loadRelationshipDashboard(
  db: SupabaseClient<Database>,
  orgId: string,
): Promise<RelationshipDashboard> {
  const [total, highConfidence, suppressed, lists, campaignAnalytics, signals] = await Promise.all([
    countRows(db, "network_contacts", (q) => q.eq("organization_id", orgId)),
    countRows(db, "network_contacts", (q) => q.eq("organization_id", orgId).gte("confidence", HIGH_CONFIDENCE)),
    countRows(db, "do_not_contact", (q) => q.eq("organization_id", orgId)),
    countRows(db, "contact_lists", (q) => q.eq("organization_id", orgId)),
    loadCampaignAnalytics(db, orgId),
    loadInterestSignals(db, orgId),
  ]);

  const base = {
    contacts: { total, highConfidence, suppressed, lists },
    campaigns: campaignAnalytics.totals,
    signals: { total: signals.totals.total, topParties: signals.parties.slice(0, 3) },
  };
  return { ...base, recommendations: buildRecommendations(base) };
}
