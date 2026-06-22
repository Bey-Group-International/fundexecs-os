// lib/next-best-action.ts
// Next Best Action engine — cloned from Rhythms AI pattern.
import type { RelationshipScore, DecayAlert } from "@/lib/relationship-score";

export interface NBAItem {
  id: string;
  actionType:
    | "contact_overdue"
    | "cadence_due"
    | "meeting_prep"
    | "deal_followup"
    | "lp_update"
    | "intro_request";
  priority: number; // 0-100; higher = surfaces first
  title: string;
  description: string;
  contextSummary: string;
  copilotPrompt: string;
  investorId?: string;
  dealId?: string;
  dueAt?: string;
}

// Generate NBA items from decay alerts
export function nbaFromDecayAlerts(alerts: DecayAlert[]): NBAItem[] {
  return alerts.slice(0, 10).map((alert, i) => {
    const basePriority = alert.priority === "critical" ? 95 : alert.priority === "high" ? 80 : 65;
    const priority = Math.max(10, basePriority - i * 2);

    return {
      id: `decay-${alert.investorId}`,
      actionType: "contact_overdue",
      priority,
      title: `Re-engage ${alert.investorName}`,
      description: `${alert.daysSilent} days since last contact. ${alert.priority === "critical" ? "Critical — relationship cooling." : "Relationship needs a touch."}`,
      contextSummary: alert.suggestedAction,
      copilotPrompt: `Draft a personalized re-engagement message for ${alert.investorName}. Last contact was ${alert.daysSilent} days ago. Keep it brief, warm, and relevant to their investment focus. Suggest a specific next step.`,
      investorId: alert.investorId,
    };
  });
}

// Generate NBA items from relationship scores
export function nbaFromRelationshipScores(scores: RelationshipScore[]): NBAItem[] {
  const items: NBAItem[] = [];

  const stalled = scores.filter(
    (s) => s.temperature === "active" && s.score >= 40 && s.score < 80,
  );

  for (const s of stalled.slice(0, 5)) {
    items.push({
      id: `advance-${s.investorId}`,
      actionType: "deal_followup",
      priority: 75,
      title: `Advance ${s.investorName} to soft circle`,
      description: `Relationship score ${s.score}/100. Active but not yet committed.`,
      contextSummary: `${s.investorName} is engaged but needs a push. Send diligence materials or a soft-circle ask.`,
      copilotPrompt: `Prepare a targeted follow-up for ${s.investorName} to move them from active interest toward a soft-circle commitment. Include: current fund highlights, key investment thesis points relevant to their profile, and a clear ask with a timeline.`,
      investorId: s.investorId,
    });
  }

  return items;
}

// Merge and deduplicate NBA items, sort by priority
export function buildNBAList(
  decayAlerts: DecayAlert[],
  scores: RelationshipScore[],
  options: { maxItems?: number } = {},
): NBAItem[] {
  const { maxItems = 5 } = options;
  const items = [
    ...nbaFromDecayAlerts(decayAlerts),
    ...nbaFromRelationshipScores(scores),
  ];

  const seen = new Map<string, NBAItem>();
  for (const item of items) {
    const key = item.investorId ?? item.id;
    if (!seen.has(key) || seen.get(key)!.priority < item.priority) {
      seen.set(key, item);
    }
  }

  return [...seen.values()].sort((a, b) => b.priority - a.priority).slice(0, maxItems);
}

// Format a friendly time label for NBA items
export function formatDueLabel(dueAt: string | undefined): string {
  if (!dueAt) return "Today";
  const ms = new Date(dueAt).getTime() - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (days <= 0) return "Overdue";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}
