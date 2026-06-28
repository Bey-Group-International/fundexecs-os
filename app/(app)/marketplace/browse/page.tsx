import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { MarketplaceStatus, ReputationTierName } from "@/lib/supabase/database.types";
import { tierForScore, type ReputationTier } from "@/lib/compounding";
import { TierBadge } from "@/components/TierBadge";

export const dynamic = "force-dynamic";

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

// A public listing as surfaced on the cross-org board. Only safe display
// columns are selected — never private/internal-only fields.
type PublicListing = {
  id: string;
  title: string;
  listing_type: string;
  summary: string | null;
  amount: number | null;
  status: MarketplaceStatus;
  created_at: string;
  organization_id: string;
  organizations: { name: string } | null;
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

export default async function MarketplaceBrowsePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  // Defense in depth: filter is_public server-side in addition to the RLS
  // public-read policy. Select only safe display columns plus the owning firm.
  const { data } = await supabase
    .from("marketplace_listings")
    .select("id, title, listing_type, summary, amount, status, created_at, organization_id, organizations(name)")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(100);

  const listings = (data ?? []) as unknown as PublicListing[];

  // Resolve each listing owner's reputation tier so buyers can see who is proven.
  // Batched: one query for the distinct owner org ids, mapped by org id; owners
  // with no stored standing fall back to "unranked". (Avoids a per-listing
  // compoundingProfile call in the render loop.)
  const ownerIds = Array.from(new Set(listings.map((l) => l.organization_id)));
  const tierByOrg = new Map<string, ReputationTier>();
  if (ownerIds.length) {
    const { data: scores } = await supabase
      .from("reputation_scores")
      .select("organization_id, score, tier")
      .in("organization_id", ownerIds);
    for (const s of (scores ?? []) as { organization_id: string; score: number; tier: ReputationTierName }[]) {
      // Derive the tier from score so the band stays consistent with compounding.ts.
      tierByOrg.set(s.organization_id, tierForScore(s.score));
    }
  }
  const ownerTier = (orgId: string): ReputationTier => tierByOrg.get(orgId) ?? "unranked";

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
        <div className="flex flex-col gap-2">
          {listings.map((l, i) => {
            const amount = formatAmount(l.amount);
            return (
              <div
                key={l.id}
                className="fx-card fx-card-hover animate-fade-up p-4"
                style={{ animationDelay: `${Math.min(i * 35, 280)}ms` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
                      {l.organizations?.name ?? "Unknown firm"}
                    </p>
                    <TierBadge tier={ownerTier(l.organization_id)} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg-primary">{l.title}</span>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${STATUS_BADGE[l.status]}`}
                    >
                      {STATUS_LABEL[l.status]}
                    </span>
                  </div>
                  {l.summary ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">
                      {l.summary}
                    </p>
                  ) : null}
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {prettyType(l.listing_type)}
                    {amount ? ` · ${amount}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
