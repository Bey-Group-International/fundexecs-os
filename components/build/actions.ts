"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";
import { gatherFoundationContext } from "@/lib/foundation-context";

// Parse a comma/newline-separated input into a clean string[].
function toList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(raw: FormDataEntryValue | null): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && String(raw ?? "").trim() !== "" ? n : null;
}

const BUILD = "/build";

// --- Brand ----------------------------------------------------------------
export async function updateBrand(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const supabase = createServerClient();
  await supabase
    .from("organizations")
    .update({
      logo_url: String(formData.get("logo_url") ?? "").trim() || null,
      brand_color: String(formData.get("brand_color") ?? "").trim() || null,
      tagline: String(formData.get("tagline") ?? "").trim() || null,
      brand_voice: String(formData.get("brand_voice") ?? "").trim() || null,
      brand_palette: toList(String(formData.get("brand_palette") ?? "")),
    })
    .eq("id", ctx.orgId);
  revalidatePath(`${BUILD}/brand`);
}

// --- Thesis ----------------------------------------------------------------
export async function createThesis(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const supabase = createServerClient();
  await supabase.from("investment_theses").insert({
    organization_id: ctx.orgId,
    title,
    summary: String(formData.get("summary") ?? "").trim() || null,
    asset_classes: toList(String(formData.get("asset_classes") ?? "")),
    geographies: toList(String(formData.get("geographies") ?? "")),
    check_size_min: num(formData.get("check_size_min")),
    check_size_max: num(formData.get("check_size_max")),
    target_irr: num(formData.get("target_irr")),
    target_moic: num(formData.get("target_moic")),
    is_active: true,
  });
  revalidatePath(`${BUILD}/thesis`);
}

export async function deleteThesis(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase.from("investment_theses").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath(`${BUILD}/thesis`);
}

// --- Entity ----------------------------------------------------------------
export async function createEntity(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supabase = createServerClient();
  await supabase.from("entities").insert({
    organization_id: ctx.orgId,
    name,
    entity_type: String(formData.get("entity_type") ?? "spv").trim() || "spv",
    jurisdiction: String(formData.get("jurisdiction") ?? "").trim() || null,
    parent_entity_id: String(formData.get("parent_entity_id") ?? "").trim() || null,
    formation_date: String(formData.get("formation_date") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    created_by: ctx.userId,
  });
  revalidatePath(`${BUILD}/entity`);
}

export async function deleteEntity(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase.from("entities").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath(`${BUILD}/entity`);
}

// --- Track Record ----------------------------------------------------------
export async function createTrackRecord(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const deal_name = String(formData.get("deal_name") ?? "").trim();
  if (!deal_name) return;
  const supabase = createServerClient();
  await supabase.from("track_records").insert({
    organization_id: ctx.orgId,
    deal_name,
    asset_class: String(formData.get("asset_class") ?? "").trim() || null,
    vintage_year: num(formData.get("vintage_year")),
    invested_amount: num(formData.get("invested_amount")),
    realized_value: num(formData.get("realized_value")),
    gross_irr: num(formData.get("gross_irr")),
    gross_moic: num(formData.get("gross_moic")),
    is_realized: formData.get("is_realized") === "on",
  });
  revalidatePath(`${BUILD}/track_record`);
}

export async function deleteTrackRecord(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase.from("track_records").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath(`${BUILD}/track_record`);
}

// --- Draft with Earn -------------------------------------------------------
// Seeds a session whose Associate drafts this module's artifact, then opens it.
const DRAFT_PROMPTS: Record<string, string> = {
  profile:
    "Draft a crisp, institutional firm overview for our organization profile — who we are, what we invest in, and what sets us apart.",
  thesis:
    "Draft a concise institutional investment thesis for our firm: target asset classes, geographies, check size range, and target returns (IRR/MOIC), grounded in our profile and track record.",
  brand:
    "Draft our firm's brand voice and a one-line tagline for a private-markets investment firm, consistent with our profile and thesis.",
  entity:
    "Propose a clean legal entity structure (GP / management company, fund, SPVs, holdco) for our firm, with a short rationale for each.",
  track_record:
    "Turn our deals into an investor-ready track record summary: highlight realized vs. unrealized, gross IRR/MOIC, and notable outcomes.",
  team: "Draft concise, professional bios for our team based on their roles and the firm's focus.",
  reporting:
    "Draft a quarterly LP update from our live portfolio: NAV and value created, capital account (committed / called / distributed), the headline multiples (TVPI, DPI, gross MOIC), notable holdings and any realized exits, and a measured outlook — institutional and confident.",
};

export async function draftWithEarn(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const moduleKey = String(formData.get("module") ?? "");
  let prompt = DRAFT_PROMPTS[moduleKey];
  if (!prompt) redirect("/workspace");

  // Compound the draft on what other Build modules already hold, so each
  // module's Associate builds on the firm's foundation instead of from scratch.
  const context = await gatherFoundationContext(ctx.orgId);
  if (context) {
    prompt += `\n\n--- What we already know about the firm (use this; do not contradict it) ---\n${context}`;
  }

  const supabase = createServerClient();
  const result = await handlePrompt(
    { supabase, orgId: ctx.orgId, actorId: ctx.userId },
    prompt,
  );
  redirect(result.session_id ? `/session/${result.session_id}` : "/workspace");
}
