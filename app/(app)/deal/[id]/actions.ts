"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { recordConvictionSnapshot, computeDealConviction } from "@/lib/run-war-room";
import { shareDeal, type ShareDealResult } from "@/lib/deal-share.server";
import type {
  DiligenceItem,
  DiligenceStatus,
  RiskSeverity,
  IcDecisionKind,
} from "@/lib/supabase/database.types";

function text(formData: FormData, name: string): string | null {
  const v = String(formData.get(name) ?? "").trim();
  return v === "" ? null : v;
}

function num(formData: FormData, name: string): number | null {
  const v = String(formData.get(name) ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const SEVERITIES = new Set<RiskSeverity>(["low", "medium", "high", "critical"]);
const sev = (formData: FormData, name: string): RiskSeverity | null => {
  const v = text(formData, name);
  return v && SEVERITIES.has(v as RiskSeverity) ? (v as RiskSeverity) : null;
};

// Revalidate every surface a conviction change can show on.
function revalidateRun(dealId: string) {
  revalidatePath(`/deal/${dealId}`);
  revalidatePath("/run/diligence");
  revalidatePath("/run/underwriting");
  revalidatePath("/run/risk");
  revalidatePath("/run/strategy");
  revalidatePath("/run/stress_test");
}

// --- Share across the ecosystem --------------------------------------------

// Share a deal: Earn drafts the teaser memo, broadcasts to matched discoverable
// investors, and mints the tracked link. Returns the result so the client can
// show the memo + a copyable link; revalidates the deal page so any share state
// re-renders.
export async function shareDealAction(dealId: string): Promise<ShareDealResult> {
  const result = await shareDeal(dealId);
  if (result.ok) revalidatePath(`/deal/${dealId}`);
  return result;
}

// --- Diligence -------------------------------------------------------------
export async function addDiligenceItem(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const dealId = String(formData.get("deal_id") ?? "");
  const title = text(formData, "title");
  if (!dealId || !title) return;

  const supabase = createServerClient();
  await supabase.from("diligence_items").insert({
    organization_id: ctx.orgId,
    deal_id: dealId,
    title,
    category: text(formData, "category") ?? "general",
    status: (text(formData, "status") as DiligenceStatus | null) ?? "open",
    risk_severity: sev(formData, "risk_severity"),
    likelihood: sev(formData, "likelihood"),
  });

  await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateRun(dealId);
}

export async function updateDiligenceItem(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const dealId = String(formData.get("deal_id") ?? "");
  if (!id) return;

  const patch: Partial<
    Pick<DiligenceItem, "status" | "mitigation" | "residual_severity" | "likelihood">
  > = {};
  const status = text(formData, "status");
  if (status) patch.status = status as DiligenceStatus;
  if (formData.has("mitigation")) patch.mitigation = text(formData, "mitigation");
  if (formData.has("residual_severity")) patch.residual_severity = sev(formData, "residual_severity");
  if (formData.has("likelihood")) patch.likelihood = sev(formData, "likelihood");
  if (Object.keys(patch).length === 0) return;

  const supabase = createServerClient();
  await supabase
    .from("diligence_items")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (dealId) await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateRun(dealId);
}

// --- Underwriting ----------------------------------------------------------
export async function addUnderwriting(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const dealId = String(formData.get("deal_id") ?? "");
  if (!dealId) return;

  const supabase = createServerClient();
  await supabase.from("underwritings").insert({
    organization_id: ctx.orgId,
    deal_id: dealId,
    name: text(formData, "name") ?? "Case",
    scenario: text(formData, "scenario") ?? "base",
    projected_irr: num(formData, "projected_irr"),
    projected_moic: num(formData, "projected_moic"),
    equity_required: num(formData, "equity_required"),
  });

  await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateRun(dealId);
}

// --- IC decision -----------------------------------------------------------
// Stage transitions a recorded decision implies. A 'go' moves the deal to
// closing; a 'no_go' passes on it. Conditional / hold leave the deal where it is.
const DECISION_STAGE: Partial<Record<IcDecisionKind, string>> = {
  go: "closing",
  no_go: "passed",
};

export async function recordIcDecision(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const dealId = String(formData.get("deal_id") ?? "");
  const decision = String(formData.get("decision") ?? "") as IcDecisionKind;
  if (!dealId || !["go", "conditional", "hold", "no_go"].includes(decision)) return;

  const supabase = createServerClient();
  // Record the conviction at the moment of the call so the log stands alone.
  const conviction = await computeDealConviction(supabase, ctx.orgId, dealId);

  await supabase.from("ic_decisions").insert({
    organization_id: ctx.orgId,
    deal_id: dealId,
    decision,
    rationale: text(formData, "rationale"),
    conviction: conviction?.score ?? null,
    decided_by: ctx.userId,
  });

  const nextStage = DECISION_STAGE[decision];
  if (nextStage) {
    await supabase
      .from("deals")
      .update({ stage: nextStage as never })
      .eq("id", dealId)
      .eq("organization_id", ctx.orgId);
  }

  await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateRun(dealId);
}
