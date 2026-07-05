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

import type { ConnectorAvailability, ProfessionalNetworkConnector } from "./types";

function notYet(reason: string): ConnectorAvailability {
  return { available: false, reason };
}

/** Google Contacts / People API — the first-priority backend source. */
export const googleContactsConnector: ProfessionalNetworkConnector = {
  provider: "contacts",
  label: "Google Contacts",
  availability() {
    // SEAM(google-people): flips available when OAuth client credentials are
    // configured for the People API scope.
    return process.env.GOOGLE_PEOPLE_CLIENT_ID
      ? { available: true }
      : notYet("Google Contacts sync is pending OAuth configuration. Use manual entry, a LinkedIn profile URL, or the CSV fallback today.");
  },
  connectUrl() {
    return null; // TODO(oauth): People API consent URL
  },
  async sync() {
    return { ok: false, recordsSeen: 0, recordsImported: 0, error: "Google Contacts sync not yet configured." };
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
