// Single source of truth for site-level branding and metadata. Imported by
// the root layout, manifest, robots, sitemap, and the dynamic OG image so the
// name, description, and canonical URL never drift apart.

export const SITE_NAME = "FundExecs OS";

export const SITE_TAGLINE = "Agents that own the work";

export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

export const SITE_DESCRIPTION =
  "The AI-native operating system for private capital. Six agents source deals, underwrite, manage LPs, and own the work — on a schedule, approval-gated by default.";

// Canonical production URL. Overridable per-environment via NEXT_PUBLIC_APP_URL
// (e.g. Vercel preview deployments, localhost). The fallback is the real
// production domain — never the placeholder ".os" TLD, which is invalid.
export const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://fundexecs.com";

// Brand colors, kept in sync with tailwind.config.ts / globals.css. Used by the
// runtime-rendered icon and OG image, which can't read Tailwind classes.
export const BRAND = {
  background: "#0B0A08",
  gold: "#D4AF6A",
  goldLight: "#E4CD93",
  fg: "#F5F1E8",
  fgMuted: "#7E7869",
} as const;
