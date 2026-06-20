import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { buildCapitalMap } from "@/lib/capital-map";
import { rankListingsForInvestor, type ListingMatch, type ListingContext } from "@/lib/matching";
import type { MarketplaceListing } from "@/lib/supabase/database.types";
import { CapitalMap } from "./CapitalMap";

export const dynamic = "force-dynamic";

// The Capital Map — your network as a live map of capital. Relationship
// temperature, thesis fit, warm-intro paths, and gated next actions, assembled
// from the first-party investors / commitments / relationships / thesis tables.
export default async function CapitalMapPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const entries = await buildCapitalMap(supabase);

  // Marketplace ↔ Capital Map flywheel: pull this firm's live listings and the
  // geography of any linked deal, then score each listing against every investor
  // so the map can surface "what live opportunities fit this LP?" inline.
  const [listingsRes, dealsRes] = await Promise.all([
    supabase
      .from("marketplace_listings")
      .select("*")
      .eq("status", "listed")
      .limit(200),
    supabase.from("deals").select("id, geography, asset_class").limit(500),
  ]);
  const listings = (listingsRes.data ?? []) as MarketplaceListing[];
  const dealCtx = new Map<string, ListingContext>();
  for (const d of dealsRes.data ?? []) {
    dealCtx.set(d.id, { geography: d.geography, assetClass: d.asset_class });
  }
  const contextFor = (l: MarketplaceListing): ListingContext =>
    (l.deal_id && dealCtx.get(l.deal_id)) || {};

  const matchesByInvestor: Record<string, ListingMatch[]> = {};
  if (listings.length) {
    for (const entry of entries) {
      const m = rankListingsForInvestor(entry.investor, listings, { contextFor });
      if (m.length) matchesByInvestor[entry.investor.id] = m;
    }
  }

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(212,175,106,0.6)]" />
          Capital Map
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Turn your network into a capital map
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-secondary">
          Every investor scored by temperature and thesis fit, with the warm path
          in and the next move — each routed through the gate so nothing reaches a
          counterparty without your sign-off.
        </p>
      </header>

      <CapitalMap entries={entries} matchesByInvestor={matchesByInvestor} />
    </div>
  );
}
