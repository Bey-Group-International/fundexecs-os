"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionContext, requireOrgContext } from "@/lib/auth";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";
import { logLPContact } from "@/lib/lp-relationships";
import { LP_DOCUMENT_TYPES, renderDocumentTemplate } from "@/lib/document-templates";
import { DOCUMENT_TYPE_LABELS, CONTRACT_STATUS_META, type DocumentType, type ContractStatus } from "@/lib/contracts";
import { gmailAdapter } from "@/lib/integrations/adapters/gmail";
import type { DealStage } from "@/lib/supabase/database.types";

// Build › Profile edits are handled by `saveOrgProfile`
// (app/(app)/build/profile/actions.ts), the single canonical profile action
// shared by the standalone page and the in-session ModuleView editor.

// --- Add-row support -------------------------------------------------------
// Field configs live in lib/module-forms.ts so the AddRowForm client component
// and this server action agree on exactly which columns are written.

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

// Insert a row into a table-backed module. Uses a per-module allow-list and a
// switch on the literal key so each `.from(...)` stays typed against the table.
export async function createModuleRow(
  hub: string,
  module: string,
  formData: FormData,
  sessionId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };

  const key = `${hub}/${module}`;
  if (!(key in ADD_ROW_CONFIGS)) return { ok: false, error: "Unknown module." };

  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();

  // Session-scoped modules (migration 0022) tag new rows with the session when
  // added from inside the session frame; null otherwise (org-wide).
  const session_id = sessionId ?? null;

  switch (key) {
    case "source/lp_pipeline": {
      const name = text(formData, "name");
      if (!name) return { ok: false, error: "Name is required." };
      const { error: insertErr } = await supabase.from("investors").insert({
        organization_id: orgId,
        session_id,
        name,
        investor_type:
          (text(formData, "investor_type") as
            | "lp"
            | "family_office"
            | "institution"
            | "fund_of_funds"
            | "lender"
            | "bank"
            | "co_gp"
            | "other"
            | null) ?? "lp",
        pipeline_stage: text(formData, "pipeline_stage") ?? "prospect",
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        contact_phone: text(formData, "contact_phone"),
        role: text(formData, "role"),
        website: text(formData, "website"),
        url_source: text(formData, "url_source"),
      });
      if (insertErr) { console.error("[createModuleRow] investors", insertErr.message); return { ok: false, error: insertErr.message }; }
      break;
    }
    case "source/deal_pipeline": {
      const name = text(formData, "name");
      if (!name) return { ok: false, error: "Name is required." };
      const dealRow = {
        organization_id: orgId,
        session_id,
        name,
        stage: parseDealStage(text(formData, "stage")),
        asset_class: text(formData, "asset_class"),
        geography: text(formData, "geography"),
        target_amount: num(formData, "target_amount"),
        expected_close: text(formData, "expected_close"),
        website: text(formData, "website"),
        notes: text(formData, "notes"),
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        contact_phone: text(formData, "contact_phone"),
        url_source: text(formData, "url_source"),
      };
      const { error: dealInsertError } = await supabase.from("deals").insert(dealRow as never);
      if (dealInsertError) { console.error("[createModuleRow] deals insert failed", dealInsertError.message); return { ok: false, error: dealInsertError.message }; }
      break;
    }
    case "execute/asset_management": {
      const name = text(formData, "name");
      if (!name) return { ok: false, error: "Name is required." };
      const { error: insertErr } = await supabase.from("assets").insert({
        organization_id: orgId,
        session_id,
        name,
        asset_type:
          (text(formData, "asset_type") as
            | "real_estate"
            | "operating_company"
            | "portfolio_company"
            | "fund_interest"
            | "other"
            | null) ?? "real_estate",
        acquisition_cost: num(formData, "acquisition_cost"),
        current_value: num(formData, "current_value"),
        acquisition_date: text(formData, "acquisition_date"),
        status: text(formData, "status") ?? "active",
        noi: num(formData, "noi"),
        cap_rate: num(formData, "cap_rate"),
      });
      if (insertErr) { console.error("[createModuleRow] assets", insertErr.message); return { ok: false, error: insertErr.message }; }
      break;
    }
    case "execute/capital_events": {
      const amount = num(formData, "amount");
      if (amount == null) return { ok: false, error: "Amount is required." };
      // Capital events belong to a fund (NOT NULL FK). Attach to the org's
      // first fund; without one there's nothing to book the flow against.
      const { data: fund } = await supabase
        .from("funds")
        .select("id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!fund) return { ok: false, error: "No fund found for this organization." };
      const { error: insertErr } = await supabase.from("capital_events").insert({
        organization_id: orgId,
        fund_id: fund.id,
        event_type:
          (text(formData, "event_type") as
            | "capital_call"
            | "distribution"
            | "contribution"
            | "fee"
            | "return_of_capital"
            | "carry"
            | null) ?? "capital_call",
        amount,
        currency: text(formData, "currency") ?? "USD",
        effective_date: text(formData, "effective_date") ?? new Date().toISOString().slice(0, 10),
        reference: text(formData, "reference"),
      });
      if (insertErr) { console.error("[createModuleRow] capital_events", insertErr.message); return { ok: false, error: insertErr.message }; }
      break;
    }
    case "source/partners": {
      const name = text(formData, "name");
      if (!name) return { ok: false, error: "Name is required." };
      const { error: insertErr } = await supabase.from("partners").insert({
        organization_id: orgId,
        name,
        partner_type: text(formData, "partner_type") ?? "co_gp",
        relationship: text(formData, "relationship"),
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        contact_phone: text(formData, "contact_phone"),
        role: text(formData, "role"),
        website: text(formData, "website"),
        url_source: text(formData, "url_source"),
        status: text(formData, "status") ?? "active",
      });
      if (insertErr) { console.error("[createModuleRow] partners", insertErr.message); return { ok: false, error: insertErr.message }; }
      break;
    }
    case "source/providers": {
      const name = text(formData, "name");
      if (!name) return { ok: false, error: "Name is required." };
      const { error: provInsertError } = await supabase.from("service_providers").insert({
        organization_id: orgId,
        name,
        provider_type: text(formData, "provider_type") ?? "legal",
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        contact_phone: text(formData, "contact_phone"),
        role: text(formData, "role"),
        url_source: text(formData, "url_source"),
        status: text(formData, "status") ?? "active",
        notes: text(formData, "notes"),
        website: text(formData, "website"),
      });
      if (provInsertError) { console.error("[createModuleRow] service_providers", provInsertError.message); return { ok: false, error: provInsertError.message }; }
      break;
    }
    case "source/debt": {
      const name = text(formData, "name");
      if (!name) return { ok: false, error: "Name is required." };
      const { error: insertErr } = await supabase.from("debt_facilities").insert({
        organization_id: orgId,
        name,
        facility_type: text(formData, "facility_type") ?? "term_loan",
        lender: text(formData, "lender"),
        commitment_amount: num(formData, "commitment_amount"),
        interest_rate: num(formData, "interest_rate"),
        currency: text(formData, "currency") ?? "USD",
        status: text(formData, "status") ?? "prospective",
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        contact_phone: text(formData, "contact_phone"),
        role: text(formData, "role"),
        website: text(formData, "website"),
        url_source: text(formData, "url_source"),
      } as never);
      if (insertErr) { console.error("[createModuleRow] debt_facilities", insertErr.message); return { ok: false, error: insertErr.message }; }
      break;
    }
    default:
      return { ok: false, error: "Unknown module." };
  }

  revalidatePath(`/${hub}/${module}`);
  if (sessionId) revalidatePath(`/session/${sessionId}/${hub}/${module}`);
  return { ok: true };
}

export async function logContactAction(investorId: string) {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = await createServerClient();
    await logLPContact(supabase, auth.ctx.orgId, investorId);
    revalidatePath("/source/lp_pipeline");
    return { ok: true };
  } catch (e) {
    console.error("[logContactAction] failed", e);
    return { error: "Failed to log contact" };
  }
}

// --- Document generation ---------------------------------------------------

export async function generateDocumentAction(formData: FormData) {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  const docType = String(formData.get("doc_type") ?? "") as DocumentType;
  const fundId = String(formData.get("fund_id") ?? "").trim() || null;
  const investorId = String(formData.get("investor_id") ?? "").trim() || null;

  if (!docType || !(docType in DOCUMENT_TYPE_LABELS)) {
    return { error: "Invalid document type" };
  }
  if (LP_DOCUMENT_TYPES.includes(docType) && !investorId) {
    return { error: "Investor required for this document type" };
  }

  try {
    const supabase = await createServerClient();
    const orgId = auth.ctx.orgId;

    const [orgResult, fundResult, investorResult] = await Promise.all([
      supabase.from("organizations").select("name, jurisdiction").eq("id", orgId).maybeSingle(),
      fundId
        ? supabase.from("funds").select("name").eq("id", fundId).eq("organization_id", orgId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      investorId
        ? supabase.from("investors").select("name, typical_check_min, typical_check_max, jurisdiction").eq("id", investorId).eq("organization_id", orgId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (orgResult.error || fundResult.error || investorResult.error) {
      throw orgResult.error ?? fundResult.error ?? investorResult.error;
    }

    const org = orgResult.data as { name?: string; jurisdiction?: string } | null;
    const fund = fundResult.data as { name?: string } | null;
    const investor = investorResult.data as {
      name?: string;
      typical_check_min?: number | null;
      typical_check_max?: number | null;
      jurisdiction?: string | null;
    } | null;

    if (fundId && !fund) return { error: "Invalid fund" };
    if (investorId && !investor) return { error: "Invalid investor" };

    const checkAmt = investor?.typical_check_max ?? investor?.typical_check_min;
    const vars = {
      fundName: fund?.name ?? "Fund",
      orgName: org?.name ?? "General Partner",
      jurisdiction: investor?.jurisdiction ?? org?.jurisdiction ?? "Delaware",
      effectiveDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      investorName: investor?.name,
      commitmentAmount: checkAmt ? `$${Number(checkAmt).toLocaleString("en-US")}` : undefined,
    };

    const content = renderDocumentTemplate(docType, vars);
    const title = `${DOCUMENT_TYPE_LABELS[docType]}${investor?.name ? ` — ${investor.name}` : ""}`;

    const { error: insertError } = await supabase.from("contracts").insert({
      organization_id: orgId,
      fund_id: fundId,
      investor_id: investorId,
      created_by: auth.ctx.userId,
      title,
      document_type: docType,
      status: "draft",
      notes: content,
    });
    if (insertError) throw insertError;

    revalidatePath("/build/documents");
    return { ok: true };
  } catch (e) {
    console.error("[generateDocumentAction] failed", e);
    return { error: "Failed to generate document" };
  }
}

export async function advanceContractAction(contractId: string) {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = await createServerClient();
    const { data: contract, error: selectError } = await supabase
      .from("contracts")
      .select("status")
      .eq("id", contractId)
      .eq("organization_id", auth.ctx.orgId)
      .maybeSingle();

    if (selectError) throw selectError;
    if (!contract) {
      return { error: "Not found" };
    }

    const meta = CONTRACT_STATUS_META[contract.status as ContractStatus];
    if (!meta) return { error: "Invalid status" };
    if (!meta.next) return { error: "No next status" };

    const { error: updateError } = await supabase
      .from("contracts")
      .update({ status: meta.next, ...(meta.next === "signed" ? { signed_at: new Date().toISOString() } : {}) })
      .eq("id", contractId)
      .eq("organization_id", auth.ctx.orgId);
    if (updateError) throw updateError;

    revalidatePath("/build/documents");
    return { ok: true };
  } catch (e) {
    console.error("[advanceContractAction] failed", e);
    return { error: "Failed to advance contract" };
  }
}

// --- LP Onboarding Invite ---------------------------------------------------

export async function createLpInviteAction(formData: FormData) {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  const investorId = String(formData.get("investor_id") ?? "").trim() || null;
  const fundId = String(formData.get("fund_id") ?? "").trim() || null;
  const lpName = String(formData.get("lp_name") ?? "").trim();
  const lpEmail = String(formData.get("lp_email") ?? "").trim();
  const rawAmount = String(formData.get("commitment_amount") ?? "").trim();
  const commitmentAmount = rawAmount ? Number(rawAmount) : null;

  if (!lpName || !lpEmail) return { error: "Name and email are required" };

  try {
    const supabase = await createServerClient();
    const orgId = auth.ctx.orgId;

    const { data: session, error } = await supabase
      .from("lp_onboarding_sessions")
      .insert({
        organization_id: orgId,
        investor_id: investorId,
        fund_id: fundId,
        lp_name: lpName,
        lp_email: lpEmail,
        commitment_amount: commitmentAmount,
        status: "pending",
      })
      .select("token")
      .single();

    if (error || !session) {
      console.error("[createLpInviteAction] insert failed", error);
      return { error: "Failed to create invite" };
    }

    const token = session.token as string;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const portalUrl = `${appUrl}/lp/${token}`;

    // Email the LP their invite link (mock-or-real via Gmail adapter).
    await gmailAdapter.dispatch({
      orgId,
      actorId: auth.ctx.userId,
      action: "send_outreach",
      target: { email: lpEmail, name: lpName },
      metadata: {
        subject: `You're invited to join the fund`,
        body: `Hi ${lpName},\n\nYou have been invited to complete your LP onboarding. Click the link below to get started:\n\n${portalUrl}\n\nThis link expires in 30 days.\n\nBest,\nThe Fund Manager`,
      },
    });

    revalidatePath("/source/lp_pipeline");
    revalidatePath("/execute/closing");
    return { ok: true, token, portalUrl };
  } catch (e) {
    console.error("[createLpInviteAction] failed", e);
    return { error: "Failed to send invite" };
  }
}

// --- Deal Pipeline: stage advancement --------------------------------------

const DEAL_STAGE_VALUES: DealStage[] = [
  "sourced", "screening", "diligence", "underwriting",
  "ic_review", "closing", "owned", "exited", "passed", "dead",
];

function parseDealStage(value: string | null): DealStage {
  if (!value) return "sourced";
  if ((DEAL_STAGE_VALUES as string[]).includes(value)) return value as DealStage;
  throw new Error("Invalid deal stage");
}

const STAGE_DOC_SUGGESTIONS: Partial<Record<DealStage, string>> = {
  screening: "screening_memo",
  ic_review: "ic_memo",
};

export async function advanceDealStageAction(
  dealId: string,
  newStage: string,
  pipelineStageId?: string,
): Promise<{ ok?: boolean; error?: string; suggestDocType?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  if (!DEAL_STAGE_VALUES.includes(newStage as DealStage)) return { error: "Invalid stage" };

  try {
    const supabase = await createServerClient();

    // When the move was confirmed against a configured pipeline stage, record
    // the link too. Verify the stage belongs to this org first (the FK alone
    // does not enforce org scoping) so a client can't attach another org's stage.
    const update: { stage: DealStage; pipeline_stage_id?: string } = {
      stage: newStage as DealStage,
    };
    if (pipelineStageId) {
      const { data: stage } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("id", pipelineStageId)
        .eq("org_id", auth.ctx.orgId)
        .maybeSingle();
      if (!stage) return { error: "Invalid pipeline stage" };
      update.pipeline_stage_id = pipelineStageId;
    }

    const { count, error } = await supabase
      .from("deals")
      .update(update, { count: "exact" })
      .eq("id", dealId)
      .eq("organization_id", auth.ctx.orgId);
    if (error) throw error;
    if (!count) return { error: "Deal not found" };

    revalidatePath("/source/deal_pipeline");
    return {
      ok: true,
      suggestDocType: STAGE_DOC_SUGGESTIONS[newStage as DealStage],
    };
  } catch (e) {
    console.error("[advanceDealStageAction] failed", e);
    return { error: "Failed to update stage" };
  }
}

// --- Service Provider: create, update & delete -----------------------------

export async function createProviderAction(
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  const name = text(formData, "name");
  if (!name) return { error: "Provider name is required" };

  try {
    const supabase = await createServerClient();
    const { error } = await supabase.from("service_providers").insert({
      organization_id: auth.ctx.orgId,
      name,
      provider_type: text(formData, "provider_type") ?? "legal",
      contact_name: text(formData, "contact_name"),
      contact_email: text(formData, "contact_email"),
      contact_phone: text(formData, "contact_phone"),
      role: text(formData, "role"),
      status: text(formData, "status") ?? "active",
      notes: text(formData, "notes"),
      website: text(formData, "website"),
      url_source: text(formData, "url_source"),
    });
    if (error) throw error;

    revalidatePath("/source/providers");
    return { ok: true };
  } catch (e) {
    console.error("[createProviderAction] failed", e);
    return { error: "Failed to create provider" };
  }
}

export async function updateProviderAction(
  providerId: string,
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  const t = (name: string): string | null => {
    const v = String(formData.get(name) ?? "").trim();
    return v === "" ? null : v;
  };

  const name = t("name");
  if (!name) return { error: "Provider name is required" };

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("service_providers")
      .update({
        name,
        provider_type: t("provider_type") ?? undefined,
        contact_name: t("contact_name"),
        contact_email: t("contact_email"),
        contact_phone: t("contact_phone"),
        role: t("role"),
        status: t("status") ?? undefined,
        notes: t("notes"),
        website: t("website"),
        url_source: t("url_source"),
      })
      .eq("id", providerId)
      .eq("organization_id", auth.ctx.orgId)
      .select("id");
    if (error) throw error;
    if (!data?.length) return { error: "Provider not found" };

    revalidatePath("/source/providers");
    return { ok: true };
  } catch (e) {
    console.error("[updateProviderAction] failed", e);
    return { error: "Failed to update provider" };
  }
}

export async function deleteProviderAction(
  providerId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("service_providers")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", providerId)
      .eq("organization_id", auth.ctx.orgId)
      .select("id");
    if (error) throw error;
    if (!data?.length) return { error: "Provider not found" };

    revalidatePath("/source/providers");
    return { ok: true };
  } catch (e) {
    console.error("[deleteProviderAction] failed", e);
    return { error: "Failed to delete provider" };
  }
}

export async function clearProvidersAction(): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("service_providers")
      .update({ archived_at: new Date().toISOString() })
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null);
    if (error) throw error;
    revalidatePath("/source/providers");
    return { ok: true };
  } catch (e) {
    console.error("[clearProvidersAction] failed", e);
    return { error: "Failed to clear providers" };
  }
}

// --- LP Pipeline (investors): delete & clear --------------------------------

export async function deleteInvestorAction(
  investorId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("investors")
      .delete()
      .eq("id", investorId)
      .eq("organization_id", auth.ctx.orgId);
    if (error) throw error;
    revalidatePath("/source/lp_pipeline");
    return { ok: true };
  } catch (e) {
    console.error("[deleteInvestorAction] failed", e);
    return { error: "Failed to delete investor" };
  }
}

export async function archiveInvestorAction(
  investorId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = await createServerClient();
    const { error } = await supabase
      .from("investors")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", investorId)
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null);
    if (error) throw error;
    revalidatePath("/source/lp_pipeline");
    return { ok: true };
  } catch (e) {
    console.error("[archiveInvestorAction] failed", e);
    return { error: "Failed to archive investor" };
  }
}

export async function clearInvestorsAction(): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("investors")
      .delete()
      .eq("organization_id", auth.ctx.orgId);
    if (error) throw error;
    revalidatePath("/source/lp_pipeline");
    return { ok: true };
  } catch (e) {
    console.error("[clearInvestorsAction] failed", e);
    return { error: "Failed to clear investors" };
  }
}

// --- Deal Pipeline: delete & clear ------------------------------------------

export async function deleteDealAction(
  dealId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = await createServerClient();
    const { error } = await supabase
      .from("deals")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", dealId)
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null);
    if (error) throw error;
    revalidatePath("/source/deal_pipeline");
    return { ok: true };
  } catch (e) {
    console.error("[deleteDealAction] failed", e);
    return { error: "Failed to delete deal" };
  }
}

export async function clearDealsAction(): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    // The org-scoped client (not the service-role client this used to reach
    // for) so RLS's deals_write policy — which blocks the 'viewer' role —
    // actually applies here, same as deleteDealAction just above.
    const supabase = await createServerClient();
    const { error } = await supabase
      .from("deals")
      .update({ archived_at: new Date().toISOString() })
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null);
    if (error) throw error;
    revalidatePath("/source/deal_pipeline");
    return { ok: true };
  } catch (e) {
    console.error("[clearDealsAction] failed", e);
    return { error: "Failed to clear deals" };
  }
}

// --- Partners: delete & clear ------------------------------------------------

export async function deletePartnerAction(
  partnerId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = await createServerClient();
    const { error } = await supabase
      .from("partners")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", partnerId)
      .eq("organization_id", auth.ctx.orgId);
    if (error) throw error;
    revalidatePath("/source/partners");
    return { ok: true };
  } catch (e) {
    console.error("[deletePartnerAction] failed", e);
    return { error: "Failed to delete partner" };
  }
}

export async function clearPartnersAction(): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("partners")
      .update({ archived_at: new Date().toISOString() })
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null);
    if (error) throw error;
    revalidatePath("/source/partners");
    return { ok: true };
  } catch (e) {
    console.error("[clearPartnersAction] failed", e);
    return { error: "Failed to clear partners" };
  }
}

// ── Inline contact field updates ─────────────────────────────────────────────

type ContactTable = "investors" | "deals" | "partners" | "service_providers" | "debt_facilities";

export interface ContactFields {
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  role?: string | null;
  website?: string | null;
  url_source?: string | null;
}

export async function updateContactFieldsAction(
  table: ContactTable,
  id: string,
  fields: ContactFields,
): Promise<{ ok?: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };

  const tableAllowedFields: Record<ContactTable, (keyof ContactFields)[]> = {
    investors:         ["contact_name", "contact_email", "contact_phone", "role", "website", "url_source"],
    deals:             ["contact_name", "contact_email", "contact_phone", "role", "website", "url_source"],
    partners:          ["contact_name", "contact_email", "contact_phone", "role", "website", "url_source"],
    service_providers: ["contact_name", "contact_email", "contact_phone", "role", "website", "url_source"],
    debt_facilities:   ["contact_name", "contact_email", "contact_phone", "role", "website", "url_source"],
  };
  if (!(table in tableAllowedFields)) return { error: "Invalid table" };

  const allowedKeys = new Set(tableAllowedFields[table]);
  const clean: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!allowedKeys.has(k as keyof ContactFields)) continue;
    clean[k] = typeof v === "string" ? (v.trim() || null) : null;
  }

  const pathMap: Record<ContactTable, string> = {
    investors:         "/source/lp_pipeline",
    deals:             "/source/deal_pipeline",
    partners:          "/source/partners",
    service_providers: "/source/providers",
    debt_facilities:   "/source/debt",
  };

  if (clean.contact_email !== undefined && clean.contact_email !== null) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.contact_email)) {
      return { error: "Invalid email address" };
    }
  }

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from(table as "investors")
      .update(clean as never)
      .eq("id", id)
      .eq("organization_id", auth.ctx.orgId)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { error: "Record not found" };
    revalidatePath(pathMap[table]);
    return { ok: true };
  } catch (e) {
    console.error("[updateContactFieldsAction] failed", e);
    return { error: "Failed to update contact" };
  }
}
