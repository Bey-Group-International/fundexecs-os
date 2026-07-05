// lib/earn/browser-operator/source-policy.ts
//
// Per-source rules of engagement. Each data source Earn can reach has its own
// allowed/prohibited behaviors and a plain-language policy note the UI shows the
// operator. This is where "don't scrape LinkedIn at scale", "never send or
// delete Gmail", and "EDGAR is a high-confidence public source" live.

import type { BrowserActionKind, BrowserDataSource } from "./types";

export interface SourcePolicy {
  source: BrowserDataSource;
  /** Actions Earn may take against this source (subject to scope + gates). */
  allowed_actions: BrowserActionKind[];
  /** Actions Earn must NEVER take against this source. */
  prohibited_actions: BrowserActionKind[];
  /** True when reaching this source needs the operator to sign in first. */
  requires_user_auth: boolean;
  /** True when the source is a public record needing no login. */
  public_source: boolean;
  /** Baseline reliability (0–100) for data pulled from this source. */
  base_confidence: number;
  /** Whether normalized records from this source default to private storage. */
  default_private: boolean;
  /** Plain-language note surfaced to the operator. */
  policy_note: string;
}

const READ_ONLY: BrowserActionKind[] = ["navigate", "read_page", "extract_data"];

const NEVER: BrowserActionKind[] = [
  "send_message",
  "submit_form",
  "change_account_settings",
  "delete_data",
  "grant_data_room_access",
  "make_purchase",
];

export const SOURCE_POLICIES: Record<BrowserDataSource, SourcePolicy> = {
  linkedin: {
    source: "linkedin",
    allowed_actions: [...READ_ONLY, "authenticate_handoff"],
    prohibited_actions: NEVER,
    requires_user_auth: true,
    public_source: false,
    base_confidence: 70,
    default_private: true,
    policy_note:
      "Only within a session the operator authorized by signing in directly. " +
      "No scraping at scale, no automated connection requests or messages, no " +
      "profile actions — read and extract only.",
  },
  edgar: {
    source: "edgar",
    allowed_actions: READ_ONLY,
    prohibited_actions: NEVER,
    requires_user_auth: false,
    public_source: true,
    base_confidence: 95,
    default_private: false,
    policy_note:
      "SEC EDGAR is an authoritative public filing source — high confidence, no " +
      "login required. Read filings and extract structured facts freely.",
  },
  company_website: {
    source: "company_website",
    allowed_actions: READ_ONLY,
    prohibited_actions: NEVER,
    requires_user_auth: false,
    public_source: true,
    base_confidence: 65,
    default_private: false,
    policy_note:
      "Public company pages (team, about, press). Read-only; do not submit " +
      "contact forms or trigger any interaction.",
  },
  gmail: {
    source: "gmail",
    allowed_actions: [...READ_ONLY, "authenticate_handoff"],
    prohibited_actions: NEVER,
    requires_user_auth: true,
    public_source: false,
    base_confidence: 80,
    default_private: true,
    policy_note:
      "Read only within the operator's authorized session. Never send, reply, " +
      "delete, archive, or re-label mail. Records default to private and full " +
      "message bodies are not stored — only the fields the operator approves.",
  },
  google_calendar: {
    source: "google_calendar",
    allowed_actions: [...READ_ONLY, "authenticate_handoff"],
    prohibited_actions: NEVER,
    requires_user_auth: true,
    public_source: false,
    base_confidence: 80,
    default_private: true,
    policy_note:
      "Read attendee and meeting metadata only. Never create, edit, delete, or " +
      "respond to events. Records default to private.",
  },
  google_contacts: {
    source: "google_contacts",
    allowed_actions: [...READ_ONLY, "authenticate_handoff"],
    prohibited_actions: NEVER,
    requires_user_auth: true,
    public_source: false,
    base_confidence: 75,
    default_private: true,
    policy_note:
      "Read contact fields only. Never add, edit, merge, or delete contacts. " +
      "Records default to private.",
  },
  public_web: {
    source: "public_web",
    allowed_actions: READ_ONLY,
    prohibited_actions: NEVER,
    requires_user_auth: false,
    public_source: true,
    base_confidence: 50,
    default_private: false,
    policy_note:
      "General public web. Lower baseline confidence — corroborate before " +
      "relying. Read-only; respect site terms and never submit forms.",
  },
  manual_user_input: {
    source: "manual_user_input",
    allowed_actions: [],
    prohibited_actions: NEVER,
    requires_user_auth: false,
    public_source: false,
    base_confidence: 100,
    default_private: true,
    policy_note:
      "Entered by the operator directly — treated as ground truth, no browsing " +
      "involved.",
  },
};

export function policyForSource(source: BrowserDataSource): SourcePolicy {
  return SOURCE_POLICIES[source];
}

/** True when a source policy forbids the given action. */
export function isActionProhibitedForSource(
  source: BrowserDataSource,
  action: BrowserActionKind,
): boolean {
  return SOURCE_POLICIES[source].prohibited_actions.includes(action);
}

/** Sources that need a login handoff before Earn can read them. */
export function authGatedSources(sources: BrowserDataSource[]): BrowserDataSource[] {
  return sources.filter((s) => SOURCE_POLICIES[s].requires_user_auth);
}
