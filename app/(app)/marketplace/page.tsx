import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Investor, MarketplaceListing, MarketplaceStatus } from "@/lib/supabase/database.types";
import { rankInvestorsForListing, type InvestorMatch, type ListingContext } from "@/lib/matching";
import { compoundingProfile } from "@/lib/compounding";
import { requiredListingStake } from "@/lib/stake";
import { TierBadge, tierLabel } from "@/components/TierBadge";
import { NewListingForm } from "./NewListingForm";
import { EditListingForm } from "./EditListingForm";
import { updateListingStatus, toggleListingPublic, deleteListing, queueListingOutreach } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_ORDER: MarketplaceStatus[] = ["listed", "draft", "paused", "closed"];

const STATUS_LABEL: Record<MarketplaceStatus, string> = {
  draft: "Draft",
  listed: "Listed",
  paused: "Paused",
  closed: "Closed",
};

const STATUS_BADGE: Record<MarketplaceStatus, string> = {
  listed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  draft: "border-line text-fg-muted",
  paused: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  closed: "border-line text-fg-muted/70",
};

// What "advance" does next, used to label the lifecycle button.
const NEXT_LABEL: Record<MarketplaceStatus, string> = {
  draft: "List",
  listed: "Pause",
  paused: "Close",
  closed: "Reopen",
};

function formatAmount(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function prettyType(t: string): string {
  return t
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
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
  const deals = (dealsRes.data ?? []) as { id: string; name: string; geography: string | null; asset_class: string | null }[];

  // Score every listing against this firm's investors so each card can show
  // "who should I take this to?" — the inverse of the Capital Map's view.
  const dealCtx = new Map<string, ListingContext>();
  for (const d of deals) dealCtx.set(d.id, { geography: d.geography, assetClass: d.asset_class });
  const matchesByListing: Record<string, InvestorMatch[]> = {};
  if (investors.length) {
    for (const l of listings) {
      const ctx = (l.deal_id && dealCtx.get(l.deal_id)) || {};
      const m = rankInvestorsForListing(l, investors, { ctx, limit: 3 });
      if (m.length) matchesByListing[l.id] = m;
    }
  }

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: listings.filter((l) => l.status === status),
  })).filter((g) => g.items.length > 0);

  const liveCount = listings.filter((l) => l.status === "listed").length;
  const publicCount = listings.filter((l) => l.is_public).length;
  const totalValue = listings.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const compactUsd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
    notation: "compact",
  });

  // The refundable credit stake this org locks to publish a listing, scaled down
  // by its reputation (see docs/TOKENIZATION_LAYERS.md §4.2). Threaded into the
  // create form so the cost is visible before posting.
  const listingStake = requiredListingStake(profile);

  return (
    <div className="fx-ambient mx-auto max-w-4xl">
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
        <Link
          href="/marketplace"
          className="rounded-md bg-surface-2 px-3 py-1.5 text-fg-primary"
        >
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
              { label: "Submit LP report", href: "/reports" },
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
            Next: <span className="text-fg-secondary">Established</span> — close 3+ more deals or raise external capital to advance.
          </p>
        ) : profile.tier === "established" ? (
          <p className="mt-1.5 text-[11px] text-fg-muted">
            Next: <span className="text-fg-secondary">Principal</span> — sustain track record and network depth to advance.
          </p>
        ) : null}
      </div>

      {listings.length > 0 ? (
        <div className="mb-6 grid animate-fade-up grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Listings", value: String(listings.length) },
            { label: "Live", value: String(liveCount), accent: "text-emerald-300" },
            { label: "Public", value: String(publicCount), accent: "text-gold-400" },
            {
              label: "Total value",
              value: totalValue > 0 ? compactUsd.format(totalValue) : "—",
            },
          ].map((s) => (
            <div key={s.label} className="fx-stat">
              <div
                className={`font-display text-2xl font-semibold tracking-tight ${
                  s.accent ?? "text-fg-primary"
                }`}
              >
                {s.value}
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <NewListingForm
        deals={deals.map((d) => ({ id: d.id, name: d.name }))}
        requiredStake={listingStake}
        tier={profile.tier}
      />

      <section className="mt-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
          Your listings
        </h2>

        {listings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
            No listings yet. Create one above — try{" "}
            <span className="text-fg-secondary">
              &ldquo;Series B secondary, $4M allocation&rdquo;
            </span>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {grouped.map((group) => (
              <div key={group.status}>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                  {STATUS_LABEL[group.status]} · {group.items.length}
                </p>
                <div className="flex flex-col gap-2">
                  {group.items.map((l, i) => {
                    const amount = formatAmount(l.amount);
                    return (
                      <div
                        key={l.id}
                        className="fx-card fx-card-hover animate-fade-up p-4"
                        style={{ animationDelay: `${Math.min(i * 35, 280)}ms` }}
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link href={`/marketplace/${l.id}`} className="text-sm font-medium text-fg-primary hover:text-gold-200 transition">{l.title}</Link>
                              <span
                                className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${STATUS_BADGE[l.status]}`}
                              >
                                {STATUS_LABEL[l.status]}
                              </span>
                              {l.is_public ? (
                                <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                                  Public
                                </span>
                              ) : (
                                <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                                  Private
                                </span>
                              )}
                            </div>
                            {l.summary ? (
                              <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">
                                {l.summary}
                              </p>
                            ) : null}
                            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                              {prettyType(l.listing_type)}
                              {amount ? ` · ${amount}` : ""}
                              {" · "}
                              {timeAgo(l.created_at)}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <form action={updateListingStatus}>
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="current" value={l.status} />
                              <button className="rounded-md bg-gold-500 px-2.5 py-1 text-xs font-medium text-surface-0 transition hover:bg-gold-400">
                                {NEXT_LABEL[l.status]}
                              </button>
                            </form>
                            <EditListingForm listing={l} />
                            <form action={toggleListingPublic}>
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="is_public" value={String(l.is_public)} />
                              <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                                {l.is_public ? "Make private" : "Make public"}
                              </button>
                            </form>
                            <form action={deleteListing}>
                              <input type="hidden" name="id" value={l.id} />
                              <button className="rounded-md border border-status-danger/40 px-2.5 py-1 text-xs text-status-danger transition hover:bg-status-danger/10">
                                Delete
                              </button>
                            </form>
                          </div>
                        </div>

                        {/* Nudge to complete draft listings missing a summary */}
                        {l.status === "draft" && !l.summary ? (
                          <p className="mt-2 text-[11px] text-fg-muted">
                            <span className="text-gold-400">Tip:</span> Add a summary so buyers know what this is before you list it.
                          </p>
                        ) : null}

                        {/* Best-fit investors — Fintrx/OpenVC enriched: check range + AUM + fit score. */}
                        {matchesByListing[l.id]?.length ? (
                          <div className="mt-3 rounded-lg border border-gold-500/25 bg-gold-500/[0.05] p-3">
                            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                              Best-fit investors
                            </p>
                            <div className="mt-1.5 flex flex-col gap-2">
                              {matchesByListing[l.id].map((m) => {
                                const inv = m.investor;
                                const checkRange =
                                  inv.typical_check_min != null || inv.typical_check_max != null
                                    ? `${inv.typical_check_min != null ? compactUsd.format(inv.typical_check_min) : "—"}–${inv.typical_check_max != null ? compactUsd.format(inv.typical_check_max) : "—"} check`
                                    : null;
                                const aum = inv.aum != null ? `${compactUsd.format(inv.aum)} AUM` : null;
                                return (
                                  <div key={inv.id} className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-sm font-medium text-fg-primary">{inv.name}</span>
                                        <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                                          {m.score} fit
                                        </span>
                                        {inv.investor_type ? (
                                          <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                                            {inv.investor_type.replace(/_/g, " ")}
                                          </span>
                                        ) : null}
                                      </div>
                                      {(checkRange || aum) ? (
                                        <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                                          {[aum, checkRange].filter(Boolean).join(" · ")}
                                        </p>
                                      ) : null}
                                    </div>
                                    <form action={queueListingOutreach} className="shrink-0 self-center">
                                      <input type="hidden" name="investor_id" value={inv.id} />
                                      <input type="hidden" name="listing_title" value={l.title} />
                                      <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary">
                                        Queue outreach
                                      </button>
                                    </form>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
