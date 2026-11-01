"use server";

// Run › Onboarding: recording a screening check and a GP decision on an LP.
// Both are owner/admin only. The organization comes from the session, the LP
// must belong to it, and the database enforces the same rule underneath (row
// level security plus a composite foreign key) so a stray id cannot reach
// another firm's LP. Every write is also logged by database triggers.
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { requireOrgAdmin } from "@/lib/rbac";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type { LpReviewState } from "@/lib/supabase/database.types";
import { refreshIdentityCheck } from "@/lib/lp-identity.server";
import { runOfacScreen } from "@/lib/ofac.server";
import { recordAudit } from "@/lib/lp-audit.server";
import { assessRisk, approvalRiskBlocker } from "@/lib/lp-risk";
import { decideCarryover, type DecideOutcome } from "@/lib/lp-reuse.server";
import {
  approvalBlocker,
  availableDecisions,
  decisionStageNote,
  reviewReadiness,
  validateCheckInput,
  validateDecisionInput,
  type CheckState,
} from "@/lib/onboarding-review";

export type OnboardingActionResult = { ok: true } | { ok: false; error: string };

const PAGE = "/run/onboarding";
const GENERIC = "Couldn't save. Try again.";

async function authorize() {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false as const, error: "Sign in again to continue." };
  const admin = requireOrgAdmin(auth.ctx.role);
  if (!admin.ok) return { ok: false as const, error: "Only organization owners and admins can review LPs." };
  return { ok: true as const, ctx: auth.ctx };
}

/** The LP's review stage, if the LP is one of this organization's. */
async function sessionStage(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  sessionId: string,
  orgId: string,
): Promise<LpReviewState | null> {
  const { data } = await supabase
    .from("lp_onboarding_sessions")
    .select("review_state")
    .eq("id", sessionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as { review_state: LpReviewState } | null)?.review_state ?? null;
}

export async function recordOnboardingCheck(input: unknown): Promise<OnboardingActionResult> {
  const who = await authorize();
  if (!who.ok) return who;
  const parsed = validateCheckInput(input);
  if (!parsed.ok) return parsed;
  const { sessionId, kind, status, summary, validForDays } = parsed.value;

  try {
    const supabase = await createServerClient();
    if (!(await sessionStage(supabase, sessionId, who.ctx.orgId))) {
      return { ok: false, error: "That LP wasn't found." };
    }
    const now = Date.now();
    const done = status !== "pending";
    const { error } = await supabase.from("onboarding_checks").upsert(
      {
        organization_id: who.ctx.orgId,
        session_id: sessionId,
        kind,
        status,
        method: "manual",
        summary,
        checked_at: done ? new Date(now).toISOString() : null,
        // An expiry only means something on a clearance.
        expires_at: status === "clear" && validForDays ? new Date(now + validForDays * 86_400_000).toISOString() : null,
        recorded_by: who.ctx.userId,
      } as never,
      { onConflict: "session_id,kind" },
    );
    if (error) {
      console.error("recordOnboardingCheck failed", { code: error.code, message: error.message });
      return { ok: false, error: GENERIC };
    }
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    console.error("recordOnboardingCheck threw", err);
    return { ok: false, error: GENERIC };
  }
}

/** The risk tier of an LP, from what is stored for them. */
async function assessStoredRisk(supabase: Awaited<ReturnType<typeof createServerClient>>, sessionId: string, orgId: string) {
  const [{ data: session }, { data: profile }, { data: owners }, { data: checks }] = await Promise.all([
    supabase.from("lp_onboarding_sessions").select("lp_type, owner_threshold_pct").eq("id", sessionId).eq("organization_id", orgId).maybeSingle(),
    supabase.from("lp_onboarding_profiles").select("entity_type, country").eq("session_id", sessionId).eq("organization_id", orgId).maybeSingle(),
    supabase.from("lp_onboarding_owners").select("role, ownership_pct, country").eq("session_id", sessionId).eq("organization_id", orgId),
    supabase.from("onboarding_checks").select("kind, status, method").eq("session_id", sessionId).eq("organization_id", orgId),
  ]);
  const s = (session ?? {}) as { lp_type?: string; owner_threshold_pct?: number };
  const p = (profile ?? {}) as { entity_type?: string | null; country?: string | null };
  return assessRisk({
    lpType: s.lp_type,
    entityType: p.entity_type,
    country: p.country,
    ownerThresholdPct: s.owner_threshold_pct,
    owners: ((owners ?? []) as Array<{ role?: string; ownership_pct?: number | null; country?: string | null }>).map((o) => ({
      role: String(o.role ?? ""),
      ownershipPct: o.ownership_pct,
      country: o.country,
    })),
    checks: ((checks ?? []) as Array<{ kind: never; status: never; method?: string | null }>).filter((c) => c && c.kind),
  });
}

export async function recordOnboardingDecision(input: unknown): Promise<OnboardingActionResult> {
  const who = await authorize();
  if (!who.ok) return who;
  const parsed = validateDecisionInput(input);
  if (!parsed.ok) return parsed;
  const { sessionId, decision, reason } = parsed.value;

  try {
    const supabase = await createServerClient();
    const stage = await sessionStage(supabase, sessionId, who.ctx.orgId);
    if (!stage) return { ok: false, error: "That LP wasn't found." };
    if (!availableDecisions(stage).includes(decision)) {
      return { ok: false, error: decisionStageNote(stage) ?? "That decision isn't available right now." };
    }

    // The screen explains this rule; this is where it is enforced.
    if (decision === "approved") {
      const { data, error } = await supabase
        .from("onboarding_checks")
        .select("kind, status, expires_at")
        .eq("session_id", sessionId)
        .eq("organization_id", who.ctx.orgId);
      if (error) {
        console.error("recordOnboardingDecision check read failed", { code: error.code, message: error.message });
        return { ok: false, error: GENERIC };
      }
      const blocker = approvalBlocker(reviewReadiness((data ?? []) as CheckState[]));
      if (blocker) return { ok: false, error: blocker };

      // Risk-based routing: a riskier LP needs a more careful approval. Assessed here from the
      // stored answers and checks, never from anything the browser sends.
      const risk = await assessStoredRisk(supabase, sessionId, who.ctx.orgId);
      const riskBlocker = approvalRiskBlocker(risk, who.ctx.role, reason);
      if (riskBlocker) return { ok: false, error: riskBlocker };
      if (risk.tier !== "low" && hasSupabaseServiceEnv()) {
        await recordAudit(createServiceClient(), {
          orgId: who.ctx.orgId,
          sessionId,
          action: "risk.assessed",
          actorKind: "user",
          actorId: who.ctx.userId,
          detail: { tier: risk.tier, factors: risk.factors.length },
        });
      }
    }

    const { error } = await supabase.from("onboarding_decisions").insert({
      organization_id: who.ctx.orgId,
      session_id: sessionId,
      decision,
      reason,
      decided_by: who.ctx.userId,
    } as never);
    if (error) {
      console.error("recordOnboardingDecision failed", { code: error.code, message: error.message });
      return { ok: false, error: GENERIC };
    }
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    console.error("recordOnboardingDecision threw", err);
    return { ok: false, error: GENERIC };
  }
}

/**
 * Asks Stripe where an LP's ID verification stands and records it. The LP's own
 * return to their link does the same; this is for when they finished and left.
 */
export async function refreshIdentityCheckAction(sessionId: unknown): Promise<OnboardingActionResult & { verified?: boolean }> {
  const who = await authorize();
  if (!who.ok) return who;
  if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "That LP wasn't found." };
  try {
    const supabase = await createServerClient();
    if (!(await sessionStage(supabase, sessionId, who.ctx.orgId))) return { ok: false, error: "That LP wasn't found." };
    // The result is recorded by the system, not as this person: the checks table
    // only lets a signed-in user write rows stamped with their own id. So the
    // write goes through the service role, after the checks above, scoped to this
    // organization.
    if (!hasSupabaseServiceEnv()) return { ok: false, error: GENERIC };
    const service = createServiceClient();
    const res = await refreshIdentityCheck(service, sessionId, who.ctx.orgId);
    if (!res.ok) return res;
    // The result row carries no person (see above), so who asked is recorded here.
    await recordAudit(service, {
      orgId: who.ctx.orgId,
      sessionId,
      action: "check.refreshed",
      actorKind: "user",
      actorId: who.ctx.userId,
      detail: { state: res.state },
    });
    revalidatePath(PAGE);
    return { ok: true, verified: res.state === "verified" };
  } catch (err) {
    console.error("refreshIdentityCheckAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

/**
 * Runs the first-pass OFAC screen for an LP: their name, their signatory and
 * everyone they listed. It flags a possible match on the sanctions check and
 * never clears it. The automatic screen on submission can be repeated here, for
 * example after the LP changes their answers or the list is updated.
 */
export async function runOfacScreenAction(
  sessionId: unknown,
): Promise<OnboardingActionResult & { flagged?: number; screened?: number; wrote?: boolean }> {
  const who = await authorize();
  if (!who.ok) return who;
  if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "That LP wasn't found." };
  try {
    const supabase = await createServerClient();
    if (!(await sessionStage(supabase, sessionId, who.ctx.orgId))) return { ok: false, error: "That LP wasn't found." };
    // Recorded by the system, not as this person (the checks table only lets a
    // signed-in user write rows stamped with their own id), so the write goes
    // through the service role, after the checks above, scoped to this organization.
    if (!hasSupabaseServiceEnv()) return { ok: false, error: GENERIC };
    const res = await runOfacScreen(createServiceClient(), sessionId, who.ctx.orgId, { actor: { kind: "user", id: who.ctx.userId } });
    if (!res.ok) return res;
    revalidatePath(PAGE);
    return { ok: true, flagged: res.flagged, screened: res.screened, wrote: res.wrote };
  } catch (err) {
    console.error("runOfacScreenAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

const CARRYOVER_MESSAGE: Record<DecideOutcome, { ok: boolean; text: string }> = {
  confirmed: { ok: true, text: "Confirmed. The earlier ID check now counts, dated as it was." },
  declined: { ok: true, text: "Declined. The LP will verify their ID again." },
  not_found: { ok: false, text: "There is nothing waiting to confirm for this LP." },
  expired: { ok: false, text: "That earlier ID check has expired, so it can't be reused. The LP will verify again." },
  already_has_check: { ok: false, text: "This LP already has an ID check of their own, so the earlier one wasn't needed." },
  error: { ok: false, text: GENERIC },
};

/**
 * A returning LP's earlier ID check is only a proposal until a person confirms it
 * is the same individual (SOC 2 gap G-9). Owner/admin only; the LP must be this
 * organization's. Confirming writes the clear check; declining leaves the LP to
 * verify for themselves. Either way it is recorded in the activity log.
 */
export async function decideCarryoverAction(sessionId: unknown, decision: unknown): Promise<{ ok: boolean; message: string }> {
  const who = await authorize();
  if (!who.ok) return { ok: false, message: who.error };
  if (typeof sessionId !== "string" || !sessionId) return { ok: false, message: "That LP wasn't found." };
  if (decision !== "confirm" && decision !== "decline") return { ok: false, message: GENERIC };
  try {
    const supabase = await createServerClient();
    if (!(await sessionStage(supabase, sessionId, who.ctx.orgId))) return { ok: false, message: "That LP wasn't found." };
    if (!hasSupabaseServiceEnv()) return { ok: false, message: GENERIC };
    const service = createServiceClient();
    const outcome = await decideCarryover(service, { orgId: who.ctx.orgId, sessionId, decision, actorId: who.ctx.userId });
    if (outcome === "confirmed" || outcome === "declined") {
      await recordAudit(service, {
        orgId: who.ctx.orgId,
        sessionId,
        action: outcome === "confirmed" ? "carryover.confirmed" : "carryover.declined",
        actorKind: "user",
        actorId: who.ctx.userId,
        detail: { kind: "identity" },
      });
      revalidatePath(PAGE);
    }
    const m = CARRYOVER_MESSAGE[outcome];
    return { ok: m.ok, message: m.text };
  } catch (err) {
    console.error("decideCarryoverAction threw", err);
    return { ok: false, message: GENERIC };
  }
}
