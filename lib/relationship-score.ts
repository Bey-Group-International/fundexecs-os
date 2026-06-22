// lib/relationship-score.ts
// Relationship Intelligence Engine — cloned from Reuben AI pattern.
// Computes a 0-100 health score per investor relationship based on:
//   recency (40pts) × frequency (30pts) × deal overlap (20pts) × intro value (10pts)
// Also detects decay (silent contacts) and generates decay alerts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export interface RelationshipScore {
  investorId: string;
  investorName: string;
  score: number; // 0-100
  temperature: "cold" | "warm" | "active" | "committed";
  lastContactAt: string | null;
  daysSinceContact: number | null;
  interactionCount: number;
  decayAlert: boolean;
  decayDays: number | null;
  scoreBreakdown: {
    recency: number;
    frequency: number;
    dealOverlap: number;
    introValue: number;
  };
}

export interface DecayAlert {
  investorId: string;
  investorName: string;
  daysSilent: number;
  lastContactAt: string;
  priority: "critical" | "high" | "medium"; // 90+, 60-89, 30-59 days
  suggestedAction: string;
}

// Days-since-contact → recency score (0-40)
function recencyScore(days: number | null): number {
  if (days === null) return 0;
  if (days <= 7) return 40;
  if (days <= 14) return 35;
  if (days <= 30) return 28;
  if (days <= 60) return 18;
  if (days <= 90) return 8;
  return 0;
}

// Interaction count → frequency score (0-30)
function frequencyScore(count: number): number {
  if (count >= 20) return 30;
  if (count >= 10) return 24;
  if (count >= 5) return 18;
  if (count >= 2) return 10;
  if (count >= 1) return 5;
  return 0;
}

// Compute scores from raw relationship data
export function computeRelationshipScore(params: {
  investorId: string;
  investorName: string;
  interactionCount: number;
  lastContactAt: string | null;
  hasCommitment: boolean;
  hasActiveDeal: boolean;
  sharedConnectionCount: number;
  temperature: "cold" | "warm" | "active" | "committed";
}): RelationshipScore {
  const {
    investorId,
    investorName,
    interactionCount,
    lastContactAt,
    hasCommitment,
    hasActiveDeal,
    sharedConnectionCount,
    temperature,
  } = params;

  const now = Date.now();
  const lastMs = lastContactAt ? new Date(lastContactAt).getTime() : null;
  const daysSinceContact = lastMs ? Math.floor((now - lastMs) / 86400000) : null;

  const recency = recencyScore(daysSinceContact);
  const frequency = frequencyScore(interactionCount);

  // Deal overlap: committed > active deal > no overlap (0-20)
  const dealOverlap = hasCommitment ? 20 : hasActiveDeal ? 12 : 0;

  // Intro value: shared connections proxy (0-10)
  const introValue = Math.min(10, sharedConnectionCount * 2);

  const score = Math.min(100, recency + frequency + dealOverlap + introValue);

  // Decay: silent for 30+ days is notable; 60+ high; 90+ critical
  const decayAlert = daysSinceContact !== null && daysSinceContact >= 30 && !hasCommitment;
  const decayDays = decayAlert ? daysSinceContact : null;

  return {
    investorId,
    investorName,
    score,
    temperature,
    lastContactAt,
    daysSinceContact,
    interactionCount,
    decayAlert,
    decayDays,
    scoreBreakdown: { recency, frequency, dealOverlap, introValue },
  };
}

// Build relationship scores for all investors in the org from Supabase data
export async function buildRelationshipScores(supabase: Client): Promise<RelationshipScore[]> {
  const [investorsRes, commitmentsRes, threadsRes] = await Promise.all([
    supabase.from("investors").select("id, name, pipeline_stage").is("archived_at", null).limit(500),
    supabase.from("commitments").select("investor_id").limit(1000),
    // inbox_threads has investor_id directly — use it as the interaction proxy
    supabase
      .from("inbox_threads")
      .select("id, created_at, investor_id")
      .not("investor_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const investors = investorsRes.data ?? [];
  const committedInvestorIds = new Set((commitmentsRes.data ?? []).map((c) => c.investor_id));

  // Count threads per investor as interaction proxy
  const interactionsByInvestor = new Map<string, { count: number; lastAt: string | null }>();
  for (const thread of threadsRes.data ?? []) {
    const investorId = thread.investor_id;
    if (!investorId) continue;
    const existing = interactionsByInvestor.get(investorId) ?? { count: 0, lastAt: null };
    interactionsByInvestor.set(investorId, {
      count: existing.count + 1,
      lastAt: existing.lastAt ?? thread.created_at,
    });
  }

  const scores: RelationshipScore[] = investors.map((inv) => {
    const interactions = interactionsByInvestor.get(inv.id) ?? { count: 0, lastAt: null };
    const stage = (inv.pipeline_stage ?? "").toLowerCase();
    const temperature: RelationshipScore["temperature"] =
      committedInvestorIds.has(inv.id)
        ? "committed"
        : /(active|meeting|diligence|soft)/.test(stage)
          ? "active"
          : /(warm|intro|replied)/.test(stage)
            ? "warm"
            : "cold";

    return computeRelationshipScore({
      investorId: inv.id,
      investorName: inv.name,
      interactionCount: interactions.count,
      lastContactAt: interactions.lastAt,
      hasCommitment: committedInvestorIds.has(inv.id),
      hasActiveDeal: false,
      sharedConnectionCount: 0,
      temperature,
    });
  });

  return scores.sort((a, b) => b.score - a.score);
}

// Extract decay alerts for the Intelligence Strip / NBA panel
export function extractDecayAlerts(scores: RelationshipScore[]): DecayAlert[] {
  return scores
    .filter((s) => s.decayAlert && s.daysSinceContact !== null && s.lastContactAt !== null)
    .map((s) => {
      const days = s.daysSinceContact!;
      const priority: DecayAlert["priority"] =
        days >= 90 ? "critical" : days >= 60 ? "high" : "medium";
      const suggestedAction =
        s.temperature === "active"
          ? `Send ${s.investorName} a fund update — they were in active diligence.`
          : `Re-engage ${s.investorName} with a brief check-in or thesis update.`;
      return {
        investorId: s.investorId,
        investorName: s.investorName,
        daysSilent: days,
        lastContactAt: s.lastContactAt!,
        priority,
        suggestedAction,
      };
    })
    .sort((a, b) => b.daysSilent - a.daysSilent);
}
