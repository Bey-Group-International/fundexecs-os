// lib/earn/browser-operator/audit-log.ts
//
// The append-only audit trail for a browser-operator session. Every meaningful
// step — scope created/approved, browser opened, auth paused/resumed,
// extraction, review, save, external-action requests, and terminal outcomes —
// writes one of these. `describeAuditEvent` is a pure human-readable renderer
// used by the session-status API and the UI timeline.

import type { BrowserDataSource, EarnBrowserAuditAction } from "./types";

export interface EarnBrowserAuditEvent {
  action: EarnBrowserAuditAction;
  /** The URL in view when the event happened, if any. */
  url?: string | null;
  /** The data source the event concerns, if any. */
  source_type?: BrowserDataSource | null;
  /** A short business-language note; falls back to the default description. */
  summary?: string | null;
  created_at?: string;
}

const ACTION_DESCRIPTIONS: Record<EarnBrowserAuditAction, string> = {
  scope_created: "Earn proposed a scope for your approval",
  scope_approved: "You approved the browser task scope",
  browser_opened: "Secure browser session opened",
  navigated: "Navigated to a permitted source",
  auth_paused: "Paused — waiting for you to sign in directly",
  user_auth_completed: "You confirmed sign-in; Earn resumed",
  extraction_started: "Started extracting data from the page",
  extraction_completed: "Finished extracting data",
  data_extracted: "Extracted data points from a permitted source",
  normalized: "Normalized extracted data for review",
  review_requested: "Sent extracted data to you for review",
  field_approved: "You approved a field for saving",
  field_rejected: "You rejected a field",
  save_approved: "You approved saving the reviewed data",
  saved: "Saved approved data into the system",
  external_action_requested: "Earn requested approval for an external action",
  external_action_approved: "You approved an external action",
  session_completed: "Session completed",
  session_cancelled: "You cancelled the session",
  session_failed: "Session failed",
};

/** Human-readable line for an audit event — prefers the custom summary. */
export function describeAuditEvent(event: EarnBrowserAuditEvent): string {
  const base = event.summary?.trim() || ACTION_DESCRIPTIONS[event.action];
  if (event.source_type) return `${base} (${event.source_type})`;
  return base;
}

/** The default description for an action, ignoring any custom summary. */
export function defaultAuditDescription(action: EarnBrowserAuditAction): string {
  return ACTION_DESCRIPTIONS[action];
}
