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
import { composioConfigured } from "@/lib/integrations/composio/client.server";
import { syncGmailContacts } from "@/lib/integrations/composio/gmail.server";
import { syncLinkedInSelf } from "@/lib/integrations/composio/linkedin.server";
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

/**
 * Gmail correspondents (via Composio) — metadata-only relationship signal.
 * Reads sender identity of recent mail; never message bodies, never outreach.
 */
export const gmailComposioConnector: ProfessionalNetworkConnector = {
  provider: "email",
  label: "Gmail (via Composio)",
  availability() {
    return composioConfigured()
      ? { available: true }
      : notYet("Gmail relationship signal is pending Composio configuration. Use Google Contacts, a LinkedIn profile URL, manual entry, or the CSV fallback today.");
  },
  connectUrl() {
    // Connections are authorized in Composio, not via an app-owned OAuth route.
    return null;
  },
  async sync(orgId, ctx) {
    if (!ctx) {
      return { ok: false, recordsSeen: 0, recordsImported: 0, error: "Gmail sync requires a server sync context." };
    }
    return syncGmailContacts(orgId, ctx);
  },
};

/**
 * Official LinkedIn API — compliant adapter, now wired through Composio.
 * Available when Composio is configured (or legacy partner creds are present).
 * Imports the authenticated member's own verified profile only: LinkedIn's
 * official API offers no connection-list export and no URL-to-data lookup, so
 * there is no bulk import and — by design — no scraping fallback.
 */
export const linkedinApiConnector: ProfessionalNetworkConnector = {
  provider: "linkedin_api",
  label: "LinkedIn (official API)",
  availability() {
    return composioConfigured() || process.env.LINKEDIN_API_CLIENT_ID
      ? { available: true }
      : notYet("LinkedIn connection pending official API access. Use a LinkedIn profile URL, manual entry, or the CSV export fallback to build your Capital Network today.");
  },
  connectUrl() {
    // Connections are authorized in Composio, not via an app-owned OAuth route.
    return null;
  },
  async sync(orgId, ctx) {
    if (!ctx) {
      return { ok: false, recordsSeen: 0, recordsImported: 0, error: "LinkedIn sync requires a server sync context." };
    }
    return syncLinkedInSelf(orgId, ctx);
  },
};

export const PROFESSIONAL_NETWORK_CONNECTORS: ProfessionalNetworkConnector[] = [
  googleContactsConnector,
  gmailComposioConnector,
  linkedinApiConnector,
];
