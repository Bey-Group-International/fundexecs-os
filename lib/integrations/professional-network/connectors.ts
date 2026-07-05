// Backend connector registry for the Professional Network integration.
//
// These are the credential-gated, server-side sync sources (prompt: "backend
// connector → permission check → sync job → normalize → dedupe → score →
// relationship graph"). Each connector reports availability honestly: with no
// credentials configured it stays listed but unavailable, with user-facing
// guidance — never a broken button, never an unofficial workaround.
//
// TODO(oauth): when provider credentials are configured, implement connectUrl
// (authorization redirect) and sync (server-side pull → adapter pipeline),
// storing tokens in the org secret vault (lib/org-secrets.ts) and recording
// runs in network_import_jobs.

import { GOOGLE_PEOPLE_REFRESH_TOKEN_KEY, googleOAuthConfigured } from "@/lib/google-oauth";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { syncGooglePeople } from "./google-people.server";
import type { ConnectorAvailability, ProfessionalNetworkConnector } from "./types";

function notYet(reason: string): ConnectorAvailability {
  return { available: false, reason };
}

/** Google Contacts / People API — the first-priority backend source. */
export const googleContactsConnector: ProfessionalNetworkConnector = {
  provider: "contacts",
  label: "Google Contacts",
  // Presence of this vaulted refresh token is what /status reads as "connected".
  secretKey: GOOGLE_PEOPLE_REFRESH_TOKEN_KEY,
  availability() {
    // Live once the Google OAuth client is configured — the same signal Gmail
    // uses. No separate env var: the People flow reuses one Google client and
    // simply requests the contacts.readonly scope.
    return googleOAuthConfigured()
      ? { available: true }
      : notYet("Google Contacts sync is pending OAuth configuration. Use manual entry, a LinkedIn profile URL, or the CSV fallback today.");
  },
  connectUrl() {
    // Dedicated People consent flow (distinct scope + vault key) so connecting
    // Contacts never disturbs the Gmail grant. The start route mints the signed
    // state and redirects to Google.
    return `${getAppUrl()}/api/oauth/google/people/start`;
  },
  async sync(orgId, ctx) {
    if (!ctx) {
      // A live sync needs the caller's RLS client + user to write records.
      return { ok: false, recordsSeen: 0, recordsImported: 0, error: "Google Contacts sync requires a server sync context." };
    }
    return syncGooglePeople(orgId, ctx);
  },
};

/** Official LinkedIn API — compliant adapter, credentials-gated. */
export const linkedinApiConnector: ProfessionalNetworkConnector = {
  provider: "linkedin_api",
  label: "LinkedIn (official API)",
  availability() {
    // SEAM(linkedin-api): flips available only with approved official API /
    // partner API credentials. There is no scraping fallback by design.
    return process.env.LINKEDIN_API_CLIENT_ID
      ? { available: true }
      : notYet("LinkedIn connection pending official API access. Use a LinkedIn profile URL, manual entry, or the CSV export fallback to build your Capital Network today.");
  },
  connectUrl() {
    return null; // TODO(oauth): LinkedIn OAuth URL once API access is approved
  },
  async sync() {
    return { ok: false, recordsSeen: 0, recordsImported: 0, error: "LinkedIn official API access not configured." };
  },
};

export const PROFESSIONAL_NETWORK_CONNECTORS: ProfessionalNetworkConnector[] = [
  googleContactsConnector,
  linkedinApiConnector,
];
