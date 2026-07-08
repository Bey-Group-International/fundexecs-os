import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Investor, MarketplaceListing } from "@/lib/supabase/database.types";
import { rankInvestorsForListing, type InvestorMatch, type ListingContext } from "@/lib/matching";
import { compoundingProfile } from "@/lib/compounding";
import { requiredListingStake } from "@/lib/stake";
import { TierBadge, tierLabel } from "@/components/TierBadge";
import { TrustBar } from "@/components/marketplace/TrustBar";
import { BookMeetingCTA } from "@/components/marketplace/BookMeetingCTA";
import { formatCompact } from "@/lib/marketplace/format";
import { NewListingForm } from "./NewListingForm";
import { OwnerListings } from "./OwnerListings";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const [listingsRes, investorsRes, dealsRes, profile] = await Promise.all([
    supabase.from("marketplace_listings").select("*").order("created_at", { ascending: false }),
    supabase.from("investors").select("*").limit(500),
    supabase.from("deals").select("id, name, geography, asset_class").limit(500),
    compoundingProfile(ctx.orgId),
  ]);
  const listings = (listingsRes.data ?? []) as MarketplaceListing[];
  const investors = (investorsRes.data ?? []) as Investor[];
  const deals = (dealsRes.data ?? []) as {
    id: string;
    name: string;
    geography: string | null;
    asset_class: string | null;
  }[];

  // Score every listing against this firm's investors so each card can show
  // "who should I take this to?" — the inverse of the Capital Map's view.
  const dealCtx = new Map<string, ListingContext>();
  for (const d of deals) dealCtx.set(d.id, { geography: d.geography, assetClass: d.asset_class });
  const matchesByListing: Record<string, InvestorMatch[]> = {};
  if (investors.length) {
    for (const l of listings) {
      const lctx = (l.deal_id && dealCtx.get(l.deal_id)) || {};
      const m = rankInvestorsForListing(l, investors, { ctx: lctx, limit: 3 });
      if (m.length) matchesByListing[l.id] = m;
    }
  }

  const liveCount = listings.filter((l) => l.status === "listed").length;
  const publicCount = listings.filter((l) => l.is_public).length;
  const totalValue = listings.reduce((sum, l) => sum + (l.amount ?? 0), 0);

  // The refundable credit stake this org locks to publish a listing, scaled down
  // by its reputation (see docs/TOKENIZATION_LAYERS.md §4.2). Threaded into the
  // create form so the cost is visible before posting.
  const listingStake = requiredListingStake(profile);

  const stats = [
    { label: "Listings", value: String(listings.length) },
    { label: "Live", value: String(liveCount), accent: "text-emerald-300" },
    { label: "Public", value: String(publicCount), accent: "text-gold-400" },
    { label: "Total value", value: totalValue > 0 ? formatCompact(totalValue)! : "—" },
  ];

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(212,175,106,0.6)]" />
          Marketplace
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Listings
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-secondary">
          Publish deals, funds, and allocations to the marketplace. Listings start private and in
          draft — move them to listed and public when they&rsquo;re ready for counterparties.
        </p>
      </header>

      <nav className="fx-segment mb-6 inline-flex font-mono text-xs uppercase tracking-wider">
        <Link href="/marketplace" className="rounded-md bg-surface-2 px-3 py-1.5 text-fg-primary">
          My listings
        </Link>
        <Link
          href="/marketplace/browse"
          className="rounded-md px-3 py-1.5 text-fg-muted transition hover:text-fg-primary"
        >
          Browse
        </Link>
      </nav>

      {/* Your standing — earned reputation (closed deals, verified records) lifts
          your listings in discovery and lowers the stake you lock to post. */}
      <div className="mb-6 rounded-2xl border border-neural-400/20 bg-black/45 px-4 py-3 animate-fade-up">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">
            Your standing
          </span>
          <TierBadge tier={profile.tier} />
          <span className="text-sm text-fg-secondary">
            {profile.tier === "unranked"
              ? "Close deals and verify records to earn standing — higher tiers surface your listings first and lower the stake you post."
              : `${tierLabel(profile.tier)} — your listings surface higher and you post a lower stake.`}
          </span>
        </div>
        {profile.tier === "unranked" ? (
          <div className="mt-2.5 flex flex-wrap gap-3">
            {[
              { label: "Close a deal", href: "/deals/feed" },
              { label: "Verify records", href: "/portfolio" },
              { label: "Submit LP report", href: "/execute/reporting" },
            ].map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="rounded-md border border-neural-400/30 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-neural-300 transition hover:border-neural-400/60 hover:text-fg-secondary"
              >
                {a.label} →
              </Link>
            ))}
          </div>
        ) : profile.tier === "verified" ? (
          <p className="mt-1.5 text-[11px] text-fg-muted">
            Next: <span className="text-fg-secondary">Established</span> — close 3+ more deals or
            raise external capital to advance.
          </p>
        ) : profile.tier === "established" ? (
          <p className="mt-1.5 text-[11px] text-fg-muted">
            Next: <span className="text-fg-secondary">Principal</span> — sustain track record and
            network depth to advance.
          </p>
        ) : null}
      </div>

      {listings.length > 0 ? <TrustBar stats={stats} /> : null}

      <BookMeetingCTA />

      <NewListingForm
        deals={deals.map((d) => ({ id: d.id, name: d.name }))}
        requiredStake={listingStake}
        tier={profile.tier}
      />

      <section className="mt-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
          Your listings
        </h2>
        <OwnerListings listings={listings} matchesByListing={matchesByListing} />
      </section>
    </div>
  );
}
