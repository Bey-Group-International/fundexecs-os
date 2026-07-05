// Source adapters — thin, source-specific translations into ProfileInput.
// Business logic (normalize/dedupe/score) never lives in an adapter, so a new
// source (CRM, Microsoft Graph, official LinkedIn API) is only a new adapter.
//
// No adapter here scrapes anything: linkedin-url stores a user-provided URL as
// a reference and infers a display name from the slug the user pasted; CSV is
// the explicit fallback path wrapping the existing LinkedIn-export parser.

import type { ParsedContact } from "@/lib/network-import";
import { normalizeProfile } from "./normalize-profile";
import type { CapitalRole, NormalizedProfile, ProfileInput } from "./types";

export type AdapterResult = NormalizedProfile | { error: string };

/**
 * linkedin_url adapter — user pastes a profile URL, optionally with what they
 * know about the person. The URL is stored as a source reference only; fields
 * carry low confidence until confirmed or enriched through approved pathways.
 */
export function fromLinkedInUrl(input: {
  linkedinUrl: string;
  fullName?: string;
  title?: string;
  company?: string;
  capitalRole?: CapitalRole;
  tags?: string[];
  notes?: string;
}): AdapterResult {
  return normalizeProfile(
    {
      linkedinUrl: input.linkedinUrl,
      fullName: input.fullName,
      title: input.title,
      company: input.company,
      capitalRole: input.capitalRole,
      tags: input.tags,
      notes: input.notes,
    },
    "linkedin_url",
  );
}

/** manual adapter — the user typed the contact in directly. */
export function fromManualEntry(input: ProfileInput): AdapterResult {
  return normalizeProfile(input, "manual");
}

/**
 * contacts adapter — a Google People API connection (already parsed into a
 * ProfileInput by google-people.server) into the shared pipeline. No enrichment
 * or scraping: it carries only fields the People API returned for a connection
 * the user authorized.
 */
export function fromGoogleContacts(input: ProfileInput): AdapterResult {
  return normalizeProfile(input, "contacts");
}

/**
 * csv adapter (fallback path) — wraps a row from the existing CSV parsers
 * (lib/network-import) into the shared pipeline. Bulk CSV import continues to
 * run through importContacts for throughput; this adapter exists so per-row
 * review flows and future sources share one normalization contract.
 */
export function fromCsvRow(row: ParsedContact): AdapterResult {
  return normalizeProfile(
    {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      linkedinUrl: row.linkedinUrl ?? undefined,
      title: row.title ?? undefined,
      company: row.company ?? undefined,
      location: [row.city, row.state, row.country].filter(Boolean).join(", ") || undefined,
      connectedOn: row.connectedOn ?? undefined,
    },
    "linkedin_csv",
  );
}
