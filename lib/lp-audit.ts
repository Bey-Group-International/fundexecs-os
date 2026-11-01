// lib/lp-audit.ts
// The audit events the app records itself, beyond the ones database triggers
// write (a check recorded, a decision, a consent, a review-state change). Pure,
// so what may be written is tested without a database.
//
// Ids, statuses and short codes only, never free text: an audit log that holds
// what someone typed becomes a second copy of the data it is meant to account for.

/** Who an entry is about. A signed-in person has an id; the LP and the system do not. */
export type ActorKind = "user" | "lp" | "system";

export const AUDIT_ACTIONS = [
  /** A fund manager made a link. */
  "link.created",
  /** The LP asked for an emailed code and got one. */
  "code.requested",
  /** A fund manager generated a code to give the LP another way. */
  "code.issued_by_manager",
  /** The LP typed a wrong code. */
  "code.wrong",
  /** The LP's code was accepted. */
  "code.verified",
  /** An email the app sent on the LP's or the fund manager's behalf, and whether it went. */
  "email.sent",
  /** The OFAC screen ran, whether or not it changed anything. */
  "check.screen_run",
  /** A fund manager asked for the ID verification result to be refreshed. */
  "check.refreshed",
  /** An earlier ID check was found for a returning LP and put to a fund manager to confirm. */
  "carryover.proposed",
  /** A fund manager confirmed it is the same person; the earlier check now counts. */
  "carryover.confirmed",
  /** A fund manager declined it; the LP verifies again. */
  "carryover.declined",
  /** An LP at elevated or high risk was approved: the tier and how many reasons, never the reasons. */
  "risk.assessed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditDetail = Record<string, string | number | boolean>;

const MAX_KEYS = 12;
/** A code or an id, not a sentence: letters, digits and . _ : - only. */
const SAFE_STRING = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_KEY = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Keeps only what is safe to store: short identifier-like strings, finite numbers
 * and booleans, under well-formed keys. Anything else is dropped, never altered.
 */
export function cleanDetail(raw: unknown): AuditDetail {
  const out: AuditDetail = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (!SAFE_KEY.test(key)) continue;
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && SAFE_STRING.test(value)) out[key] = value;
  }
  return out;
}

export type AuditEvent = {
  orgId: string;
  sessionId: string;
  action: AuditAction;
  detail?: Record<string, unknown>;
} & ({ actorKind: "user"; actorId: string } | { actorKind: "lp" | "system"; actorId?: undefined });

/** The row to insert, or null if the event is not one the app may write. */
export function auditRow(e: AuditEvent) {
  if (!(AUDIT_ACTIONS as readonly string[]).includes(e.action)) return null;
  if (!e.orgId || !e.sessionId) return null;
  if (e.actorKind === "user" && !e.actorId) return null;
  return {
    organization_id: e.orgId,
    session_id: e.sessionId,
    actor_id: e.actorKind === "user" ? e.actorId : null,
    actor_kind: e.actorKind,
    action: e.action,
    detail: cleanDetail(e.detail),
  };
}
