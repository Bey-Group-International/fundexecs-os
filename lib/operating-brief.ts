import { routeExecutiveRoles, type ExecutiveRoleRoute } from "@/lib/executive-team";
import type { MemberRole } from "@/lib/supabase/database.types";

export interface OperatingBriefSnapshot {
  userRole: MemberRole | null;
  organizationName: string;
  operatorRole: string | null;
  strategy: string | null;
  activeWorkflows: number;
  pendingApprovals: number;
  blockedWorkflows: number;
  openDeals: number;
  investors: number;
  documents: number;
  connectedChannels: number;
  recentSessions: number;
}

export interface OperatingBrief {
  context: string[];
  needsAttention: string[];
  blocked: string[];
  readyForApproval: string[];
  canAutomate: string[];
  nextActions: string[];
  suggestedRoles: ExecutiveRoleRoute[];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildOperatingBrief(snapshot: OperatingBriefSnapshot): OperatingBrief {
  const context = [
    `${snapshot.organizationName} · ${snapshot.operatorRole ?? "private-market operator"}`,
    snapshot.strategy ? `Primary strategy: ${snapshot.strategy.replace(/_/g, " ")}` : "No primary strategy set",
    `${plural(snapshot.openDeals, "open deal")} · ${plural(snapshot.investors, "investor")} · ${plural(snapshot.documents, "document")}`,
    `${plural(snapshot.connectedChannels, "connected channel")} · ${plural(snapshot.recentSessions, "recent session")}`,
  ];

  const needsAttention: string[] = [];
  if (snapshot.pendingApprovals > 0) {
    needsAttention.push(`${plural(snapshot.pendingApprovals, "approval")} waiting on operator review.`);
  }
  if (snapshot.openDeals === 0) {
    needsAttention.push("No active deal pipeline yet — sourcing is the next operating unlock.");
  }
  if (snapshot.investors === 0) {
    needsAttention.push("No allocator pipeline yet — add LP targets or ask Earn to source them.");
  }
  if (snapshot.documents === 0) {
    needsAttention.push("No workspace documents yet — create a data room checklist or memo template.");
  }

  const blocked = snapshot.blockedWorkflows > 0
    ? [`${plural(snapshot.blockedWorkflows, "workflow")} blocked and needs triage.`]
    : ["No blocked workflows detected."];

  const readyForApproval = snapshot.pendingApprovals > 0
    ? ["Review the approval queue before any external-facing or binding action proceeds."]
    : ["No approval gates are currently waiting."];

  const canAutomate: string[] = [];
  if (snapshot.connectedChannels > 0) {
    canAutomate.push("Connected channels can support approved follow-up and reporting workflows.");
  }
  if (snapshot.recentSessions > 0) {
    canAutomate.push("Recent Earn sessions can be converted into repeatable automations.");
  }
  if (canAutomate.length === 0) {
    canAutomate.push("Connect one channel or create one session before automation recommendations become useful.");
  }

  const nextActions = [
    snapshot.openDeals === 0
      ? "Source and score the first qualified deal targets."
      : "Advance the highest-fit deal to diligence or IC prep.",
    snapshot.investors === 0
      ? "Build a first allocator target list with verified contact routes."
      : "Prioritize LP follow-up by warmth, thesis fit, and commitment path.",
    snapshot.documents === 0
      ? "Create an investor-ready data room checklist."
      : "Turn existing documents into an investor-grade memo or LP update.",
  ];

  const prompt = `${nextActions.join(" ")} ${needsAttention.join(" ")}`;

  return {
    context,
    needsAttention,
    blocked,
    readyForApproval,
    canAutomate,
    nextActions,
    suggestedRoles: routeExecutiveRoles(prompt),
  };
}
