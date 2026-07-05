// lib/proactive/items.ts
// Persistence for proactive_commands — the surfaced items and their verdicts.
// The table is new, so (like lib/source-cache.ts) it isn't in the generated DB
// types yet; we access it through a narrow unknown-cast helper until types are
// regenerated. All reads/writes are explicitly org-scoped.

import type { createServiceClient } from "@/lib/supabase/server";
import type {
  ProactiveItem,
  ProactiveVerdict,
  ProvenancedClaim,
} from "./types";

// Accept either server (RLS) or service client — structurally identical.
type Db = ReturnType<typeof createServiceClient>;

// The table isn't in the generated DB types yet, so we reach it through a narrow
// cast (same pattern as lib/source-cache.ts). The query-builder shape is
// intentionally loose here — every call site narrows the row types it reads.
function pc(supabase: Db) {
  return (supabase as unknown as {
    from: (t: string) => ReturnType<Db["from"]>;
  }).from("proactive_commands");
}

interface Row {
  id: string;
  trigger_key: string;
  hub: string;
  signal_class: string;
  subject_name: string;
  title: string;
  rationale: string | null;
  urgency: number;
  confidence: number;
  blast_radius: number;
  priority: number;
  status: string;
  workflow_id: string | null;
  draft_artifact_id: string | null;
  send_action: string;
  claims: unknown;
  snooze_until: string | null;
  created_at: string;
}

function rowToItem(r: Row): ProactiveItem {
  return {
    id: r.id,
    triggerKey: r.trigger_key,
    hub: r.hub as ProactiveItem["hub"],
    signalClass: r.signal_class as ProactiveItem["signalClass"],
    subjectName: r.subject_name,
    title: r.title,
    rationale: r.rationale ?? "",
    urgency: r.urgency,
    confidence: r.confidence,
    blastRadius: (r.blast_radius as ProactiveItem["blastRadius"]) ?? 2,
    priority: r.priority,
    status: r.status as ProactiveItem["status"],
    workflowId: r.workflow_id,
    draftArtifactId: r.draft_artifact_id,
    sendAction: r.send_action as ProactiveItem["sendAction"],
    claims: Array.isArray(r.claims) ? (r.claims as ProvenancedClaim[]) : [],
    snoozeUntil: r.snooze_until,
    createdAt: r.created_at,
  };
}

/** The live proactive feed for the Report dashboard — surfaced items, ranked. */
export async function listSurfacedItems(supabase: Db, orgId: string): Promise<ProactiveItem[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await pc(supabase)
    .select("*")
    .eq("organization_id", orgId)
    // surfaced, plus snoozed items whose snooze has elapsed.
    .or(`status.eq.surfaced,and(status.eq.snoozed,snooze_until.lte.${nowIso})`)
    .order("priority", { ascending: false })
    .limit(25);
  if (error || !data) return [];
  return (data as Row[]).map(rowToItem);
}

/** Count of items awaiting the operator — the Earn-level badge count. */
export async function countSurfacedItems(supabase: Db, orgId: string): Promise<number> {
  const { count, error } = await pc(supabase)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "surfaced");
  if (error || count == null) return 0;
  return count;
}

/** True when this (trigger, subject) already has an open item — de-dup guard. */
export async function hasOpenItem(
  supabase: Db,
  orgId: string,
  triggerKey: string,
  subjectId: string | null,
): Promise<boolean> {
  let q = pc(supabase)
    .select("id", { head: true, count: "exact" })
    .eq("organization_id", orgId)
    .eq("trigger_key", triggerKey)
    .in("status", ["surfaced", "snoozed"]);
  q = subjectId ? q.eq("subject_id", subjectId) : q.is("subject_id", null);
  const { count, error } = await q;
  return !error && (count ?? 0) > 0;
}

export interface InsertItemInput {
  triggerKey: string;
  hub: string;
  signalClass: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectName: string;
  title: string;
  rationale: string;
  urgency: number;
  confidence: number;
  blastRadius: number;
  priority: number;
  workflowId: string | null;
  draftArtifactId: string | null;
  sendAction: string;
  claims: ProvenancedClaim[];
}

export async function insertItem(
  supabase: Db,
  orgId: string,
  input: InsertItemInput,
): Promise<string | null> {
  const { data, error } = await pc(supabase)
    .insert({
      organization_id: orgId,
      trigger_key: input.triggerKey,
      hub: input.hub,
      signal_class: input.signalClass,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      subject_name: input.subjectName,
      title: input.title,
      rationale: input.rationale,
      urgency: input.urgency,
      confidence: input.confidence,
      blast_radius: input.blastRadius,
      priority: input.priority,
      status: "surfaced",
      workflow_id: input.workflowId,
      draft_artifact_id: input.draftArtifactId,
      send_action: input.sendAction,
      claims: input.claims as unknown,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/**
 * Record the operator's verdict — the training signal. approve/dismiss/snooze
 * transitions the item and stamps the decider. Snooze parks it until a later
 * time (default 7 days) so it can re-surface if still relevant.
 */
export async function recordDecision(
  supabase: Db,
  orgId: string,
  itemId: string,
  verdict: ProactiveVerdict,
  actorId: string,
  snoozeDays = 7,
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: verdict === "approved" ? "approved" : verdict === "dismissed" ? "dismissed" : "snoozed",
    decided_by: actorId,
    decided_at: new Date().toISOString(),
  };
  if (verdict === "snoozed") {
    patch.snooze_until = new Date(Date.now() + snoozeDays * 86_400_000).toISOString();
  }
  const { error } = await pc(supabase)
    .update(patch)
    .eq("organization_id", orgId)
    .eq("id", itemId);
  return !error;
}

/** Decision history for the learn loop — (trigger, verdict) pairs. */
export async function loadDecisionHistory(
  supabase: Db,
  orgId: string,
): Promise<Array<{ triggerKey: string; verdict: ProactiveVerdict }>> {
  const { data, error } = await pc(supabase)
    .select("trigger_key, status")
    .eq("organization_id", orgId)
    .in("status", ["approved", "dismissed", "snoozed"])
    .limit(500);
  if (error || !data) return [];
  const out: Array<{ triggerKey: string; verdict: ProactiveVerdict }> = [];
  for (const r of data as Array<{ trigger_key: string; status: string }>) {
    const verdict = r.status as ProactiveVerdict;
    if (verdict === "approved" || verdict === "dismissed" || verdict === "snoozed") {
      out.push({ triggerKey: r.trigger_key, verdict });
    }
  }
  return out;
}
