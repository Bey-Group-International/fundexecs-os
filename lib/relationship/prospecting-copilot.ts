// lib/relationship/prospecting-copilot.ts
// Earn's prospecting copilot — the orchestration layer of the Relationship
// Intelligence Engine (piece 3/4).
//
// It turns a plain-language GOAL ("raise capital", "source deals", "find
// lenders") into a reviewable, approval-gated plan: interpret the goal → a
// target persona + search terms → source candidates → score & rank them
// (fit + priority, 2/4) → gate them (compliance + review, 1/4) → pick an
// outreach sequence and route the work to the right executive agent. It never
// sends: the output is a plan for the user to approve.
//
// The core (interpretGoal / scoreCandidate / planProspects) is pure and unit-
// tested; buildProspectingPlanForOrg is the thin server wrapper that feeds it
// live data by reusing the existing sourcing + mandate loaders.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  fitScore,
  priorityScore,
  needsReview,
  bulkOutboundEligibility,
  scoreBand,
  type Mandate,
  type ScoreBand,
} from "@/lib/relationship/prospect-scoring";
import {
  detectSourcingIntent,
  sourceFirmsWithContacts,
  type SourcedFirm,
} from "@/lib/chat-enrichment";

// A prospecting goal → the persona, search terms, executive agent, and default
// outreach sequence used to pursue it. Agent keys are Brain keys
// (lib/brains/catalog.ts); sequence keys are templates (lib/outreach.ts).
export interface GoalSpec {
  goal: string;
  persona: string;
  keywords: string[];
  targetRoles: string[];
  agentKey: string;
  sequenceKey: string;
}

const GOALS: { match: RegExp; spec: GoalSpec }[] = [
  {
    match: /\b(raise|raising) capital|fundrais|find (lps|investors|limited partners)|lp (outreach|prospect)/i,
    spec: {
      goal: "raise_capital",
      persona: "Institutional allocators & family offices that back funds like ours",
      keywords: ["institutional investor", "family office"],
      targetRoles: ["Chief Investment Officer", "Managing Partner", "Head of Investments"],
      agentKey: "capital_raiser",
      sequenceKey: "lp_warm_intro",
    },
  },
  {
    match: /\bsource (deals|acquisitions|targets)|deal sourcing|acquisition targets|find (companies|businesses|targets)/i,
    spec: {
      goal: "source_deals",
      persona: "Owners & operators of acquisition-fit businesses",
      keywords: ["business owner", "founder"],
      targetRoles: ["Owner", "Founder", "Chief Executive Officer", "President"],
      agentKey: "deal_sourcer",
      sequenceKey: "deal_owner_outreach",
    },
  },
  {
    match: /\bfind lenders|lender|debt (provider|financing)|private credit|financing/i,
    spec: {
      goal: "find_lenders",
      persona: "Private credit funds & lenders that finance deals in our range",
      keywords: ["private credit", "lending", "bank"],
      targetRoles: ["Managing Director", "Partner", "Head of Originations"],
      agentKey: "capital_connector",
      sequenceKey: "deal_owner_outreach",
    },
  },
  {
    match: /\bsponsor|independent sponsor|build (sponsor|partner) relationships|strategic partner/i,
    spec: {
      goal: "build_partnerships",
      persona: "Sponsors, co-investors & strategic partners aligned to our mandate",
      keywords: ["private equity", "family office"],
      targetRoles: ["Managing Partner", "Principal", "Partner"],
      agentKey: "capital_connector",
      sequenceKey: "linkedin_light",
    },
  },
  {
    match: /\brecruit operators|operating partner|operator|board member/i,
    spec: {
      goal: "recruit_operators",
      persona: "Seasoned operators & operating partners for portfolio roles",
      keywords: ["operating partner", "chief executive"],
      targetRoles: ["Operating Partner", "Chief Executive Officer", "Chief Operating Officer"],
      agentKey: "rainmaker",
      sequenceKey: "linkedin_light",
    },
  },
  {
    match: /\b(invite|event|attendees|guest list)/i,
    spec: {
      goal: "invite_event",
      persona: "Relevant guests for the event",
      keywords: ["institutional investor", "family office"],
      targetRoles: ["Managing Partner", "Chief Investment Officer"],
      agentKey: "event_curator",
      sequenceKey: "linkedin_light",
    },
  },
];

const DEFAULT_GOAL: GoalSpec = {
  goal: "general_sourcing",
  persona: "Relevant private-market contacts for this mandate",
  keywords: ["institutional investor"],
  targetRoles: ["Managing Partner", "Chief Investment Officer"],
  agentKey: "capital_connector",
  sequenceKey: "linkedin_light",
};

// Map a plain-language goal to its GoalSpec (falls back to general sourcing).
export function interpretGoal(goalText: string): GoalSpec {
  return GOALS.find((g) => g.match.test(goalText))?.spec ?? DEFAULT_GOAL;
}

export interface ProspectCandidate {
  id?: string;
  name: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  seniority?: string | null;
  confidence?: number | null; // 0–100
  strength?: number | null; // 0–100
  engagement?: number | null; // 0–100
  urgency?: number | null; // 0–100
  verified?: boolean | null;
  email?: string | null;
  contactable?: boolean; // from the compliance gate; defaults true
  contactableReason?: string;
}

export interface ScoredProspect {
  candidate: ProspectCandidate;
  fit: number;
  priority: number;
  band: ScoreBand;
  fitReasons: string[];
  eligibleForOutreach: boolean;
  holdReason?: string;
}

// Score + gate a single candidate against the mandate.
export function scoreCandidate(candidate: ProspectCandidate, mandate: Mandate): ScoredProspect {
  const fit = fitScore(
    { seniority: candidate.seniority, title: candidate.title, company: candidate.company, location: candidate.location },
    mandate,
  );
  const priority = priorityScore({
    fit: fit.score,
    confidence: candidate.confidence ?? 0,
    engagement: candidate.engagement ?? 0,
    strength: candidate.strength ?? 0,
    urgency: candidate.urgency ?? 0,
  });
  const review = needsReview({ confidence: candidate.confidence, verified: candidate.verified, email: candidate.email });
  const eligibility = bulkOutboundEligibility({
    contactable: candidate.contactable ?? true,
    contactableReason: candidate.contactableReason,
    needsReview: review,
  });
  return {
    candidate,
    fit: fit.score,
    priority: priority.score,
    band: priority.band,
    fitReasons: fit.reasons,
    eligibleForOutreach: eligibility.eligible,
    holdReason: eligibility.eligible ? undefined : eligibility.reason,
  };
}

export interface ProspectingPlan {
  goal: GoalSpec;
  status: "draft";
  requiresApproval: true;
  persona: string;
  prospects: ScoredProspect[]; // priority-desc
  segments: { high: ScoredProspect[]; medium: ScoredProspect[]; low: ScoredProspect[] };
  readyForOutreach: ScoredProspect[];
  heldForReview: ScoredProspect[];
  routedAgent: string;
  sequenceKey: string;
  outreachAngle: string;
  nextActions: string[];
}

// Assemble the reviewable plan: rank, segment, gate, route, and recommend.
export function planProspects(args: {
  goal: GoalSpec;
  mandate: Mandate;
  candidates: ProspectCandidate[];
}): ProspectingPlan {
  const { goal, mandate, candidates } = args;
  const scored = candidates
    .map((c) => scoreCandidate(c, mandate))
    .sort((a, b) => b.priority - a.priority);

  const segments = {
    high: scored.filter((s) => scoreBand(s.priority) === "high"),
    medium: scored.filter((s) => scoreBand(s.priority) === "medium"),
    low: scored.filter((s) => scoreBand(s.priority) === "low"),
  };
  const readyForOutreach = scored.filter((s) => s.eligibleForOutreach);
  const heldForReview = scored.filter((s) => !s.eligibleForOutreach);

  const nextActions = [
    `Review the ${scored.length} scored prospect${scored.length === 1 ? "" : "s"} (${segments.high.length} high priority).`,
    readyForOutreach.length
      ? `Approve the "${goal.sequenceKey}" sequence for ${readyForOutreach.length} outreach-ready contact${readyForOutreach.length === 1 ? "" : "s"}.`
      : "No contacts are outreach-ready yet — enrich or verify before sending.",
    heldForReview.length
      ? `Resolve ${heldForReview.length} contact${heldForReview.length === 1 ? "" : "s"} held for compliance/confidence review.`
      : "All scored contacts cleared the compliance & review gates.",
    `Route follow-up to the ${goal.agentKey.replace(/_/g, " ")} agent.`,
  ];

  return {
    goal,
    status: "draft",
    requiresApproval: true,
    persona: goal.persona,
    prospects: scored,
    segments,
    readyForOutreach,
    heldForReview,
    routedAgent: goal.agentKey,
    sequenceKey: goal.sequenceKey,
    outreachAngle: `Lead with mandate fit for ${goal.persona.toLowerCase()}; personalize by the top fit reason per contact.`,
    nextActions,
  };
}

// Turn a SourcedFirm (from the Apollo sourcing path) into a scoreable candidate.
function candidateFromFirm(s: SourcedFirm): ProspectCandidate {
  const c = s.contact;
  return {
    id: c?.id,
    name: c?.name ?? s.firm.name,
    title: c?.title,
    company: s.firm.name,
    location: c?.location ?? s.firm.headquarters,
    seniority: c?.seniority,
    confidence: Math.round((c?.confidence ?? s.firm.confidence ?? 0) * 100),
    email: c?.email,
    verified: Boolean(c?.email),
  };
}

// Server orchestrator: goal text + org → a live, reviewable prospecting plan.
// Loads the org's mandate geographies, sources candidate firms/contacts, and
// runs the pure planner. Never throws — returns an empty plan on any failure so
// the copilot degrades gracefully.
export async function buildProspectingPlanForOrg(
  db: SupabaseClient<Database>,
  orgId: string,
  goalText: string,
): Promise<ProspectingPlan> {
  const goal = interpretGoal(goalText);

  // Mandate geographies + asset classes from the active thesis (best effort).
  const mandate: Mandate = { targetRoles: goal.targetRoles };
  try {
    const { data: theses } = await db
      .from("investment_theses")
      .select("geographies, asset_classes, is_active")
      .eq("organization_id", orgId);
    if (theses?.length) {
      const active = theses.find((t) => t.is_active) ?? theses[0];
      mandate.geographies = Array.isArray(active?.geographies) ? (active!.geographies as string[]) : undefined;
      mandate.assetClasses = Array.isArray(active?.asset_classes) ? (active!.asset_classes as string[]) : undefined;
    }
  } catch {
    // No mandate context — score on role/seniority alone.
  }

  // Source candidates. Prefer the goal's own search terms; fall back to any
  // sourcing intent detectable in the goal text.
  let candidates: ProspectCandidate[] = [];
  try {
    const spec = { keywords: goal.keywords, location: detectSourcingIntent(goalText)?.location };
    const firms = await sourceFirmsWithContacts(spec, mandate.geographies ?? []);
    candidates = firms.map(candidateFromFirm);
  } catch {
    candidates = [];
  }

  return planProspects({ goal, mandate, candidates });
}
