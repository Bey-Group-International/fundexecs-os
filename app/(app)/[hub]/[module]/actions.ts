"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext, requireOrgContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";
import { logLPContact } from "@/lib/lp-relationships";
import { LP_DOCUMENT_TYPES, renderDocumentTemplate } from "@/lib/document-templates";
import { DOCUMENT_TYPE_LABELS, CONTRACT_STATUS_META, type DocumentType, type ContractStatus } from "@/lib/contracts";
import { gmailAdapter } from "@/lib/integrations/adapters/gmail";

// Update the active organization's Build › Profile fields. RLS restricts this
// to org admins/owners.
export async function updateProfile(formData: FormData) {
  const auth = await requireOrgContext();
  if (!auth.ok) return;

  // Trim a field; empty string becomes null.
  const t = (name: string): string | null => {
    const v = String(formData.get(name) ?? "").trim();
    return v === "" ? null : v;
  };

  // Website: trim, and prefix https:// when a scheme is missing.
  const rawWebsite = String(formData.get("website") ?? "").trim();
  const website =
    rawWebsite === ""
      ? null
      : /^[a-z][a-z0-9+.-]*:\/\//i.test(rawWebsite)
        ? rawWebsite
        : `https://${rawWebsite}`;

  // Fund count: parse to a number, or null when empty/invalid.
  const rawFundCount = String(formData.get("fund_count") ?? "").trim();
  let fund_count: number | null = null;
  if (rawFundCount !== "") {
    const n = Number(rawFundCount);
    fund_count = Number.isFinite(n) ? n : null;
  }

  const supabase = createServerClient();
  await supabase
    .from("organizations")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      legal_name: t("legal_name"),
      entity_type: t("entity_type"),
      tagline: t("tagline"),
      jurisdiction: t("jurisdiction"),
      website,
      description: t("description"),
      hq_location: t("hq_location"),
      aum_range: t("aum_range"),
      fund_count,
      primary_strategy: t("primary_strategy"),
      operator_role: t("operator_role"),
    })
    .eq("id", auth.ctx.orgId);

  revalidatePath("/build/profile");
}

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
) {
  const auth = await requireOrgContext();
  if (!auth.ok) return;

  const key = `${hub}/${module}`;
  if (!(key in ADD_ROW_CONFIGS)) return;

  const orgId = auth.ctx.orgId;
  const supabase = createServerClient();

  // Session-scoped modules (migration 0022) tag new rows with the session when
  // added from inside the session frame; null otherwise (org-wide).
  const session_id = sessionId ?? null;

  switch (key) {
    case "source/lp_pipeline": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("investors").insert({
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
      });
      break;
    }
    case "source/deal_pipeline": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("deals").insert({
        organization_id: orgId,
        session_id,
        name,
        stage:
          (text(formData, "stage") as
            | "sourced"
            | "screening"
            | "diligence"
            | "underwriting"
            | "ic_review"
            | "closing"
            | "owned"
            | "exited"
            | "passed"
            | "dead"
            | null) ?? "sourced",
        asset_class: text(formData, "asset_class"),
      });
      break;
    }
    case "execute/asset_management": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("assets").insert({
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
      break;
    }
    case "execute/capital_events": {
      const amount = num(formData, "amount");
      if (amount == null) return;
      // Capital events belong to a fund (NOT NULL FK). Attach to the org's
      // first fund; without one there's nothing to book the flow against.
      const { data: fund } = await supabase
        .from("funds")
        .select("id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!fund) return;
      await supabase.from("capital_events").insert({
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
      break;
    }
    case "source/partners": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("partners").insert({
        organization_id: orgId,
        name,
        partner_type: text(formData, "partner_type") ?? "co_gp",
        relationship: text(formData, "relationship"),
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        status: text(formData, "status") ?? "active",
      });
      break;
    }
    case "source/providers": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("service_providers").insert({
        organization_id: orgId,
        name,
        provider_type: text(formData, "provider_type") ?? "legal",
        contact_name: text(formData, "contact_name"),
        contact_email: text(formData, "contact_email"),
        status: text(formData, "status") ?? "active",
      });
      break;
    }
    case "source/debt": {
      const name = text(formData, "name");
      if (!name) return;
      await supabase.from("debt_facilities").insert({
        organization_id: orgId,
        name,
        facility_type: text(formData, "facility_type") ?? "term_loan",
        lender: text(formData, "lender"),
        commitment_amount: num(formData, "commitment_amount"),
        interest_rate: num(formData, "interest_rate"),
        currency: text(formData, "currency") ?? "USD",
        status: text(formData, "status") ?? "prospective",
      });
      break;
    }
    default:
      return;
  }

  revalidatePath(`/${hub}/${module}`);
  if (sessionId) revalidatePath(`/session/${sessionId}/${hub}/${module}`);
}

// --- Run › Comms: deal-aware Earn launcher --------------------------------
// Seeds an Earn session pre-prompted to draft a comms artifact for a specific
// deal, then opens it. Keeps the Run › Comms module a productive launchpad
// rather than a dead-end scaffold.
const COMMS_PROMPTS: Record<string, (deal: string) => string> = {
  ic_memo: (deal) =>
    `Draft an institutional IC memo for the deal "${deal}": opportunity summary, thesis fit, base/downside underwriting, key diligence findings and open risks, and a clear recommendation.`,
  lp_update: (deal) =>
    `Draft a concise LP update on the deal "${deal}" we're evaluating: what it is, why it fits the mandate, where we are in diligence, and expected next steps — confident but measured.`,
  screening_memo: (deal) =>
    `Draft a one-page screening memo for the deal "${deal}": the opportunity, thesis fit, the two or three things that would make or break it, and a go / no-go recommendation on whether to spend diligence time.`,
};

export async function draftDealComms(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const dealId = String(formData.get("deal_id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const build = COMMS_PROMPTS[kind];
  if (!dealId || !build) redirect("/workspace");

  const supabase = createServerClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("name")
    .eq("id", dealId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!deal) redirect("/run/comms");

  const result = await handlePrompt(
    { supabase, orgId: ctx.orgId, actorId: ctx.userId },
    build(deal.name as string),
  );
  redirect(result.session_id ? `/session/${result.session_id}` : "/workspace");
}

export async function logContactAction(investorId: string) {
  const auth = await requireOrgContext();
  if (!auth.ok) return { error: "Unauthorized" };
  try {
    const supabase = createServerClient();
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
    const supabase = createServerClient();
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

    revalidatePath("/run/documents");
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
    const supabase = createServerClient();
    const { data: contract } = await supabase
      .from("contracts")
      .select("status")
      .eq("id", contractId)
      .eq("organization_id", auth.ctx.orgId)
      .maybeSingle();

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

    revalidatePath("/run/documents");
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
    const supabase = createServerClient();
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
