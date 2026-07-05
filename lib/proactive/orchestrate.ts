// lib/proactive/orchestrate.ts
// The pipeline: Signal → Trigger → Prioritize → Propose(Command) → Plan+Draft →
// (persist for) Surface → Gate → Learn. This is the glue that runs one org's
// proactive sweep end-to-end, reusing the existing loop and gates rather than
// duplicating them:
//
//   - triggers detect + enrich (PMI) candidates            (triggers/*)
//   - the gate sizes each candidate's blast radius          (gate.ts, gates.ts)
//   - the prioritizer enforces the trust budget             (prioritize.ts)
//   - runAutomation authors the Command + pre-runs the draft (engine.ts)
//   - the draft artifact + provenance are persisted to surface (items.ts)
//
// Server-only (imports the engine + service client). Best-effort throughout: a
// single trigger or candidate failure never aborts the sweep.

import { createServiceClient } from "@/lib/supabase/server";
import { runAutomation } from "@/lib/engine";
import { enabledTriggers } from "./triggers/registry";
import type { EnrichedSignal } from "./triggers/types";
import { resolveProactiveGate } from "./gate";
import { prioritize, type ScoredInput } from "./prioritize";
import { learnedWeights } from "./learn";
import { loadDecisionHistory, hasOpenItem, insertItem } from "./items";
import { PROACTIVE_ENABLED } from "./config";
import type { ProactiveCandidate } from "./types";

type Db = ReturnType<typeof createServiceClient>;

export interface SweepResult {
  orgId: string;
  detected: number;
  surfaced: number;
  suppressed: number;
  errors: string[];
}

/** Resolve a principal to attribute the authored Commands to (an org owner/admin). */
async function resolveOrgActor(supabase: Db, orgId: string): Promise<string | null> {
  const { data } = await supabase
    .from("organization_members")
    .select("principal_id, role")
    .eq("organization_id", orgId)
    .in("role", ["owner", "admin"])
    .limit(1);
  const row = (data ?? [])[0] as { principal_id?: string } | undefined;
  return row?.principal_id ?? null;
}

/**
 * Run the proactive sweep for one org. Detects across enabled triggers,
 * prioritizes against the trust budget, and for each surfaced candidate authors
 * a draft-only Command and persists the finished item for the dashboard.
 */
export async function runProactiveSweep(
  orgId: string,
  opts: { supabase?: Db; actorId?: string } = {},
): Promise<SweepResult> {
  const result: SweepResult = { orgId, detected: 0, surfaced: 0, suppressed: 0, errors: [] };
  if (!PROACTIVE_ENABLED) {
    result.errors.push("Proactive layer disabled (PROACTIVE_INITIATIVE_ENABLED != true).");
    return result;
  }

  let supabase: Db;
  try {
    supabase = opts.supabase ?? createServiceClient();
  } catch (e) {
    result.errors.push(`No service client: ${e instanceof Error ? e.message : "unknown"}`);
    return result;
  }

  const actorId = opts.actorId ?? (await resolveOrgActor(supabase, orgId));
  if (!actorId) {
    result.errors.push("No owner/admin principal to attribute Commands to.");
    return result;
  }

  // Learn: fold the operator's past verdicts into per-trigger weights.
  const weights = learnedWeights(await loadDecisionHistory(supabase, orgId));

  // Detect + enrich → build scored inputs. Each candidate is gated first so the
  // prioritizer scores against the real blast radius.
  const scored: ScoredInput[] = [];
  for (const trigger of enabledTriggers()) {
    let signals;
    try {
      signals = await trigger.detect({ supabase, orgId });
    } catch (e) {
      result.errors.push(`${trigger.key} detect: ${e instanceof Error ? e.message : "err"}`);
      continue;
    }
    result.detected += signals.length;

    for (const signal of signals) {
      try {
        const enriched: EnrichedSignal = await trigger.enrich({ supabase, orgId }, signal);
        const { objective, title } = trigger.compose(enriched);
        const candidate: ProactiveCandidate = {
          signal: enriched.signal,
          sendAction: trigger.sendAction,
          claims: enriched.claims,
          objective,
          title,
        };
        const gate = resolveProactiveGate(candidate);
        scored.push({
          candidate,
          urgency: enriched.urgency,
          confidence: enriched.confidence,
          blastRadius: gate.sendTier,
          learnedWeight: weights[trigger.key] ?? 1.0,
        });
      } catch (e) {
        result.errors.push(`${trigger.key} enrich: ${e instanceof Error ? e.message : "err"}`);
      }
    }
  }

  // Prioritize: enforce the trust budget (per-hub cutoffs + ceilings).
  const { surfaced } = prioritize(scored);
  result.suppressed = scored.length - surfaced.length;

  // Propose + draft + persist each surfaced candidate.
  for (const ranked of surfaced) {
    const { candidate } = ranked;
    const sig = candidate.signal;
    try {
      if (await hasOpenItem(supabase, orgId, sig.triggerKey, sig.subjectId)) {
        continue; // already surfaced/snoozed for this subject — don't duplicate
      }

      // Author the Command and pre-run the draft-only workstream. The objective
      // is explicitly draft-only ("do not send"), so auto-approving runs only
      // the drafting — the outward SEND stays the gated decision on this item.
      const automationId = await createProactiveAutomation(supabase, orgId, actorId, candidate.objective);
      const run = automationId
        ? await runAutomation({ supabase, orgId, actorId }, {
            id: automationId,
            prompt: candidate.objective,
            auto_approve: true,
          })
        : null;

      const draftArtifactId = run?.workflowId
        ? await latestArtifactForWorkflow(supabase, orgId, run.workflowId)
        : null;

      const rationale = [sig.summary, ...candidate.claims.map((c) => `${c.claim} (${c.source}, as of ${c.asOf.slice(0, 10)})`)]
        .join(" ");

      const id = await insertItem(supabase, orgId, {
        triggerKey: sig.triggerKey,
        hub: sig.hub,
        signalClass: sig.signalClass,
        subjectType: sig.subjectType,
        subjectId: sig.subjectId,
        subjectName: sig.subjectName,
        title: candidate.title,
        rationale,
        urgency: ranked.urgency,
        confidence: ranked.confidence,
        blastRadius: ranked.blastRadius,
        priority: ranked.priority,
        workflowId: run?.workflowId ?? null,
        draftArtifactId,
        sendAction: candidate.sendAction,
        claims: candidate.claims,
      });
      if (id) result.surfaced += 1;
    } catch (e) {
      result.errors.push(`propose ${sig.triggerKey}: ${e instanceof Error ? e.message : "err"}`);
    }
  }

  return result;
}

/**
 * Create the automations row the authored Command links to (tasks/sessions FK to
 * automations). trigger_type 'event' + enabled false keeps it OUT of the
 * scheduled cron sweep — it exists only as the provenance anchor for this run.
 */
async function createProactiveAutomation(
  supabase: Db,
  orgId: string,
  actorId: string,
  prompt: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("automations")
    .insert({
      organization_id: orgId,
      prompt,
      trigger_type: "event",
      auto_approve: true,
      enabled: false,
      created_by: actorId,
    } as never)
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/** The pre-run draft is the workflow's latest artifact. */
async function latestArtifactForWorkflow(
  supabase: Db,
  orgId: string,
  workflowId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("artifacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as { id?: string } | undefined;
  return row?.id ?? null;
}

/** Sweep every org that has proactive enabled (called by cron). */
export async function runProactiveSweepAllOrgs(
  supabase: Db,
  opts: { maxOrgs?: number } = {},
): Promise<{ orgs: number; surfaced: number }> {
  const summary = { orgs: 0, surfaced: 0 };
  if (!PROACTIVE_ENABLED) return summary;

  // Orgs with at least one cold-LP-style signal are the candidates worth sweeping.
  const { data } = await supabase
    .from("relationship_scores")
    .select("organization_id")
    .eq("decay_alert", true)
    .limit(500);
  const orgIds = Array.from(
    new Set(
      (data ?? []).map((r: unknown) => (r as { organization_id: string }).organization_id),
    ),
  ).slice(0, opts.maxOrgs ?? 10);

  for (const orgId of orgIds) {
    try {
      const r = await runProactiveSweep(orgId, { supabase });
      summary.orgs += 1;
      summary.surfaced += r.surfaced;
    } catch {
      // best-effort per org
    }
  }
  return summary;
}
