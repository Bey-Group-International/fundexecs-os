// lib/earn/browser-operator/types.ts
//
// EPIC #2 — the Earn Controlled Browser-Operator layer.
//
// Earn can drive a browser on the operator's behalf (research a fund on
// LinkedIn, pull filings from EDGAR, read a company site), but doing so safely
// is the entire point of this module. The model here is permission-first and
// approval-gated:
//
//   1. Earn proposes a SCOPE CARD before touching a browser.
//   2. The operator approves the scope.
//   3. If a site needs a login, Earn PAUSES and hands the window to the
//      operator — it never sees or stores credentials.
//   4. Everything Earn extracts is reviewed field-by-field BEFORE anything is
//      saved into the system.
//   5. Any action that touches the outside world (sending, submitting,
//      purchasing, granting access) requires its own separate approval.
//
// This file is the pure type contract. No DB, no I/O — the same shapes are used
// by the state machine, the API layer, and the UI.

/**
 * The lifecycle of a single browser-operator session. The ordering here mirrors
 * the legal flow enforced by `session-machine.ts`; nothing may skip the review
 * gate on the way to `saved`.
 */
export type EarnBrowserSessionStatus =
  | "planned"
  | "awaiting_user_approval"
  | "opening_browser"
  | "navigating"
  | "paused_for_user_auth"
  | "user_auth_completed"
  | "extracting"
  | "normalizing"
  | "awaiting_user_review"
  | "approved_for_save"
  | "saved"
  | "rejected"
  | "cancelled"
  | "failed";

export const EARN_BROWSER_SESSION_STATUSES: EarnBrowserSessionStatus[] = [
  "planned",
  "awaiting_user_approval",
  "opening_browser",
  "navigating",
  "paused_for_user_auth",
  "user_auth_completed",
  "extracting",
  "normalizing",
  "awaiting_user_review",
  "approved_for_save",
  "saved",
  "rejected",
  "cancelled",
  "failed",
];

/** Terminal states — a session that reaches one of these never transitions again. */
export const TERMINAL_STATUSES: EarnBrowserSessionStatus[] = [
  "saved",
  "rejected",
  "cancelled",
  "failed",
];

export function isTerminalStatus(status: EarnBrowserSessionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Where the browser operator is allowed to gather data. Kept deliberately
 * narrow and explicit so a scope card can never authorize an open-ended crawl.
 */
export type BrowserDataSource =
  | "linkedin"
  | "edgar"
  | "company_website"
  | "gmail"
  | "google_calendar"
  | "google_contacts"
  | "public_web"
  | "manual_user_input";

export const BROWSER_DATA_SOURCES: BrowserDataSource[] = [
  "linkedin",
  "edgar",
  "company_website",
  "gmail",
  "google_calendar",
  "google_contacts",
  "public_web",
  "manual_user_input",
];

/**
 * The discrete things a browser operator might attempt. The prohibited ones are
 * NEVER permitted by a scope card — they are the structural line the operator
 * layer will not cross without a separate, explicit external-action approval.
 */
export type BrowserActionKind =
  // Read-only / internal work product (Tier 1 territory).
  | "navigate"
  | "read_page"
  | "extract_data"
  | "authenticate_handoff"
  | "save_to_system"
  // External-facing / mutating — always prohibited by default scope.
  | "send_message"
  | "submit_form"
  | "change_account_settings"
  | "delete_data"
  | "grant_data_room_access"
  | "make_purchase";

/**
 * Actions a default scope card ALWAYS prohibits. `buildScopeCard` guarantees
 * these are present regardless of the prompt.
 */
export const ALWAYS_PROHIBITED_ACTIONS: BrowserActionKind[] = [
  "send_message",
  "submit_form",
  "change_account_settings",
  "delete_data",
  "grant_data_room_access",
  "make_purchase",
];

/**
 * The approved envelope for a session: what Earn may touch, what it may do, and
 * the consent gates it must honor. `requires_user_review` is always true.
 */
export interface BrowserTaskScope {
  permitted_sources: BrowserDataSource[];
  permitted_actions: BrowserActionKind[];
  prohibited_actions: BrowserActionKind[];
  requires_user_review: boolean;
  requires_user_save_approval: boolean;
  requires_external_action_approval: boolean;
}

/**
 * A single piece of data Earn pulled from a source, carried with its provenance
 * so the operator can review it field-by-field before it is ever saved.
 */
export interface ExtractedDataPoint {
  field_name: string;
  extracted_value: string;
  source_type: BrowserDataSource;
  source_url?: string;
  captured_at: string;
  /** 0–100 reliability of this specific value. */
  confidence_score: number;
  /** The exact text on the page that backs this value, for auditability. */
  evidence_snippet?: string;
  /** True when this value must be explicitly confirmed by the operator. */
  requires_user_confirmation: boolean;
}

/**
 * The durable session record. Mirrors the `earn_browser_sessions` table row but
 * is the in-app domain shape (camel/snake kept snake to match the DB layer).
 */
export interface EarnBrowserSession {
  id: string;
  organization_id: string;
  user_id: string;
  task_id: string | null;
  status: EarnBrowserSessionStatus;
  requested_prompt: string;
  approved_scope: BrowserTaskScope | null;
  requires_user_auth: boolean;
  auth_handoff_completed: boolean;
  current_url: string | null;
  review_required: boolean;
  save_approved: boolean;
  external_action_approved: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * Every auditable thing that can happen inside a browser-operator session. The
 * audit log is append-only and is the record of record for what Earn did.
 */
export type EarnBrowserAuditAction =
  | "scope_created"
  | "scope_approved"
  | "browser_opened"
  | "navigated"
  | "auth_paused"
  | "user_auth_completed"
  | "extraction_started"
  | "extraction_completed"
  | "data_extracted"
  | "normalized"
  | "review_requested"
  | "field_approved"
  | "field_rejected"
  | "save_approved"
  | "saved"
  | "external_action_requested"
  | "external_action_approved"
  | "session_completed"
  | "session_cancelled"
  | "session_failed";
