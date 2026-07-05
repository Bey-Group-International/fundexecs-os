// lib/integrations/professional-network/types.ts
// The Professional Network data-input layer — the contract every relationship
// data source flows through before touching the native Capital Relationship
// Graph (network_contacts + relationships).
//
// Strategic principle: FundExecs OS owns the intelligence layer. LinkedIn,
// Google Contacts, CRM exports, email metadata, and manual entries are all
// INPUTS that normalize into the same first-party model. Nothing here scrapes
// restricted platforms; every pathway is user-initiated and permission-first.
//
// Pipeline every record follows (see index.ts):
//   source adapter → permission check → normalize → dedupe → score →
//   network_contacts insert → relationship edge → copilot context

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Where a professional profile record came from. */
export type ProfessionalNetworkSource =
  | "linkedin_url"      // user-provided profile URL — reference only, no scraping
  | "linkedin_csv"      // LinkedIn data export uploaded by the user (fallback path)
  | "csv"               // generic CSV upload (fallback path)
  | "manual"            // typed in by the user
  | "contacts"          // Google Contacts / People API (backend connector)
  | "calendar"          // Google Calendar attendee metadata (backend connector)
  | "crm"               // CRM import (future connector)
  | "public_web"        // compliant public-web enrichment (future)
  | "linkedin_api";     // official LinkedIn API (future, credentials-gated)

/** The capital-market role a contact plays. Drives Capital Network filters. */
export type CapitalRole =
  | "fund_manager"
  | "limited_partner"
  | "independent_sponsor"
  | "capital_provider"
  | "family_office"
  | "operator"
  | "founder"
  | "broker"
  | "lender"
  | "advisor"
  | "strategic_partner"
  | "service_provider"
  | "unknown";

export const CAPITAL_ROLES: CapitalRole[] = [
  "fund_manager", "limited_partner", "independent_sponsor", "capital_provider",
  "family_office", "operator", "founder", "broker", "lender", "advisor",
  "strategic_partner", "service_provider", "unknown",
];

/** Permission state of a contact record / connected source. */
export type DataPermissionStatus =
  | "not_connected"
  | "pending_user_approval"
  | "connected"
  | "sync_paused"
  | "disconnected"
  | "revoked";

/** Raw input accepted by adapters, before normalization. */
export type ProfileInput = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  title?: string;
  company?: string;
  location?: string;
  capitalRole?: CapitalRole;
  tags?: string[];
  notes?: string;
  /** LinkedIn "Connected On" or equivalent first-contact date (ISO). */
  connectedOn?: string;
};

/** A normalized profile, ready for dedupe + scoring + insert. */
export type NormalizedProfile = {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  capital_role: CapitalRole;
  tags: string[];
  notes: string | null;
  connected_on: string | null;
  source: ProfessionalNetworkSource;
  /** 0–100 data-reliability score derived from the source + field coverage. */
  confidence: number;
};

/** A dedupe match against an existing contact, with the reason it matched. */
export type DedupeMatch = {
  contactId: string;
  fullName: string;
  company: string | null;
  matchedOn: "email" | "linkedin_url" | "name_company" | "name";
  /** 0–100 — how certain the match is. ≥90 should block silent insert. */
  matchConfidence: number;
};

/** Minimal shape of an existing contact needed for dedupe comparison. */
export type ExistingContactRef = {
  id: string;
  full_name: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  linkedin_url: string | null;
  company: string | null;
};

// ─── Backend connector contract ──────────────────────────────────────────────
// Backend sources (Google Contacts, official LinkedIn API, CRM, Microsoft
// Graph) implement this. Connect/sync run server-side, tenant-scoped, and
// permission-first; a connector with no credentials reports "unavailable"
// with user-facing guidance instead of failing. CSV stays a fallback path
// that bypasses connect/sync and goes straight to the adapter pipeline.

export type ConnectorAvailability =
  | { available: true }
  | { available: false; reason: string };

export type ConnectorSyncResult = {
  ok: boolean;
  recordsSeen: number;
  recordsImported: number;
  /** Records skipped because they matched an existing contact (dedupe). */
  recordsDeduped?: number;
  error?: string;
};

// The server-side context a live connector needs to write records: the caller's
// RLS-scoped Supabase client and the acting user id. Passed by runProviderSync
// (sync.server), which already holds both. Optional on the interface so a
// still-pending connector (no live pull yet) can ignore it.
export type ConnectorSyncContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export interface ProfessionalNetworkConnector {
  provider: ProfessionalNetworkSource;
  label: string;
  /**
   * The org-secret (org_secrets.provider) key whose presence marks this
   * connector as truly "connected". Undefined for connectors that store no
   * token (e.g. still-pending LinkedIn). Read by /status.
   */
  secretKey?: string;
  /** Whether this connector can run today (credentials/API access present). */
  availability(): ConnectorAvailability;
  /**
   * Begin a user-authorized connection (OAuth or equivalent). Returns the URL
   * to send the user to, or null when the provider needs no interactive step.
   */
  connectUrl(orgId: string): string | null;
  /** Pull permitted records into the normalize pipeline. Server-side only. */
  sync(orgId: string, ctx?: ConnectorSyncContext): Promise<ConnectorSyncResult>;
}
