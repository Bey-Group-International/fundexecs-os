// lib/onboarding-review.ts
// The rules behind Run › Onboarding: which checks an LP needs, when a check
// counts as clear, and what stands between an LP and an approval. Pure and
// DB-free, so the same rules run in the UI (to explain) and in the server
// actions (to enforce).
import type {
  LpReviewState,
  OnboardingCheckKind,
  OnboardingCheckStatus,
  OnboardingDecisionKind,
} from "@/lib/supabase/database.types";

export interface CheckKindInfo {
  kind: OnboardingCheckKind;
  label: string;
  /** What the GP should record when this check is done. */
  hint: string;
  /** An LP cannot be approved until every required check is clear. */
  required: boolean;
}

export const CHECK_KINDS: CheckKindInfo[] = [
  { kind: "identity", label: "Identity", hint: "ID document and selfie verified, or attested by you.", required: true },
  { kind: "sanctions", label: "Sanctions", hint: "Screened against sanctions lists (OFAC and others).", required: true },
  { kind: "pep", label: "Politically exposed", hint: "Screened for politically exposed persons.", required: true },
  { kind: "adverse_media", label: "Adverse media", hint: "Searched for negative news on the LP and its principals.", required: true },
  { kind: "accreditation", label: "Accreditation", hint: "Accredited-investor status confirmed with supporting documents.", required: true },
  { kind: "litigation", label: "Litigation", hint: "Court and regulatory-action search. Recommended, not required.", required: false },
];

export const REQUIRED_KINDS: OnboardingCheckKind[] = CHECK_KINDS.filter((c) => c.required).map((c) => c.kind);

export const CHECK_STATUS_LABEL: Record<OnboardingCheckStatus, string> = {
  pending: "Not done",
  clear: "Clear",
  flagged: "Flagged",
  failed: "Failed",
};

export const REVIEW_STATE_LABEL: Record<LpReviewState, string> = {
  not_started: "Link sent",
  in_progress: "LP filling in",
  submitted: "Ready to review",
  changes_requested: "More info requested",
  approved: "Approved",
  rejected: "Turned down",
};

export const DECISION_LABEL: Record<OnboardingDecisionKind, string> = {
  approved: "Approved",
  rejected: "Rejected",
  more_info: "More information requested",
};

export interface CheckState {
  kind: OnboardingCheckKind;
  status: OnboardingCheckStatus;
  expires_at: string | null;
}

/** Clear, and not past its expiry. An expired clearance is no clearance. */
export function isClear(check: CheckState | undefined, now: number = Date.now()): boolean {
  if (!check || check.status !== "clear") return false;
  return !check.expires_at || new Date(check.expires_at).getTime() > now;
}

export interface Readiness {
  /** Every required check is clear and unexpired. */
  ready: boolean;
  /** Required checks nobody has recorded yet, or that are still "not done". */
  notDone: OnboardingCheckKind[];
  /** Required checks that came back flagged or failed. */
  flagged: OnboardingCheckKind[];
  /** Required checks that were clear but have since expired. */
  expired: OnboardingCheckKind[];
}

export function reviewReadiness(checks: CheckState[], now: number = Date.now()): Readiness {
  const byKind = new Map(checks.map((c) => [c.kind, c]));
  const notDone: OnboardingCheckKind[] = [];
  const flagged: OnboardingCheckKind[] = [];
  const expired: OnboardingCheckKind[] = [];
  for (const kind of REQUIRED_KINDS) {
    const c = byKind.get(kind);
    if (!c || c.status === "pending") notDone.push(kind);
    else if (c.status === "flagged" || c.status === "failed") flagged.push(kind);
    else if (!isClear(c, now)) expired.push(kind);
  }
  return { ready: !notDone.length && !flagged.length && !expired.length, notDone, flagged, expired };
}

const label = (kind: OnboardingCheckKind) => CHECK_KINDS.find((c) => c.kind === kind)?.label ?? kind;

/** Why an LP cannot be approved yet, or null when nothing stands in the way. */
export function approvalBlocker(readiness: Readiness): string | null {
  if (readiness.ready) return null;
  const parts: string[] = [];
  if (readiness.flagged.length) parts.push(`flagged: ${readiness.flagged.map(label).join(", ")}`);
  if (readiness.notDone.length) parts.push(`not done: ${readiness.notDone.map(label).join(", ")}`);
  if (readiness.expired.length) parts.push(`expired: ${readiness.expired.map(label).join(", ")}`);
  return `Can't approve yet. ${parts.join("; ")}.`;
}

export const SUMMARY_MAX = 500;
export const REASON_MAX = 2000;
export const EXPIRY_CHOICES_DAYS = [90, 180, 365] as const;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CheckInput {
  sessionId: string;
  kind: OnboardingCheckKind;
  status: OnboardingCheckStatus;
  summary: string | null;
  /** Days the clearance stays valid; null for no expiry. */
  validForDays: number | null;
}

const KINDS = new Set<string>(CHECK_KINDS.map((c) => c.kind));
const STATUSES = new Set<string>(["pending", "clear", "flagged", "failed"]);
const DECISIONS = new Set<string>(["approved", "rejected", "more_info"]);

export function validateCheckInput(raw: unknown): Validated<CheckInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || !r.sessionId) return { ok: false, error: "Choose an LP." };
  if (typeof r.kind !== "string" || !KINDS.has(r.kind)) return { ok: false, error: "Unknown check." };
  if (typeof r.status !== "string" || !STATUSES.has(r.status)) return { ok: false, error: "Unknown status." };
  const summary = typeof r.summary === "string" ? r.summary.trim() : "";
  if (summary.length > SUMMARY_MAX) return { ok: false, error: `Keep the note under ${SUMMARY_MAX} characters.` };
  let validForDays: number | null = null;
  if (r.validForDays != null) {
    const d = Number(r.validForDays);
    if (!Number.isInteger(d) || d < 1 || d > 3650) return { ok: false, error: "Choose a validity between 1 and 3650 days." };
    validForDays = d;
  }
  // A flagged or failed result with no note leaves the next reviewer guessing.
  if ((r.status === "flagged" || r.status === "failed") && !summary) {
    return { ok: false, error: "Say what was found. A flagged or failed check needs a note." };
  }
  return {
    ok: true,
    value: {
      sessionId: r.sessionId,
      kind: r.kind as OnboardingCheckKind,
      status: r.status as OnboardingCheckStatus,
      summary: summary || null,
      validForDays,
    },
  };
}

export interface DecisionInput {
  sessionId: string;
  decision: OnboardingDecisionKind;
  reason: string;
}

export function validateDecisionInput(raw: unknown): Validated<DecisionInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || !r.sessionId) return { ok: false, error: "Choose an LP." };
  if (typeof r.decision !== "string" || !DECISIONS.has(r.decision)) return { ok: false, error: "Choose a decision." };
  const reason = typeof r.reason === "string" ? r.reason.trim() : "";
  if (!reason) return { ok: false, error: "Give your reasoning. It is recorded with the decision." };
  if (reason.length > REASON_MAX) return { ok: false, error: `Keep the reasoning under ${REASON_MAX} characters.` };
  return { ok: true, value: { sessionId: r.sessionId, decision: r.decision as OnboardingDecisionKind, reason } };
}

/** One line for the activity log. Reads ids and statuses only. */
export function describeAudit(action: string, detail: unknown): string {
  const d = (detail ?? {}) as Record<string, unknown>;
  const kind = typeof d.kind === "string" ? label(d.kind as OnboardingCheckKind) : "";
  if (action === "check.recorded") return `${kind} check recorded as ${String(d.status ?? "")}`;
  if (action === "check.updated") return `${kind} check changed from ${String(d.from ?? "")} to ${String(d.to ?? "")}`;
  if (action === "decision.recorded") return `Decision recorded: ${String(d.decision ?? "").replace("_", " ")}`;
  return action;
}

/**
 * Which decisions the fund manager can record at each stage. The database holds
 * the same rule: approval and a request for more information need the LP to have
 * submitted, and an approved LP cannot be rejected afterwards. An LP who has not
 * submitted can still be turned down.
 */
export function availableDecisions(state: LpReviewState): OnboardingDecisionKind[] {
  if (state === "submitted") return ["approved", "rejected", "more_info"];
  if (state === "approved" || state === "rejected") return [];
  return ["rejected"];
}

/** What to tell the fund manager when no decision can be made yet. */
export function decisionStageNote(state: LpReviewState): string | null {
  switch (state) {
    case "not_started":
      return "The LP hasn't opened their link yet.";
    case "in_progress":
      return "The LP is still filling in the wizard. You can decide once they submit.";
    case "changes_requested":
      return "You asked the LP for more information. You can decide again once they resubmit.";
    case "approved":
      return "This LP is approved and can move on to the subscription documents.";
    case "rejected":
      return "This LP was turned down.";
    default:
      return null;
  }
}
