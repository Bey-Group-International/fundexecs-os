"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import {
  discoverBuyers,
  discoverAddOns,
  rankBuyersForTarget,
  summarizeAcquisitions,
  listAcquisitions,
  listBuyers,
  recordAcquisitions,
  recordBuyers,
  buyerRowToLike,
  acquisitionRowToLike,
  type BuyerCandidate,
  type AddOnResult,
  type RankedBuyer,
  type AcquisitionSummary,
  type AcquisitionInput,
  type BuyerInput,
  type TargetLike,
  type PlatformLike,
} from "@/lib/ownership-intel";
import type { Acquisition } from "@/lib/supabase/database.types";

// Resolve a target's sector/geography/size. Prefer an explicit deal row when a
// dealId is given (reusing the deals table); otherwise fall back to the name +
// any caller-supplied hints. Self-contained — does not depend on a catalog.
async function resolveTarget(
  orgId: string,
  args: { targetName?: string | null; dealId?: string | null; sector?: string | null; geography?: string | null },
): Promise<TargetLike | null> {
  const supabase = createServerClient();
  if (args.dealId) {
    const { data } = await supabase
      .from("deals")
      .select("name, asset_class, geography, target_amount")
      .eq("organization_id", orgId)
      .eq("id", args.dealId)
      .maybeSingle();
    if (data) {
      return {
        name: data.name,
        sector: args.sector ?? data.asset_class ?? null,
        geography: args.geography ?? data.geography ?? null,
        size: data.target_amount ?? null,
      };
    }
  }
  const name = (args.targetName ?? "").trim();
  if (!name) return null;
  return { name: name.slice(0, 200), sector: args.sector ?? null, geography: args.geography ?? null, size: null };
}

export interface BuyersResult {
  ok: boolean;
  target?: string;
  /** AI/deterministic buyer candidates for the target. */
  candidates?: BuyerCandidate[];
  /** Ranked matches against buyer_profiles already on file. */
  onFile?: RankedBuyer[];
  /** How many fresh buyer profiles were saved to the org. */
  saved?: number;
  error?: string;
}

// "Who would buy this business?" — discover plausible buyers for a target
// (Claude-optional, deterministic fallback), rank any buyer_profiles already on
// file against it, and persist the fresh discoveries so the list compounds.
export async function buyersForTarget(args: {
  targetName?: string | null;
  dealId?: string | null;
  sector?: string | null;
  geography?: string | null;
  save?: boolean;
}): Promise<BuyersResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const orgId = auth.ctx.orgId;
  const target = await resolveTarget(orgId, args);
  if (!target) return { ok: false, error: "Name a target business or pick a deal." };

  const supabase = createServerClient();
  const [candidates, existing] = await Promise.all([
    discoverBuyers(target),
    listBuyers(supabase, orgId, { limit: 300 }),
  ]);

  const onFile = rankBuyersForTarget(existing.map(buyerRowToLike), target, { limit: 8 });

  let saved = 0;
  if (args.save !== false && candidates.length) {
    const inputs: BuyerInput[] = candidates.map((c) => ({
      name: c.name,
      buyerType: c.buyerType,
      thesis: c.thesis ?? null,
      sectors: c.sectors ?? [],
      geographies: c.geographies ?? [],
      checkMin: c.checkMin ?? null,
      checkMax: c.checkMax ?? null,
      appetite: c.appetite ?? null,
      sourceUrl: c.sourceUrl ?? null,
      metadata: { fitScore: c.fitScore, rationale: c.rationale, forTarget: target.name },
    }));
    saved = await recordBuyers(supabase, orgId, auth.ctx.userId, inputs);
    if (saved > 0) revalidatePath("/source/buyers");
  }

  return { ok: true, target: target.name, candidates, onFile, saved };
}

export interface AddOnsResult {
  ok: boolean;
  platform?: string;
  addOns?: AddOnResult[];
  error?: string;
}

// Add-on / bolt-on discovery for a platform company (Claude-optional, with a
// deterministic fallback). Resolves the platform from a deal when given.
export async function addOnsForPlatform(args: {
  platformName?: string | null;
  dealId?: string | null;
  sector?: string | null;
  geography?: string | null;
}): Promise<AddOnsResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const target = await resolveTarget(auth.ctx.orgId, {
    targetName: args.platformName,
    dealId: args.dealId,
    sector: args.sector,
    geography: args.geography,
  });
  if (!target) return { ok: false, error: "Name a platform company or pick a deal." };
  const platform: PlatformLike = { name: target.name, sector: target.sector, geography: target.geography };
  const addOns = await discoverAddOns(platform);
  return { ok: true, platform: platform.name, addOns };
}

export interface AcquisitionHistoryResult {
  ok: boolean;
  rows?: Acquisition[];
  summary?: AcquisitionSummary;
  error?: string;
}

// Acquisition history for the org (optionally filtered to a company by name as
// acquirer or target), plus the summarized headline facts.
export async function acquisitionHistory(args: { name?: string | null; limit?: number } = {}): Promise<AcquisitionHistoryResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const rows = await listAcquisitions(supabase, auth.ctx.orgId, {
    name: args.name ?? null,
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  });
  const summary = summarizeAcquisitions(rows.map(acquisitionRowToLike));
  return { ok: true, rows, summary };
}

export interface RecordAcquisitionsResult {
  ok: boolean;
  saved?: number;
  error?: string;
}

// Record one or more acquisitions into the org's history.
export async function recordAcquisitionRows(rows: AcquisitionInput[]): Promise<RecordAcquisitionsResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "Nothing to record." };
  const supabase = createServerClient();
  const saved = await recordAcquisitions(supabase, auth.ctx.orgId, auth.ctx.userId, rows.slice(0, 100));
  if (saved > 0) revalidatePath("/source/buyers");
  return { ok: true, saved };
}

export interface RecordBuyersResult {
  ok: boolean;
  saved?: number;
  error?: string;
}

// Record one or more buyer profiles into the org's buyer list.
export async function recordBuyerRows(rows: BuyerInput[]): Promise<RecordBuyersResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "Nothing to record." };
  const supabase = createServerClient();
  const saved = await recordBuyers(supabase, auth.ctx.orgId, auth.ctx.userId, rows.slice(0, 100));
  if (saved > 0) revalidatePath("/source/buyers");
  return { ok: true, saved };
}

export interface ListBuyersResult {
  ok: boolean;
  buyers?: Awaited<ReturnType<typeof listBuyers>>;
  error?: string;
}

// List the org's saved buyer profiles.
export async function listBuyerProfiles(): Promise<ListBuyersResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const buyers = await listBuyers(supabase, auth.ctx.orgId, { limit: 200 });
  return { ok: true, buyers };
}
