"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { handlePrompt, decideApproval } from "@/lib/engine";
import { getActiveMandate } from "@/lib/mandates";
import type { Mandate } from "@/lib/gates";
import {
  copilotContextFromPath,
  contextPreamble,
  suggestionsFor,
  willAutoRun,
  type CopilotContext,
  type CopilotSuggestion,
} from "@/lib/copilot";
import { getBuildReadiness } from "@/lib/build-readiness";
import { getRunConviction } from "@/lib/run-conviction";
import { getSourceMomentum } from "@/lib/source-readiness";
import { getExecutePerformance } from "@/lib/execute-performance";
import type { AgentKey } from "@/lib/supabase/database.types";

export interface AskEarnResult {
  ok: boolean;
  sessionId?: string;
  planTitle?: string;
  steps?: { agent: AgentKey; title: string }[];
  error?: string;
}

// Plan a free-form ask against the operator's current location. Returns a
// summary of the routed plan (which specialists Earn delegated to) for inline
// display in the dock, with a deep link into the full session. The standing
// approval loop still gates any outward action the plan proposes.
export async function askEarn(input: {
  body: string;
  pathname: string;
  /** When set, the ask continues this session as a multi-turn conversation. */
  sessionId?: string;
}): Promise<AskEarnResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

  const body = input.body.trim();
  if (!body) return { ok: false, error: "Ask Earn something first." };

  const location = copilotContextFromPath(input.pathname);
  const supabase = createServerClient();
  try {
    const result = await handlePrompt(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      `${contextPreamble(location)} ${body}`,
      input.sessionId,
    );
    return {
      ok: true,
      sessionId: result.session_id,
      planTitle: result.plan.title,
      steps: result.plan.steps.map((s) => ({ agent: s.agent, title: s.title })),
    };
  } catch {
    return { ok: false, error: "Earn couldn't plan that just now. Try again." };
  }
}

/** Resolve a suggestion by id within a given location. */
function findSuggestion(loc: CopilotContext, id: string): CopilotSuggestion | null {
  return suggestionsFor(loc).find((s) => s.id === id) ?? null;
}

/** The org's active standing mandate, for showing what Earn may auto-run. */
export async function getMandateSummary(): Promise<Mandate | null> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;
  const supabase = createServerClient();
  return (await getActiveMandate(supabase, ctx.orgId)) ?? null;
}

// Launch a pre-baked, context-aware suggestion. Plans the templated prompt,
// then — when the standing mandate authorizes it (internal Tier-1 work, or a
// Tier-2 action pre-approved within the ceiling) — auto-approves and runs the
// workflow proactively. Otherwise it lands in the session awaiting the
// operator's sign-off. Either way, opens the session.
export async function launchCopilotSuggestion(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  const pathname = String(formData.get("pathname") ?? "/");
  const id = String(formData.get("suggestion_id") ?? "");
  const loc = copilotContextFromPath(pathname);
  const suggestion = findSuggestion(loc, id);
  if (!suggestion) redirect("/workspace");

  const supabase = createServerClient();
  const engineCtx = { supabase, orgId: ctx.orgId, actorId: ctx.userId };
  const result = await handlePrompt(engineCtx, `${contextPreamble(loc)} ${suggestion.prompt}`);

  // Proactive execution — gated by the standing mandate, never above Tier 2.
  if (result.approval_id) {
    const mandate = await getActiveMandate(supabase, ctx.orgId);
    if (willAutoRun(suggestion, mandate)) {
      try {
        await decideApproval(engineCtx, { approvalId: result.approval_id, decision: "approved" });
      } catch {
        // If auto-execution fails, the workflow simply remains awaiting approval.
      }
    }
  }

  redirect(result.session_id ? `/session/${result.session_id}` : "/workspace");
}

// --- Live briefing ---------------------------------------------------------
export interface BriefingStat {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}
export interface CopilotBriefing {
  headline: string;
  stats: BriefingStat[];
  nextAction: { label: string; prompt: string } | null;
}

/** Format a 0–100 score as a rounded percentage string. */
function pct(n: number): string {
  return `${Math.round(n)}%`;
}

// Read the firm's live state for the operator's current hub and distill it into
// a one-line headline, a few signal chips, and the single next-best action —
// reusing the same readiness/conviction/performance engines the hub pages do.
export async function getCopilotBriefing(pathname: string): Promise<CopilotBriefing | null> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;
  const hub = copilotContextFromPath(pathname).hub;
  const orgId = ctx.orgId;

  try {
    if (hub === "build") {
      const r = await getBuildReadiness(orgId);
      return {
        headline: `${pct(r.overall)} foundation · ${r.stage.label}`,
        stats: [{ label: "Readiness", value: pct(r.overall), tone: r.overall >= 85 ? "good" : "warn" }],
        nextAction: r.nextAction
          ? { label: r.nextAction.label, prompt: `Help me with this next step and draft it: ${r.nextAction.label}` }
          : null,
      };
    }

    if (hub === "run") {
      const r = await getRunConviction(orgId);
      const b = r.benchmark;
      return {
        headline: b.dealsInEval
          ? `${b.dealsInEval} ${b.dealsInEval === 1 ? "deal" : "deals"} in evaluation · ${pct(r.overall)} conviction`
          : "No deals in evaluation yet",
        stats: [
          { label: "Conviction", value: pct(r.overall), tone: r.overall >= 65 ? "good" : "warn" },
          { label: "IC-ready", value: String(b.icReadyCount), tone: b.icReadyCount > 0 ? "good" : undefined },
          {
            label: "Open critical risk",
            value: String(b.openCriticalRisks),
            tone: b.openCriticalRisks === 0 ? "good" : "bad",
          },
        ],
        nextAction: r.nextAction
          ? { label: r.nextAction.label, prompt: `Help me take the next step on ${r.nextAction.dealName}: ${r.nextAction.label}` }
          : null,
      };
    }

    if (hub === "source") {
      const r = await getSourceMomentum(orgId);
      return {
        headline: `${pct(r.overall)} raise readiness · ${r.stage.label}`,
        stats: [{ label: "Raise readiness", value: pct(r.overall), tone: r.overall >= 65 ? "good" : "warn" }],
        nextAction: r.nextAction
          ? { label: r.nextAction.label, prompt: `Help me with this next step on the raise: ${r.nextAction.label}` }
          : null,
      };
    }

    if (hub === "execute") {
      const r = await getExecutePerformance(orgId);
      const hero = r.heroMultiple != null ? `${r.heroMultiple.toFixed(2)}x ${r.heroLabel}` : "No marks yet";
      return {
        headline: `${r.stage.label} · ${hero}`,
        stats: [
          { label: r.heroLabel, value: r.heroMultiple != null ? `${r.heroMultiple.toFixed(2)}x` : "—" },
          { label: "Active assets", value: String(r.activeAssets) },
        ],
        nextAction: r.nextAction
          ? { label: r.nextAction.label, prompt: `Help me with this portfolio step: ${r.nextAction.label}` }
          : null,
      };
    }

    // Off-hub (dashboard/workspace): a cross-hub one-liner from the two
    // strongest signals.
    const [build, run] = await Promise.all([getBuildReadiness(orgId), getRunConviction(orgId)]);
    return {
      headline: `${pct(build.overall)} foundation · ${run.benchmark.dealsInEval} in evaluation`,
      stats: [
        { label: "Foundation", value: pct(build.overall) },
        { label: "Conviction", value: pct(run.overall) },
      ],
      nextAction: run.nextAction
        ? { label: run.nextAction.label, prompt: `What's the highest-leverage thing to do next? Specifically: ${run.nextAction.label}` }
        : build.nextAction
          ? { label: build.nextAction.label, prompt: `Help me with this next step: ${build.nextAction.label}` }
          : null,
    };
  } catch {
    return null;
  }
}
