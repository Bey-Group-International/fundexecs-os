"use server";

import { revalidatePath } from "next/cache";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
import { entitlements } from "@/lib/entitlements";
import { compoundingProfile } from "@/lib/compounding";
import {
  requiredListingStake,
  lockStake,
  resolveListingStake,
  forfeitListingStakeViaDispute,
} from "@/lib/stake";
import { queueNextAction } from "@/app/(app)/capital-map/actions";
import type { AgentKey } from "@/lib/supabase/database.types";
import type { MarketplaceStatus } from "@/lib/supabase/database.types";

const STATUSES: MarketplaceStatus[] = ["draft", "listed", "paused", "closed"];

// Parse a currency/number form field into a positive number, or null. Strips
// symbols and separators so "$3,200,000" and "3200000" both work.
function parseMoney(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) || n < 0 ? null : n;
}

// Create a marketplace listing for the active org. Only the title is required;
// everything else defaults sensibly (draft, private) so a listing can be filled
// in over time before it goes public.
export async function createListing(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const title = String(formData.get("title") ?? "").trim();
  const listingType = String(formData.get("listing_type") ?? "").trim() || "deal";
  const summary = String(formData.get("summary") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "draft").trim();
  const isPublic = formData.get("is_public") === "on";
  const dealId = String(formData.get("deal_id") ?? "").trim() || null;
  const targetIrrRaw = String(formData.get("target_irr") ?? "").trim();
  const holdPeriodRaw = String(formData.get("hold_period_years") ?? "").trim();
  const geography = String(formData.get("geography") ?? "").trim() || null;
  const assetClass = String(formData.get("asset_class") ?? "").trim() || null;
  const teaserUrl = String(formData.get("teaser_url") ?? "").trim() || null;
  const country = String(formData.get("country") ?? "").trim() || null;
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase() || "USD";
  const ebitda = parseMoney(formData.get("ebitda"));
  const grossRevenue = parseMoney(formData.get("gross_revenue"));
  const featured = formData.get("featured") === "on";

  if (!title) return { error: "Title is required" };

  const status: MarketplaceStatus = STATUSES.includes(statusRaw as MarketplaceStatus)
    ? (statusRaw as MarketplaceStatus)
    : "draft";

  let amount: number | null = null;
  if (amountRaw) {
    const parsed = Number(amountRaw.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(parsed)) amount = parsed;
  }
  let targetIrr: number | null = null;
  if (targetIrrRaw) {
    const parsed = Number(targetIrrRaw.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(parsed) && parsed > 0) targetIrr = parsed;
  }
  let holdPeriodYears: number | null = null;
  if (holdPeriodRaw) {
    const parsed = Number(holdPeriodRaw.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(parsed) && parsed > 0) holdPeriodYears = parsed;
  }

  // Governance gate (TOKENIZATION_LAYERS.md §4.2/§4.3): only orgs entitled to
  // list may create a listing, and listing escrows a refundable, reputation-
  // scaled credit stake.
  const wallet = await getWallet(ctx.orgId);
  const ent = await entitlements(ctx.orgId, wallet?.plan ?? null);
  if (!ent.canList) {
    return { error: "Your plan or standing doesn't allow listing yet." };
  }

  const supabase = await createServerClient();
  const { data: listing, error } = await supabase
    .from("marketplace_listings")
    .insert({
      organization_id: ctx.orgId,
      title,
      listing_type: listingType,
      summary: summary || null,
      deal_id: dealId,
      amount,
      status,
      is_public: isPublic,
      target_irr: targetIrr,
      hold_period_years: holdPeriodYears,
      geography,
      asset_class: assetClass,
      teaser_url: teaserUrl,
      country,
      currency,
      ebitda,
      gross_revenue: grossRevenue,
      featured,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Lock the listing stake. Reputable orgs post less; if the required stake is
  // 0, skip locking. Stake writes use the service client (credit movements need
  // the service role). A guard inside lockStake rejects insufficient balance.
  const requiredStake = requiredListingStake(await compoundingProfile(ctx.orgId));
  if (requiredStake > 0) {
    try {
      await lockStake(createServiceClient(), {
        orgId: ctx.orgId,
        purpose: "listing",
        refId: listing.id,
        amount: requiredStake,
      });
    } catch (e) {
      // Roll back the listing so we never leave one un-staked.
      await supabase.from("marketplace_listings").delete().eq("id", listing.id);
      return { error: e instanceof Error ? e.message : "Could not lock listing stake." };
    }
  }

  revalidatePath("/marketplace");
  return {};
}

// Take a matched listing to an investor: queue a gated outreach through the same
// gate/dispatch path the Capital Map uses. Tier 2 by default — it reaches a
// counterparty, so it lands in approvals unless a mandate pre-authorizes it, and
// it warms the relationship on the graph via the engagement feedback loop.
export async function queueListingOutreach(formData: FormData): Promise<void> {
  const investorId = String(formData.get("investor_id") ?? "").trim();
  const title = String(formData.get("listing_title") ?? "").trim() || "this listing";
  if (!investorId) return;
  await queueNextAction(investorId, "send_outreach", `Marketplace outreach · ${title}`);
  revalidatePath("/marketplace");
}

// Advance a listing through its lifecycle: draft → listed → paused → closed,
// wrapping back to draft. A free-form `status` override is also accepted.
export async function updateListingStatus(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  let next: MarketplaceStatus | null = null;
  const explicit = String(formData.get("status") ?? "").trim();
  if (STATUSES.includes(explicit as MarketplaceStatus)) {
    next = explicit as MarketplaceStatus;
  } else {
    const current = String(formData.get("current") ?? "draft") as MarketplaceStatus;
    const idx = STATUSES.indexOf(current);
    next = STATUSES[(idx + 1) % STATUSES.length];
  }
  if (!next) return;

  const supabase = await createServerClient();
  await supabase
    .from("marketplace_listings")
    .update({ status: next })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  // On honest completion, return the listing stake (TOKENIZATION_LAYERS.md §4.3).
  // resolveListingStake is idempotent and a no-op when there's no locked stake.
  // TODO: bad-faith forfeiture ("forfeited") needs the dispute/appeal path from
  // spec §9 before it can move real stakes — out of scope for this change.
  if (next === "closed") {
    await resolveListingStake(createServiceClient(), id, "returned");
  }

  revalidatePath("/marketplace");
}

// File a bad-faith dispute against a listing's stake (e.g. an operator reports a
// misrepresented deal or a ghosted match). This does NOT burn the stake: it opens
// an appealable dispute (TOKENIZATION_LAYERS.md §9 due process) so no real credits
// move before resolution. The staker under challenge is the listing's owning org;
// the reporter (ctx.userId) is recorded as opened_by.
// TODO: admin resolution surface — upheld/dismissed (resolveDispute) is an ops
// concern and has no UI yet.
export async function fileListingStakeDispute(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!id) return { error: "Listing id is required" };

  const service = createServiceClient();

  // Resolve the staker (listing owner) — the org whose stake is under challenge.
  const { data: listing } = await service
    .from("marketplace_listings")
    .select("organization_id")
    .eq("id", id)
    .maybeSingle();
  if (!listing) return { error: "Listing not found" };

  try {
    const dispute = await forfeitListingStakeViaDispute(service, id, {
      orgId: listing.organization_id,
      reason,
      openedBy: ctx.userId,
    });
    if (!dispute) {
      return { error: "No locked stake to dispute for this listing." };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not file dispute." };
  }

  revalidatePath("/marketplace");
  return {};
}

export async function toggleListingPublic(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const isPublic = String(formData.get("is_public") ?? "") === "true";
  if (!id) return;

  const supabase = await createServerClient();
  await supabase
    .from("marketplace_listings")
    .update({ is_public: !isPublic })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath("/marketplace");
}

// Record interest in a listing and notify the listing owner via an agenda task.
export async function expressInterestInListing(
  listingId: string,
  listingTitle: string,
): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const supabase = await createServerClient();
  const { data: listing } = await supabase
    .from("marketplace_listings")
    .select("organization_id")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing) return { error: "Listing not found." };
  if (listing.organization_id === ctx.orgId)
    return { error: "This is your own listing." };

  // Record the interest (upsert so double-clicks are idempotent).
  const { error: intErr } = await supabase
    .from("marketplace_interests")
    .upsert(
      { listing_id: listingId, organization_id: ctx.orgId, user_id: ctx.userId },
      { onConflict: "listing_id,organization_id", ignoreDuplicates: true },
    );
  if (intErr) return { error: intErr.message };

  // Notify the listing owner: insert an awaiting-approval task in their org so
  // the interest surfaces in their inbox needsApproval lane. Use service client
  // to write across org boundary. Encode the listing URL in description so the
  // inbox can deep-link directly to the listing detail page.
  try {
    const service = createServiceClient();
    await service.from("tasks").insert({
      organization_id: listing.organization_id,
      title: `Marketplace interest · ${listingTitle}`,
      description: `/marketplace/${listingId}`,
      hub: "source" as const,
      assigned_agent: "rainmaker" as AgentKey,
      status: "awaiting_approval",
      progress: 0,
      requires_approval: true,
      step_order: 0,
    });
  } catch {
    // Non-fatal — interest is recorded even if notification fails.
  }

  revalidatePath("/marketplace/browse");
  revalidatePath(`/marketplace/${listingId}`);
  return {};
}

export async function updateListing(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Listing id is required" };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Title is required" };

  const summary = String(formData.get("summary") ?? "").trim() || null;
  const listingType = String(formData.get("listing_type") ?? "").trim() || undefined;
  const targetIrrRaw = String(formData.get("target_irr") ?? "").trim();
  const holdPeriodRaw = String(formData.get("hold_period_years") ?? "").trim();
  const geography = String(formData.get("geography") ?? "").trim() || null;
  const assetClass = String(formData.get("asset_class") ?? "").trim() || null;
  const teaserUrl = String(formData.get("teaser_url") ?? "").trim() || null;
  const country = String(formData.get("country") ?? "").trim() || null;
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase() || "USD";
  const ebitda = parseMoney(formData.get("ebitda"));
  const grossRevenue = parseMoney(formData.get("gross_revenue"));
  const featured = formData.get("featured") === "on";

  const amount = parseMoney(formData.get("amount"));
  let targetIrr: number | null = null;
  if (targetIrrRaw) {
    const parsed = Number(targetIrrRaw.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(parsed) && parsed > 0) targetIrr = parsed;
  }
  let holdPeriodYears: number | null = null;
  if (holdPeriodRaw) {
    const parsed = Number(holdPeriodRaw.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(parsed) && parsed > 0) holdPeriodYears = parsed;
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("marketplace_listings")
    .update({
      title,
      summary,
      ...(listingType ? { listing_type: listingType } : {}),
      amount,
      target_irr: targetIrr,
      hold_period_years: holdPeriodYears,
      geography,
      asset_class: assetClass,
      teaser_url: teaserUrl,
      country,
      currency,
      ebitda,
      gross_revenue: grossRevenue,
      featured,
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (error) return { error: error.message };

  revalidatePath("/marketplace");
  revalidatePath(`/marketplace/${id}`);
  return {};
}

export async function deleteListing(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createServerClient();
  await supabase
    .from("marketplace_listings")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath("/marketplace");
}
