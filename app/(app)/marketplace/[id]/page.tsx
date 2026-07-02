import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { MarketplaceListing, MarketplaceStatus } from "@/lib/supabase/database.types";
import { compoundingProfile, tierForScore, type ReputationTier } from "@/lib/compounding";
import { TierBadge, tierLabel } from "@/components/TierBadge";
import { expressInterestInListing, updateListingStatus, toggleListingPublic, deleteListing, queueListingOutreach } from "../actions";
import { InterestButton } from "./InterestButton";
import { rankInvestorsForListing } from "@/lib/matching";
import type { Investor } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<MarketplaceStatus, string> = {
  listed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  draft: "border-line text-fg-muted",
  paused: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  closed: "border-line text-fg-muted/70",
};

const STATUS_LABEL: Record<MarketplaceStatus, string> = {
  listed: "Listed",
  draft: "Draft",
  paused: "Paused",
  closed: "Closed",
};

const NEXT_LABEL: Record<MarketplaceStatus, string> = {
  draft: "List",
  listed: "Pause",
  paused: "Close",
  closed: "Reopen",
};

function prettyType(t: string): string {
  const map: Record<string, string> = {
    deal: "Deal",
    fund: "Fund",
    co_invest: "Co-invest",
    secondary: "Secondary",
    service: "Service",
  };
  return map[t] ?? t.split(/[_\s]+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function formatAmount(n: number | null) {
  if (n == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatPct(n: number | null) {
  if (n == null) return null;
  return `${n.toFixed(1)}%`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

export default async function ListingDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  const { data: raw } = await supabase
    .from("marketplace_listings")
    .select("*, organizations(name)")
    .eq("id", params.id)
    .maybeSingle();

  if (!raw) notFound();

  const listing = raw as unknown as MarketplaceListing & { organizations: { name: string } | null };
  const isOwner = listing.organization_id === ctx.orgId;

  // Non-owners can only see public listings
  if (!isOwner && !listing.is_public) notFound();

  // Interest count + whether this org already expressed interest
  const [interestRes, myInterestRes, ownerProfile] = await Promise.all([
    supabase
      .from("marketplace_interests")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", params.id),
    isOwner
      ? Promise.resolve({ data: null })
      : supabase
          .from("marketplace_interests")
          .select("id")
          .eq("listing_id", params.id)
          .eq("organization_id", ctx.orgId)
          .maybeSingle(),
    isOwner
      ? compoundingProfile(ctx.orgId)
      : supabase
          .from("reputation_scores")
          .select("score")
          .eq("organization_id", listing.organization_id)
          .maybeSingle()
          .then((r) => {
            const score = (r.data as { score: number } | null)?.score ?? 0;
            return { tier: tierForScore(score) as ReputationTier };
          }),
  ]);

  const interestCount = interestRes.count ?? 0;
  const alreadyInterested = !isOwner && !!myInterestRes.data;
  const ownerTier = ownerProfile.tier as ReputationTier;

  // Proactive investor matching — only computed for the listing owner.
  // Fetches their capital-map investors and ranks them against this listing
  // so the owner can immediately see who to take it to.
  let matchedInvestors: { investor: Investor; score: number; reasons: string[] }[] = [];
  if (isOwner) {
    const { data: investors } = await supabase
      .from("investors")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .neq("status", "archived")
      .order("name");
    if (investors?.length) {
      const ctx_listing = {
        geography: listing.geography ?? undefined,
        assetClass: listing.asset_class ?? undefined,
      };
      matchedInvestors = rankInvestorsForListing(
        listing,
        investors as Investor[],
        { ctx: ctx_listing, minScore: 40, limit: 5 },
      );
    }
  }

  const dealCardFields = [
    listing.target_irr != null && { label: "Target IRR", value: formatPct(listing.target_irr) },
    listing.hold_period_years != null && { label: "Hold period", value: `${listing.hold_period_years}y` },
    listing.geography && { label: "Geography", value: listing.geography },
    listing.asset_class && { label: "Asset class", value: listing.asset_class },
    listing.amount != null && { label: "Amount", value: formatAmount(listing.amount) },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="fx-ambient mx-auto max-w-3xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted animate-fade-up">
        <Link href="/marketplace/browse" className="hover:text-fg-secondary transition">Marketplace</Link>
        <span>/</span>
        <span className="text-fg-primary">{listing.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6 animate-fade-up">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            {listing.organizations?.name ?? "Unknown firm"}
          </span>
          <TierBadge tier={ownerTier} />
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${STATUS_BADGE[listing.status]}`}
          >
            {STATUS_LABEL[listing.status]}
          </span>
          {listing.is_public ? (
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
              Public
            </span>
          ) : (
            <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              Private
            </span>
          )}
        </div>

        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg-primary">
          {listing.title}
        </h1>

        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          {prettyType(listing.listing_type)} · {timeAgo(listing.created_at)}
          {interestCount > 0 ? ` · ${interestCount} interested` : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Main content */}
        <div className="flex flex-col gap-4 sm:col-span-2">
          {listing.summary ? (
            <div className="fx-card p-4">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Overview</p>
              <p className="text-sm leading-relaxed text-fg-secondary">{listing.summary}</p>
            </div>
          ) : null}

          {dealCardFields.length > 0 ? (
            <div className="fx-card p-4">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Deal details</p>
              <dl className="grid grid-cols-2 gap-3">
                {dealCardFields.map((f) => (
                  <div key={f.label}>
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{f.label}</dt>
                    <dd className="mt-0.5 text-sm font-medium text-fg-primary">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {listing.teaser_url ? (
            <div className="fx-card p-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Materials</p>
              <a
                href={listing.teaser_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-sm text-gold-300 transition hover:bg-gold-500/20"
              >
                View teaser / data room →
              </a>
            </div>
          ) : null}

          {!listing.summary && dealCardFields.length === 0 && !listing.teaser_url ? (
            <div className="fx-card p-6 text-center">
              <p className="text-sm text-fg-muted">
                {isOwner
                  ? "Add a summary, deal details, and a teaser link to make this listing more compelling to buyers."
                  : "The seller hasn't added detail yet."}
              </p>
              {isOwner ? (
                <Link
                  href="/marketplace"
                  className="mt-3 inline-block text-xs text-gold-400 underline underline-offset-2 hover:text-gold-300"
                >
                  Edit listing →
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-3">
          {/* CTA */}
          {!isOwner ? (
            <div className="fx-card p-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Interested?</p>
              <InterestButton
                listingId={listing.id}
                listingTitle={listing.title}
                alreadyInterested={alreadyInterested}
                onExpressInterest={expressInterestInListing}
              />
              <p className="mt-2 text-[11px] leading-snug text-fg-muted">
                Expressing interest queues a routed outreach to the listing owner.
              </p>
            </div>
          ) : null}

          {/* Owner controls */}
          {isOwner ? (
            <div className="fx-card p-4">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Controls</p>
              <div className="flex flex-col gap-2">
                <form action={updateListingStatus}>
                  <input type="hidden" name="id" value={listing.id} />
                  <input type="hidden" name="current" value={listing.status} />
                  <button className="w-full rounded-md bg-gold-500 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-400">
                    {NEXT_LABEL[listing.status]}
                  </button>
                </form>
                <form action={toggleListingPublic}>
                  <input type="hidden" name="id" value={listing.id} />
                  <input type="hidden" name="is_public" value={String(listing.is_public)} />
                  <button className="w-full rounded-md border border-line px-3 py-1.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                    {listing.is_public ? "Make private" : "Make public"}
                  </button>
                </form>
                <form action={deleteListing}>
                  <input type="hidden" name="id" value={listing.id} />
                  <button className="w-full rounded-md border border-status-danger/40 px-3 py-1.5 text-sm text-status-danger transition hover:bg-status-danger/10">
                    Delete listing
                  </button>
                </form>
              </div>
              {interestCount > 0 ? (
                <p className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300">
                  {interestCount} {interestCount === 1 ? "firm has" : "firms have"} expressed interest.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Matched investors from capital map */}
          {isOwner && matchedInvestors.length > 0 ? (
            <div className="fx-card p-4">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Matched from your pipeline
              </p>
              <div className="flex flex-col gap-2">
                {matchedInvestors.map(({ investor, score, reasons }) => (
                  <div key={investor.id} className="rounded-md border border-line bg-surface-1 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-fg-primary">{investor.name}</p>
                        {reasons[0] ? (
                          <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{reasons[0]}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] text-gold-300">
                        {score}
                      </span>
                    </div>
                    <form action={queueListingOutreach} className="mt-2">
                      <input type="hidden" name="investor_id" value={investor.id} />
                      <input type="hidden" name="listing_title" value={listing.title} />
                      <button className="w-full rounded border border-line px-2 py-1 text-[11px] text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300">
                        Queue outreach
                      </button>
                    </form>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-fg-muted">
                Scored by check size, geography, and investor type.
              </p>
            </div>
          ) : null}

          {/* Standing */}
          {!isOwner ? (
            <div className="fx-card p-4">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Seller standing</p>
              <div className="flex items-center gap-2">
                <TierBadge tier={ownerTier} />
                <span className="text-xs text-fg-secondary">{tierLabel(ownerTier)}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
