"use server";

// Server actions for the Deal Listing Import panel: parse business/property
// for-sale listings out of a marketplace page (LoopNet, Crexi, BizBuySell,
// BusinessesForSale, Transworld) and land the picked ones in the `deals`
// pipeline. Two ways in, both native and compliant:
//   • paste the listing / search-results HTML (or text) — always works, and the
//     right path for sites whose robots.txt disallows crawling; or
//   • give a listing URL — fetched through the CompliantFetcher, which honors
//     robots.txt and rate-limits. A disallowed page returns a clear reason so
//     the operator falls back to paste.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { CompliantFetcher } from "@/lib/ingestion/fetcher";
import {
  parseListingsSmart,
  listingToDealRow,
  marketplaceForUrl,
  type DealListing,
} from "@/lib/ingestion/deal-listings";
import { recordSourceFeedback } from "@/lib/source-intelligence";

const HTML_CAP = 800_000; // guard the payload a paste can carry into a server action
const MAX_LISTINGS = 60;

export interface ParseDealListingsResult {
  ok: boolean;
  listings?: DealListing[];
  marketplace?: string;
  /** Why nothing came back, when !ok. */
  error?: string;
}

// A fetch reason → an operator-facing sentence.
const FETCH_REASON_COPY: Record<string, string> = {
  robots: "That site's robots.txt disallows crawling this page. Open the listing and paste its page contents here instead.",
  http_error: "The site returned an error for that URL. Paste the listing's page contents here instead.",
  not_html: "That URL did not return a web page. Paste the listing's page contents here instead.",
  too_large: "That page is too large to fetch. Paste the listing's page contents here instead.",
  timeout: "The site took too long to respond. Paste the listing's page contents here instead.",
  network: "Could not reach that URL. Check the link, or paste the page contents here instead.",
};

/**
 * Parse listings from pasted HTML/text or a URL. When a URL is given it is
 * fetched compliantly (robots-respecting); a blocked/failed fetch returns a
 * reason that steers the operator to paste. Nothing is written to the database.
 */
export async function parseDealListingsAction(input: {
  url?: string;
  html?: string;
}): Promise<ParseDealListingsResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };

  const rawUrl = (input.url ?? "").trim();
  const rawHtml = (input.html ?? "").trim();

  let url = rawUrl;
  let html = rawHtml;

  if (!html) {
    if (!/^https?:\/\/\S+$/i.test(rawUrl)) {
      return { ok: false, error: "Paste a listing page, or enter a valid listing URL." };
    }
    const res = await new CompliantFetcher().fetch(rawUrl);
    if (!res.ok) {
      return { ok: false, error: FETCH_REASON_COPY[res.reason ?? "network"] ?? "Could not fetch that URL." };
    }
    html = res.html;
    url = rawUrl;
  } else if (!/^https?:\/\/\S+$/i.test(url)) {
    // Pasted content with no URL: still parse, but we have no canonical link.
    url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : "https://pasted.local/listing";
  }

  if (html.length > HTML_CAP) html = html.slice(0, HTML_CAP);

  const def = marketplaceForUrl(url);
  let listings: DealListing[];
  try {
    listings = await parseListingsSmart({ url, html });
  } catch {
    return { ok: false, error: "Could not parse that page." };
  }

  if (listings.length === 0) {
    return { ok: false, error: "No for-sale listings found on that page.", marketplace: def.label };
  }
  return { ok: true, listings: listings.slice(0, MAX_LISTINGS), marketplace: def.label };
}

export interface AddDealListingsResult {
  ok: boolean;
  added?: number;
  error?: string;
}

/**
 * Insert the operator-selected listings into the `deals` pipeline. Rows land
 * with provenance 'web_ingest', the asking price in target_amount, and the full
 * economics packed into notes (the `deals` table has no per-financial columns).
 */
export async function addDealListingsAction(
  hub: string,
  module: string,
  listings: DealListing[],
  meta?: { sessionId?: string | null },
): Promise<AddDealListingsResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (`${hub}/${module}` !== "source/deal_pipeline") {
    return { ok: false, error: "Deal listing import is only available on the deal pipeline." };
  }

  const picks = (Array.isArray(listings) ? listings : []).filter((l) => l && typeof l.name === "string" && l.name.trim());
  if (picks.length === 0) return { ok: false, error: "Select at least one listing to add." };

  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();

  const rows = picks.slice(0, MAX_LISTINGS).map((l) => ({
    organization_id: orgId,
    session_id: meta?.sessionId ?? null,
    ...listingToDealRow(l),
  }));

  const { data: ins, error } = await supabase.from("deals").insert(rows).select("id");
  if (error) return { ok: false, error: error.message };
  const added = ins?.length ?? rows.length;

  // Learning signal: importing a listing is an 'accepted' sourcing decision.
  try {
    await recordSourceFeedback(
      supabase,
      picks.slice(0, added).map((l, i) => ({
        organizationId: orgId,
        principalId: auth.ctx.userId,
        module: "source/deal_pipeline",
        agent: "deal_sourcer" as const,
        signal: "accepted" as const,
        subjectName: l.name,
        category: l.category ?? null,
        rationale: `Imported from ${l.sourceLabel}`,
        recordId: ins?.[i]?.id ?? null,
      })),
    );
  } catch {
    // Best-effort — feedback never blocks the import.
  }

  revalidatePath(`/${hub}/${module}`);
  return { ok: true, added };
}
