// Resolve a "book a meeting" scheduling link for the marketplace CTA.
//
// Order of precedence:
//   1. The org's connected Calendly account — retrieved live from the Calendly
//      API using the org's vaulted CALENDLY_API_TOKEN (same credential the
//      dispatch adapter uses). We return the first active event type's
//      scheduling URL, falling back to the account's root scheduling URL.
//   2. A deploy-wide Calendly token (CALENDLY_API_TOKEN / CALENDLY_ACCESS_TOKEN).
//   3. A static NEXT_PUBLIC_BOOKING_URL.
//
// Retrieved URLs are cached in-process with a short TTL so rendering the
// marketplace doesn't hit the Calendly API on every request, and `cache()`
// dedupes calls within a single render.
import { cache } from "react";
import { resolveChannelCredentials } from "@/lib/integrations/credentials";

const CALENDLY_TIMEOUT_MS = 5_000;
const TTL_MS = 10 * 60_000; // 10 minutes

type CacheEntry = { url: string | null; at: number };
// Keyed by org id (or "__deploy__" when resolving from env only). Module-level,
// so it's per server instance — a warm instance skips the API round-trip.
const memo = new Map<string, CacheEntry>();

async function fetchCalendlySchedulingUrl(token: string): Promise<string | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const meRes = await fetch("https://api.calendly.com/users/me", {
    headers,
    signal: AbortSignal.timeout(CALENDLY_TIMEOUT_MS),
  });
  if (!meRes.ok) return null;
  const me = (await meRes.json()) as {
    resource: { uri: string; scheduling_url: string };
  };

  // Prefer a concrete event type link (e.g. a 15-minute intro) over the root.
  try {
    const etRes = await fetch(
      `https://api.calendly.com/event_types?user=${encodeURIComponent(me.resource.uri)}&active=true&count=1`,
      { headers, signal: AbortSignal.timeout(CALENDLY_TIMEOUT_MS) },
    );
    if (etRes.ok) {
      const etData = (await etRes.json()) as {
        collection: { scheduling_url: string }[];
      };
      const first = etData.collection?.[0]?.scheduling_url;
      if (first) return first;
    }
  } catch {
    // Fall through to the account's root scheduling URL.
  }
  return me.resource.scheduling_url ?? null;
}

async function resolve(orgId?: string | null): Promise<string | null> {
  const key = orgId ?? "__deploy__";
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.url;

  // 1. Org's vaulted Calendly token, else 2. deploy-wide env token.
  let token: string | undefined;
  if (orgId) {
    try {
      const creds = await resolveChannelCredentials(orgId, "calendly");
      token = creds.CALENDLY_API_TOKEN;
    } catch {
      // Vault miss/decrypt failure — fall back to env below.
    }
  }
  token = token ?? process.env.CALENDLY_API_TOKEN ?? process.env.CALENDLY_ACCESS_TOKEN;

  let url: string | null = null;
  if (token) {
    try {
      url = await fetchCalendlySchedulingUrl(token);
    } catch {
      url = null;
    }
  }

  // 3. Static fallback.
  url = url ?? process.env.NEXT_PUBLIC_BOOKING_URL ?? null;

  memo.set(key, { url, at: now });
  return url;
}

/** Per-request-deduped resolver for the marketplace booking CTA. */
export const resolveBookingUrl = cache(resolve);
