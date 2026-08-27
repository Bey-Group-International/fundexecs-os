// lib/integrations/adapters/app-url.ts
// Base URL for absolute links the app mints itself: OAuth redirect URIs, the
// post-consent hop back to Settings, and the references native adapters hand
// back as DispatchResult.reference (meeting rooms, envelope wizards).
//
// Hostnames are allow-listed so a misconfigured env var can't mint links that
// point operators off-platform. Two rules keep a correct deploy from being
// demoted to localhost:
//
//   1. The apex domain counts. `fundexecs.com` is the canonical production
//      host, not just its subdomains — rejecting it sent every OAuth flow on
//      production to http://localhost:3000.
//   2. A rejected or absent candidate falls through to the NEXT candidate
//      (Vercel's own deployment URL) rather than straight to localhost.
//
// Anything request-scoped should prefer getAppUrlFromRequest: with no env var
// set at all, the host the operator is actually browsing beats a guess.

function normalize(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // VERCEL_URL and friends are bare hostnames, not URLs.
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const { hostname } = url;
  const allowed =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "fundexecs.com" ||
    hostname.endsWith(".fundexecs.com") ||
    hostname.endsWith(".vercel.app");
  if (!allowed) return null;
  return `${url.protocol}//${url.host}`;
}

const LOCAL_FALLBACK = "http://localhost:3000";

/**
 * The deploy's canonical base URL, from configuration alone.
 *
 * Order: the explicitly configured site URL, then Vercel's production domain,
 * then this deployment's own URL, then localhost for `next dev`.
 */
export function getAppUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ];
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (normalized) return normalized;
  }
  return LOCAL_FALLBACK;
}

/**
 * The base URL for a link minted while serving `req`.
 *
 * An explicitly configured NEXT_PUBLIC_APP_URL/NEXTAUTH_URL still wins — an
 * OAuth redirect_uri has to match what's registered with the provider, and
 * that registration follows the canonical host. Otherwise the request's own
 * origin (through the proxy's forwarded headers on Vercel) is used, so an
 * unconfigured deploy sends the operator back to the site they came from
 * instead of to localhost.
 */
export function getAppUrlFromRequest(req: Request): string {
  const configured = normalize(process.env.NEXT_PUBLIC_APP_URL) ?? normalize(process.env.NEXTAUTH_URL);
  if (configured) return configured;

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const scheme = proto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    const fromHost = normalize(`${scheme}://${host}`);
    if (fromHost) return fromHost;
  }

  return getAppUrl();
}
