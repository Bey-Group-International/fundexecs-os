// lib/earn/browser-operator/task-plan.ts
//
// Turns a natural-language request ("research the LP behind Cedar Ridge on
// LinkedIn and pull their latest EDGAR filing") into a SCOPE CARD: the explicit,
// operator-approvable envelope of what Earn may touch and do. The scope card is
// the thing the operator signs off on before any browser opens.
//
// Deriving scope from keywords is intentionally conservative: an unrecognized
// prompt falls back to public-web only, review is ALWAYS required, and the
// always-prohibited actions are ALWAYS attached.

import type {
  BrowserActionKind,
  BrowserDataSource,
  BrowserTaskScope,
} from "./types";
import { ALWAYS_PROHIBITED_ACTIONS } from "./types";

/** Keyword → data source. First match(es) win; order does not matter. */
const SOURCE_KEYWORDS: Array<{ source: BrowserDataSource; patterns: RegExp[] }> = [
  { source: "linkedin", patterns: [/linkedin/i, /\bprofile\b/i, /\bconnection/i] },
  { source: "edgar", patterns: [/edgar/i, /\bsec\b/i, /\bfiling/i, /10-?k/i, /13-?f/i, /form\s?d/i] },
  {
    source: "company_website",
    patterns: [/company\s?(web)?site/i, /\bwebsite\b/i, /\bhomepage\b/i, /\bteam page\b/i, /about\s?page/i],
  },
  { source: "gmail", patterns: [/\bgmail\b/i, /\bemail\b/i, /\binbox\b/i] },
  { source: "google_calendar", patterns: [/\bcalendar\b/i, /\bmeeting/i, /\bschedule\b/i] },
  { source: "google_contacts", patterns: [/\bcontacts?\b/i, /address book/i] },
];

/**
 * Build the scope card for a prompt. Permitted sources are derived from
 * keywords; if none match, we fall back to `public_web` only. Review is always
 * required, and the always-prohibited actions are always attached.
 */
export function buildScopeCard(prompt: string): BrowserTaskScope {
  const text = prompt ?? "";

  const matched = new Set<BrowserDataSource>();
  for (const { source, patterns } of SOURCE_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) matched.add(source);
  }

  // Nothing recognized → the most conservative default source.
  const permitted_sources: BrowserDataSource[] =
    matched.size > 0 ? [...matched] : ["public_web"];

  // Read-only work product is all a default scope ever authorizes. Saving into
  // the system is a separate, gated step (`save_to_system` is not auto-granted
  // — it flows through the review + save-approval gates).
  const permitted_actions: BrowserActionKind[] = [
    "navigate",
    "read_page",
    "extract_data",
  ];

  // If any permitted source requires the operator to be logged in, an auth
  // handoff will be needed; the operator authenticates directly.
  const authGatedSources: BrowserDataSource[] = [
    "linkedin",
    "gmail",
    "google_calendar",
    "google_contacts",
  ];
  if (permitted_sources.some((s) => authGatedSources.includes(s))) {
    permitted_actions.push("authenticate_handoff");
  }

  return {
    permitted_sources,
    permitted_actions,
    prohibited_actions: [...ALWAYS_PROHIBITED_ACTIONS],
    requires_user_review: true,
    requires_user_save_approval: true,
    requires_external_action_approval: true,
  };
}

/** True when the scope's sources imply an interactive login handoff will occur. */
export function scopeRequiresUserAuth(scope: BrowserTaskScope): boolean {
  return scope.permitted_actions.includes("authenticate_handoff");
}
