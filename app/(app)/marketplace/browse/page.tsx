import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { MarketplaceStatus, ReputationTierName } from "@/lib/supabase/database.types";
import { tierForScore, type ReputationTier } from "@/lib/compounding";
import { expressInterestInListing } from "../actions";
import { BrowseListings, type BrowseListing } from "./BrowseListings";

export const dynamic = "force-dynamic";

export default async function MarketplaceBrowsePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("marketplace_listings")
    .select("id, title, listing_type, summary, amount, status, created_at, organization_id, organizations(name)")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(200);

  const raw = (data ?? []) as unknown as Omit<BrowseListing, "ownerTier">[];

  const ownerIds = Array.from(new Set(raw.map((l) => l.organization_id)));
  const tierByOrg = new Map<string, ReputationTier>();
  if (ownerIds.length) {
    const { data: scores } = await supabase
      .from("reputation_scores")
      .select("organization_id, score, tier")
      .in("organization_id", ownerIds);
    for (const s of (scores ?? []) as { organization_id: string; score: number; tier: ReputationTierName }[]) {
      tierByOrg.set(s.organization_id, tierForScore(s.score));
    }
  }

  const listings: BrowseListing[] = raw.map((l) => ({
    ...l,
    ownerTier: tierByOrg.get(l.organization_id) ?? "unranked",
  }));

  return (
    <div className="fx-ambient mx-auto max-w-4xl">
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(212,175,106,0.6)]" />
          Marketplace
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Browse
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-secondary">
          Public listings from across every firm on FundExecs. Deals, funds, and allocations
          counterparties have opened to the network.
        </p>
      </header>

      <nav className="fx-segment mb-6 inline-flex font-mono text-xs uppercase tracking-wider">
        <Link
          href="/marketplace"
          className="rounded-md px-3 py-1.5 text-fg-muted transition hover:text-fg-primary"
        >
          My listings
        </Link>
        <Link
          href="/marketplace/browse"
          className="rounded-md bg-surface-2 px-3 py-1.5 text-fg-primary"
        >
          Browse
        </Link>
      </nav>

      {listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-1 p-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 text-lg text-gold-300">
            ◈
          </div>
          <p className="text-sm font-medium text-fg-primary">Marketplace is launching soon</p>
          <p className="mt-2 max-w-sm mx-auto text-sm text-fg-muted">
            The FundExecs Marketplace connects fund managers with LPs, co-investors, and
            secondary buyers. Public listings from verified funds will appear here.
          </p>
          <Link
            href="/marketplace"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20"
          >
            Create your first listing →
          </Link>
        </div>
      ) : (
        <BrowseListings
          listings={listings}
          onExpressInterest={expressInterestInListing}
        />
      )}
    </div>
  );
}
