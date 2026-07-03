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
export interface ActionResult {
  ok: boolean;
  error?: string;
}

// Each of these used to be `Promise<void>` with its Supabase write unchecked —
// a failed insert/update looked identical to success in the UI, since the
// calling `<form action={...}>` had no way to surface a return value anyway.
// They now return {ok, error}, and their call sites use the shared
// ActionForm wrapper (components/shared/ActionForm.tsx) to show a failure
// inline instead of silently doing nothing.
export async function addDiligenceItem(formData: FormData): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const dealId = String(formData.get("deal_id") ?? "");
  const title = text(formData, "title");
  if (!dealId || !title) return { ok: false, error: "Choose a deal and enter a title." };

  const supabase = createServerClient();
  const { error } = await supabase.from("diligence_items").insert({
    organization_id: ctx.orgId,
    deal_id: dealId,
    title,
    category: text(formData, "category") ?? "general",
    status: (text(formData, "status") as DiligenceStatus | null) ?? "open",
    risk_severity: sev(formData, "risk_severity"),
    likelihood: sev(formData, "likelihood"),
  });
  if (error) return { ok: false, error: error.message };

  await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateRun(dealId);
  return { ok: true };
}

export async function updateDiligenceItem(formData: FormData): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const id = String(formData.get("id") ?? "");
  const dealId = String(formData.get("deal_id") ?? "");
  if (!id) return { ok: false, error: "Missing diligence item." };

  const patch: Partial<
    Pick<DiligenceItem, "status" | "mitigation" | "residual_severity" | "likelihood">
  > = {};
  const status = text(formData, "status");
  if (status) patch.status = status as DiligenceStatus;
  if (formData.has("mitigation")) patch.mitigation = text(formData, "mitigation");
  if (formData.has("residual_severity")) patch.residual_severity = sev(formData, "residual_severity");
  if (formData.has("likelihood")) patch.likelihood = sev(formData, "likelihood");
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = createServerClient();
  const { error } = await supabase
    .from("diligence_items")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  if (dealId) await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateRun(dealId);
  return { ok: true };
}

// --- Underwriting ----------------------------------------------------------
export async function addUnderwriting(formData: FormData): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const dealId = String(formData.get("deal_id") ?? "");
  if (!dealId) return { ok: false, error: "Choose a deal." };

  const supabase = createServerClient();
  const { error } = await supabase.from("underwritings").insert({
    organization_id: ctx.orgId,
    deal_id: dealId,
    name: text(formData, "name") ?? "Case",
    scenario: text(formData, "scenario") ?? "base",
    projected_irr: num(formData, "projected_irr"),
    projected_moic: num(formData, "projected_moic"),
    equity_required: num(formData, "equity_required"),
  });
  if (error) return { ok: false, error: error.message };

  await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateRun(dealId);
  return { ok: true };
}

// --- IC decision -----------------------------------------------------------
// Stage transitions a recorded decision implies. A 'go' moves the deal to
// closing; a 'no_go' passes on it. Conditional / hold leave the deal where it is.
export type IcDecisionResult = ActionResult;

// The decision insert and the (go/no_go) stage advance happen in one
// transaction via the record_ic_decision RPC
// (20260703200000_deal_lifecycle_atomic.sql) — a failure between the two used
// to leave an IC vote on the record with the deal stage unchanged, or the
// reverse, with nothing checking the Supabase client's error at either step.
export async function recordIcDecision(formData: FormData): Promise<IcDecisionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const dealId = String(formData.get("deal_id") ?? "");
  const decision = String(formData.get("decision") ?? "") as IcDecisionKind;
  if (!dealId || !["go", "conditional", "hold", "no_go"].includes(decision)) {
    return { ok: false, error: "Choose a deal and a decision." };
  }

  const supabase = createServerClient();
  // Record the conviction at the moment of the call so the log stands alone.
  const conviction = await computeDealConviction(supabase, ctx.orgId, dealId);

  const { error } = await supabase.rpc("record_ic_decision", {
    p_org: ctx.orgId,
    p_deal_id: dealId,
    p_decision: decision,
    p_rationale: text(formData, "rationale"),
    p_conviction: conviction?.score ?? null,
    p_decided_by: ctx.userId,
  });
  if (error) return { ok: false, error: error.message };

  await recordConvictionSnapshot(supabase, ctx.orgId, dealId);
  revalidateRun(dealId);
  return { ok: true };
}
