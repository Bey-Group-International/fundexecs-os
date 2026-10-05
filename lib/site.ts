// Single source of truth for site-level branding and metadata. Imported by
// the root layout, manifest, robots, sitemap, and the dynamic OG image so the
// name, description, and canonical URL never drift apart.
import { AGENTS } from "./agents";

export const SITE_NAME = "FundExecs OS";

export const SITE_TAGLINE = "Agents that own the work";

export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

// Live agent count, derived from the catalog (lib/agents.ts) so the marketing
// copy can never disagree with the real roster — add or remove an agent and the
// number below (and everywhere SITE_DESCRIPTION is used) updates automatically.
export const AGENT_COUNT = AGENTS.length;

// Spell a small integer as a capitalized word ("Fifteen"), falling back to the
// numeral outside the covered range. Keeps the copy reading naturally.
function spellCountCapitalized(n: number): string {
  const ones = [
    "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
    "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty"];
  if (n < 0) return String(n);
  if (n < 20) return ones[n];
  if (n < 60) {
    const t = tens[Math.floor(n / 10)];
    const o = n % 10;
    return o ? `${t}-${ones[o].toLowerCase()}` : t;
  }
  return String(n);
}

export const AGENT_COUNT_WORD = spellCountCapitalized(AGENT_COUNT);

export const SITE_DESCRIPTION =
  `The AI-native operating system for private capital. ${AGENT_COUNT_WORD} agents source capital, underwrite deals, manage LPs, and own the work across every hub — on a schedule, approval-gated by default.`;

// Canonical production URL. Overridable per-environment via NEXT_PUBLIC_APP_URL
// (e.g. Vercel preview deployments, localhost). The fallback is the real
// production domain — never the placeholder ".os" TLD, which is invalid.
export const PRODUCTION_SITE_URL = "https://fundexecs.com";

/**
 * Reduce a configured site URL to an absolute `scheme://host[:port]` origin.
 *
 * Every link the app emails — meeting invites, booking confirmations,
 * reminders, the .ics "Save to calendar" button — is `SITE_URL` plus a path,
 * and every email template refuses to render an href that does not start with
 * http(s). So a value configured as a bare host (`fundexecs.com`, the shape
 * Vercel's own URL variables take) or with stray whitespace used to produce
 * links like `fundexecs.com/meeting-invite/abc`: dropped by the templates, so
 * invitees got an invitation with a dead "Join meeting" button and a calendar
 * entry with no URL. Normalising here fixes every path at once.
 *
 * Only the origin is kept: a configured path (`https://x.test/app`) would be
 * prepended to every route the app already serves at the root.
 */
export function normalizeSiteUrl(raw: string | null | undefined, fallback: string = PRODUCTION_SITE_URL): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return fallback;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // Only the origin survives, which also drops any trailing slash.
    const url = new URL(withScheme);
    if (!url.hostname) return fallback;
    return `${url.protocol}//${url.host}`;
  } catch {
    return fallback;
  }
}

export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_APP_URL);

// Brand colors as fully-resolved hex, mirroring the `:root` tokens in
// app/globals.css. Used anywhere Tailwind classes can't reach — the web app
// manifest, the runtime-rendered icon, and the OG image. Each field names the
// token it mirrors so the two can be diffed by eye; if a token moves, move the
// hex with it.
export const BRAND = {
  /** --fx-surface-0 · rgb(240 245 252) — the page itself. */
  background: "#F0F5FC",
  /** --fx-gold-rgb · rgb(217 119 6) — the canonical amber fill. */
  gold: "#D97706",
  /** --fx-gold-500 · rgb(245 158 11) — the brightest amber step. */
  goldLight: "#F59E0B",
  /** --fx-fg-primary · rgb(9 20 38) — near-black body ink. */
  fg: "#091426",
  /** --fx-fg-muted · rgb(88 108 138) — the quietest readable label. */
  fgMuted: "#586C8A",
} as const;

// The single UI theme color, consumed by BOTH the root layout's viewport and
// the web app manifest. They have to agree: the manifest's value paints the
// installed app's launch splash and its Android title bar, so any drift from
// the page's real background shows up as a colored flash on every cold launch
// of the installed app before the first paint lands.
export const THEME_COLOR = BRAND.background;

// Absolute URL to the brand logo used by JSON-LD (ImageObject). Points at the
// 512×512 Earn coin mark shipped in /public.
export const SITE_LOGO = `${SITE_URL}/icon-512.png`;
export const SITE_LOGO_SIZE = 512;

// Support / contact address surfaced in structured data and ai.txt.
export const SITE_CONTACT_EMAIL = "support@fundexecs.com";

// Verified brand profiles. Emitted as schema.org `sameAs`. Intentionally empty
// until we have confirmed URLs — the JSON-LD builder drops the field entirely
// when this is empty rather than inventing profiles. Add entries like
// "https://www.linkedin.com/company/fundexecs" as they are verified.
export const SITE_SOCIALS: readonly string[] = [];

// The single source of truth for what crawlers must NOT index: the API surface
// and the entire authenticated app (every page under app/(app)/, plus /admin
// and /onboarding). Consumed by robots.ts and the ai.txt builder so the two can
// never drift. Public routes (/, /login, /marketing, token share links under
// /s /d /pay /portal /sign /lp, meeting links) are deliberately absent and stay
// crawlable. Entries are path prefixes: "/deal" also covers "/deals", "/session"
// covers "/sessions". None of these prefixes match a public route.
export const CRAWLER_DISALLOW: readonly string[] = [
  "/api/",
  "/admin",
  // Carries a single-use decision token in the query string — never index it.
  "/access-decision",
  "/onboarding",
  "/settings",
  "/workspace",
  "/home",
  "/dashboard",
  "/earn",
  "/inbox",
  "/activity",
  "/agenda",
  "/approvals",
  "/asset",
  "/automations",
  "/build",
  "/source",
  "/run",
  "/execute",
  "/campaigns",
  "/capital-map",
  "/deal",
  "/design-system",
  "/document",
  "/envelopes",
  "/finance",
  "/gift",
  "/invite",
  "/graph",
  "/grid",
  "/investor",
  "/lp-report",
  "/marketplace",
  "/meetings",
  "/network",
  "/portfolio",
  "/prospecting",
  "/pulse",
  "/relationship",
  "/reports",
  "/search",
  "/session",
  "/signals",
  "/wallet",
];
