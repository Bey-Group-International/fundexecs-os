import Link from "next/link";
import type { ReactNode } from "react";
import type { MarketplaceStatus } from "@/lib/supabase/database.types";
import { resolveCountry } from "@/lib/marketplace/flags";
import { priceDisplay, subMetricFor, prettyType, timeAgo, isNew } from "@/lib/marketplace/format";

// Presentational, hook-free card shared by the owner console and Browse board.
// `actions` and `footer` are slots so each surface injects its own controls
// (manage buttons + matching, or an express-interest button) without forking
// the card. Works in both list and grid layouts.

export type ListingCardData = {
  id: string;
  title: string;
  summary: string | null;
  listing_type: string;
  status: MarketplaceStatus;
  amount: number | null;
  currency: string;
  country: string | null;
  asset_class: string | null;
  reference_code: string | null;
  ebitda: number | null;
  gross_revenue: number | null;
  target_irr: number | null;
  featured: boolean;
  teaser_url: string | null;
  created_at: string;
};

export type ListingView = "list" | "grid";

function Labels({ listing }: { listing: ListingCardData }) {
  const isNewListing = isNew(listing.created_at);
  if (!listing.featured && !isNewListing) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {listing.featured ? (
        <span className="rounded-full border border-gold-500/50 bg-gold-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
          ★ Featured
        </span>
      ) : null}
      {isNewListing ? (
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
          New
        </span>
      ) : null}
    </div>
  );
}

function MetaChips({ listing }: { listing: ListingCardData }) {
  const country = resolveCountry(listing.country);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
      {country ? (
        <span className="inline-flex items-center gap-1 text-fg-secondary">
          <span aria-hidden className="text-xs leading-none">
            {country.flag}
          </span>
          {country.label}
        </span>
      ) : null}
      {country ? <span className="opacity-40">·</span> : null}
      <span className="text-neural-300">{prettyType(listing.listing_type)}</span>
      {listing.asset_class ? (
        <>
          <span className="opacity-40">·</span>
          <span>{listing.asset_class}</span>
        </>
      ) : null}
      {listing.reference_code ? (
        <>
          <span className="opacity-40">·</span>
          <span className="opacity-70">{listing.reference_code}</span>
        </>
      ) : null}
    </div>
  );
}

function Price({ listing, align = "right" }: { listing: ListingCardData; align?: "left" | "right" }) {
  const price = priceDisplay(listing.amount, listing.currency);
  const sub = subMetricFor(listing);
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <div className="font-display text-lg font-semibold tracking-tight text-gold-200">{price}</div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {sub.value}
        <span className="opacity-60"> / {sub.label}</span>
      </div>
    </div>
  );
}

export function ListingCard({
  listing,
  href,
  view = "list",
  eyebrow,
  badges,
  actions,
  footer,
  index = 0,
}: {
  listing: ListingCardData;
  href: string;
  view?: ListingView;
  eyebrow?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  index?: number;
}) {
  const delay = `${Math.min(index * 30, 280)}ms`;

  if (view === "grid") {
    return (
      <div
        className="fx-card fx-card-hover animate-fade-up flex flex-col p-4"
        style={{ animationDelay: delay }}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <MetaChips listing={listing} />
          <Labels listing={listing} />
        </div>
        {eyebrow ? <div className="mb-1">{eyebrow}</div> : null}
        <Link
          href={href}
          className="text-sm font-medium leading-snug text-fg-primary transition hover:text-gold-200"
        >
          {listing.title}
        </Link>
        {listing.summary ? (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">{listing.summary}</p>
        ) : null}
        <div className="mt-3 flex items-end justify-between gap-2 border-t border-line/60 pt-3">
          <Price listing={listing} align="left" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {timeAgo(listing.created_at)}
          </span>
        </div>
        {badges ? <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div> : null}
        {actions ? <div className="mt-3 flex flex-wrap items-center gap-1.5">{actions}</div> : null}
        {footer}
      </div>
    );
  }

  // List view
  return (
    <div
      className="fx-card fx-card-hover animate-fade-up p-4"
      style={{ animationDelay: delay }}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MetaChips listing={listing} />
            <Labels listing={listing} />
          </div>
          {eyebrow ? <div className="mt-1.5">{eyebrow}</div> : null}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className="text-sm font-medium text-fg-primary transition hover:text-gold-200"
            >
              {listing.title}
            </Link>
            {badges}
          </div>
          {listing.summary ? (
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">
              {listing.summary}
            </p>
          ) : null}
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {timeAgo(listing.created_at)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Price listing={listing} />
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div>
          ) : null}
        </div>
      </div>
      {footer}
    </div>
  );
}
