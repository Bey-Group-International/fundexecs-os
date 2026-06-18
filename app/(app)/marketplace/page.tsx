import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { MarketplaceListing, MarketplaceStatus } from "@/lib/supabase/database.types";
import { NewListingForm } from "./NewListingForm";
import { updateListingStatus, toggleListingPublic, deleteListing } from "./actions";

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

export default async function MarketplacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("marketplace_listings")
    .select("*")
    .order("created_at", { ascending: false });
  const listings = (data ?? []) as MarketplaceListing[];

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: listings.filter((l) => l.status === status),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Marketplace
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Listings
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Publish deals, funds, and allocations to the marketplace. Listings start private and in
          draft — move them to listed and public when they&rsquo;re ready for counterparties.
        </p>
      </header>

      <nav className="mb-6 inline-flex rounded-lg border border-line bg-surface-1 p-1 font-mono text-xs uppercase tracking-wider">
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

      <NewListingForm />

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
                  {group.items.map((l) => {
                    const amount = formatAmount(l.amount);
                    return (
                      <div key={l.id} className="rounded-xl border border-line bg-surface-1 p-4">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-fg-primary">{l.title}</span>
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
                            <form action={toggleListingPublic}>
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="is_public" value={String(l.is_public)} />
                              <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                                {l.is_public ? "Make private" : "Make public"}
                              </button>
                            </form>
                            <form action={deleteListing}>
                              <input type="hidden" name="id" value={l.id} />
                              <button className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:border-red-500/40 hover:text-red-400">
                                ✕
                              </button>
                            </form>
                          </div>
                        </div>
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
