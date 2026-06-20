// Global search across the three "war room" record types — deals, LPs
// (investors), and assets. Each hit links into its existing war-room route
// (/deal/{id}, /investor/{id}, /asset/{id}). Queries are org-scoped (callers
// pass the active orgId; RLS also enforces this) and bounded per table so the
// search box stays snappy. Short/empty queries skip the DB entirely.
import { createServerClient } from "@/lib/supabase/server";
import type { Deal, Investor, Asset } from "@/lib/supabase/database.types";

export type SearchKind = "deal" | "investor" | "asset";

export interface SearchHit {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  href: string;
}

export interface SearchResults {
  query: string;
  deals: SearchHit[];
  investors: SearchHit[];
  assets: SearchHit[];
  total: number;
}

// Minimum query length before we bother the database. One-character queries
// match almost everything and aren't useful.
export const MIN_QUERY_LENGTH = 2;
// Per-table cap so a broad match can't flood any one section.
export const PER_TABLE_LIMIT = 8;

// Trim + lowercase a raw query and guard its length. Returns "" when the query
// is empty or too short to be meaningful — callers treat "" as "no search".
export function normalizeQuery(q: string | null | undefined): string {
  const trimmed = (q ?? "").trim().toLowerCase();
  return trimmed.length >= MIN_QUERY_LENGTH ? trimmed : "";
}

// The subset of each record the shaping helpers actually read. Keeping these
// narrow lets the unit tests pass plain fixtures without a full DB row.
type DealLike = Pick<Deal, "id" | "name" | "stage" | "asset_class">;
type InvestorLike = Pick<Investor, "id" | "name" | "investor_type" | "pipeline_stage">;
type AssetLike = Pick<Asset, "id" | "name" | "asset_type" | "status">;

// Turn an enum/slug-ish token ("ic_review", "family_office") into a readable
// label ("Ic review", "Family office") for the subtitle.
function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const spaced = value.replace(/_/g, " ").trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function dealToHit(deal: DealLike): SearchHit {
  const subtitle = [humanize(deal.stage), humanize(deal.asset_class)]
    .filter(Boolean)
    .join(" · ");
  return {
    id: deal.id,
    kind: "deal",
    title: deal.name,
    subtitle,
    href: `/deal/${deal.id}`,
  };
}

export function investorToHit(investor: InvestorLike): SearchHit {
  const subtitle = [humanize(investor.investor_type), humanize(investor.pipeline_stage)]
    .filter(Boolean)
    .join(" · ");
  return {
    id: investor.id,
    kind: "investor",
    title: investor.name,
    subtitle,
    href: `/investor/${investor.id}`,
  };
}

export function assetToHit(asset: AssetLike): SearchHit {
  const subtitle = [humanize(asset.asset_type), humanize(asset.status)]
    .filter(Boolean)
    .join(" · ");
  return {
    id: asset.id,
    kind: "asset",
    title: asset.name,
    subtitle,
    href: `/asset/${asset.id}`,
  };
}

function emptyResults(query: string): SearchResults {
  return { query, deals: [], investors: [], assets: [], total: 0 };
}

// Run the three case-insensitive name searches in parallel, org-scoped and
// bounded. Best-effort: a failure on any one table degrades to no hits for
// that table rather than throwing the whole search.
export async function searchAll(
  orgId: string,
  query: string,
): Promise<SearchResults> {
  const normalized = normalizeQuery(query);
  // Preserve the caller's (trimmed) query for display, but skip the DB when
  // there's nothing meaningful to search for.
  const display = (query ?? "").trim();
  if (!normalized) return emptyResults(display);

  try {
    const supabase = createServerClient();
    const pattern = `%${normalized}%`;

    const [dealsRes, investorsRes, assetsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("id, name, stage, asset_class")
        .eq("organization_id", orgId)
        .ilike("name", pattern)
        .order("created_at", { ascending: false })
        .limit(PER_TABLE_LIMIT),
      supabase
        .from("investors")
        .select("id, name, investor_type, pipeline_stage")
        .eq("organization_id", orgId)
        .ilike("name", pattern)
        .order("created_at", { ascending: false })
        .limit(PER_TABLE_LIMIT),
      supabase
        .from("assets")
        .select("id, name, asset_type, status")
        .eq("organization_id", orgId)
        .ilike("name", pattern)
        .order("created_at", { ascending: false })
        .limit(PER_TABLE_LIMIT),
    ]);

    const deals = ((dealsRes.data ?? []) as DealLike[]).map(dealToHit);
    const investors = ((investorsRes.data ?? []) as InvestorLike[]).map(investorToHit);
    const assets = ((assetsRes.data ?? []) as AssetLike[]).map(assetToHit);

    return {
      query: display,
      deals,
      investors,
      assets,
      total: deals.length + investors.length + assets.length,
    };
  } catch {
    // Search is non-critical UI; never surface a DB error to the page.
    return emptyResults(display);
  }
}
