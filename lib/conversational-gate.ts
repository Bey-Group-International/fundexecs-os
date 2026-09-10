// Pre-flight credit gate for the conversational AI routes — chat, follow-up
// suggestions, clarifying questions, prompt-plan streaming, and meeting
// analysis. These call Claude directly, outside the task engine's per-step
// spendCredits gate (lib/engine.ts:793), so nothing previously bounded how
// much a single authenticated seat could spend by scripting requests against
// them: a scripted loop against /api/chat alone had no metering at all.
//
// Costs are flat, matching the codebase's existing per-agent step-cost
// convention (lib/agent-costs.ts) rather than trying to estimate real token
// usage — the goal is bounding spend, not exact accounting. Each is priced
// well below a full orchestrated workflow step (15-30 credits): these are
// single completions, not multi-step tool-dispatching agent runs.
import { spendCredits } from "@/lib/credits";
import { paywallFor } from "@/lib/paywall.server";
import type { PaywallPayload } from "@/lib/paywall";

export const CONVERSATIONAL_COST = {
  /** Earn's main conversational reply — streamed, with live DB context. */
  chat: 3,
  /** 2-3 short suggested follow-up prompts. */
  chatFollowups: 1,
  /** Up to 3 clarifying questions before committing to a plan. */
  clarify: 2,
  /** A full workflow plan (or split of plans) from a raw prompt. */
  promptPlan: 4,
  /** Full meeting-transcript analysis (summary, key points, action items). */
  meetingAnalyze: 5,
} as const;

/** Whether a real Claude call is possible right now. When false, every
 * conversational function in lib/claude.ts already degrades to a
 * deterministic fallback with zero real spend, so gating is a no-op. */
export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ConversationalGateResult {
  ok: boolean;
  status?: number;
  error?: string;
  /**
   * Present when the block is a paywall rather than an outage. Carries what the
   * client needs to resolve it in place — the shortfall, the plan to offer, and
   * whether one click can clear it — instead of sending someone off to a page.
   */
  paywall?: PaywallPayload;
}

/**
 * Debit `cost` credits before a route makes its Claude call. A no-op (always
 * ok) when Claude isn't configured — the route's own fallback path runs
 * instead, and nothing is actually spent. Mirrors the "Insufficient credits"
 * message lib/engine.ts's step execution already surfaces, so the UX is
 * consistent between the task engine and the conversational routes.
 */
export async function gateConversationalSpend(
  orgId: string,
  cost: number,
  label: string,
): Promise<ConversationalGateResult> {
  if (!anthropicConfigured()) return { ok: true };
  // spendCredits throws when the RPC itself fails (as opposed to a clean
  // insufficient-balance result). Fail closed with a retryable 503 here so no
  // calling route turns a transient DB error into an unmetered Claude call —
  // or an unhandled 500.
  let spent: Awaited<ReturnType<typeof spendCredits>>;
  try {
    spent = await spendCredits(orgId, cost, label);
  } catch (err) {
    console.error(`[conversational-gate] credit check failed (${label}):`, err);
    return {
      ok: false,
      status: 503,
      error: "Credit check unavailable — please try again shortly.",
    };
  }
  if (!spent.ok) {
    // Resolve the wall rather than just refusing: the caller renders it where
    // the action was blocked, so nobody loses their place to go and pay.
    //
    // Best-effort on purpose. The refusal is already decided by this point, and
    // a failure to look up the offer must not turn a clean 402 into a 500 — the
    // operator still gets told what they need, just without the one-click path.
    let paywall: PaywallPayload | undefined;
    try {
      paywall = (await paywallFor(orgId, cost)) ?? undefined;
    } catch (err) {
      console.error(`[conversational-gate] could not resolve the paywall (${label}):`, err);
    }
    return {
      ok: false,
      status: 402,
      error:
        paywall?.message ??
        // No wall to offer — a grandfathered org, which keeps the pre-existing
        // top-up flow. Name where that is: the engine's refusal already does
        // (lib/engine.ts:858), and a bare shortfall leaves someone with a
        // number and nowhere to go.
        `Insufficient credits: ${spent.balance ?? 0} available, ${cost} required. Top up on the Wallet page to continue.`,
      ...(paywall ? { paywall } : {}),
    };
  }
  return { ok: true };
}
