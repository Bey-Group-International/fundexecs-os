import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Investor, MarketplaceListing } from "@/lib/supabase/database.types";
import { rankInvestorsForListing, type InvestorMatch, type ListingContext } from "@/lib/matching";
import { TrustBar } from "@/components/marketplace/TrustBar";
import { BookMeetingCTA } from "@/components/marketplace/BookMeetingCTA";
import { resolveBookingUrl } from "@/lib/marketplace/booking";
import { formatCompact } from "@/lib/marketplace/format";
import { NewListingForm } from "./NewListingForm";
import { OwnerListings } from "./OwnerListings";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const [listingsRes, investorsRes, dealsRes] = await Promise.all([
    supabase.from("marketplace_listings").select("*").order("created_at", { ascending: false }),
    supabase.from("investors").select("*").limit(500),
    supabase.from("deals").select("id, name, geography, asset_class").limit(500),
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

  // Platform advisor booking link for the top-of-page CTA (deploy Calendly or
  // NEXT_PUBLIC_BOOKING_URL). Per-listing seller links are handled on the cards
  // and detail page.
  const bookingUrl = await resolveBookingUrl();

  const stats = [
    { label: "Listings", value: String(listings.length) },
    { label: "Live", value: String(liveCount), accent: "text-emerald-300" },
    { label: "Public", value: String(publicCount), accent: "text-gold-400" },
    { label: "Total value", value: totalValue > 0 ? formatCompact(totalValue)! : "—" },
  ];

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-6 border-b border-line/70 pb-5 animate-fade-up">
        <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-fg-muted">
          Marketplace
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Listings
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg-secondary">
          Publish deals, funds, and allocations for distribution to counterparties. Listings are
          created private and in draft; promote them to listed and public once they are cleared for
          circulation.
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

      {listings.length > 0 ? <TrustBar stats={stats} /> : null}

      <BookMeetingCTA
        href={bookingUrl ?? undefined}
        label="Consult an advisor"
        sublabel="Review a listing or discuss your mandate — 15 minutes."
      />

      <NewListingForm deals={deals.map((d) => ({ id: d.id, name: d.name }))} />

      <section className="mt-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-fg-muted">
          Your listings
        </h2>
        <OwnerListings listings={listings} matchesByListing={matchesByListing} />
      </section>
    </div>
  );
}
