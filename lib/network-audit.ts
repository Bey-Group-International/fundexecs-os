// lib/network-audit.ts
//
// The relationship access trail.
//
// An institution running its capital network through this system has to be able
// to answer "who saw this LP's record, who changed the owner, who exported the
// book" — usually to a compliance officer, sometimes to a regulator, and always
// after the fact. network_audit_log is append-only at the RLS level (no update
// or delete policy exists) and readable only by org admins, so a member cannot
// quietly edit their own trail.
//
// Writing to it must never break the action being audited. A failed audit write
// is logged to the server and swallowed: refusing to show a contact because its
// view could not be recorded would be a worse outcome than a gap in the trail,
// and the gap is visible in the log either way.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "view"
  | "create"
  | "update"
  | "delete"
  | "archive"
  | "export"
  | "merge"
  | "assign"
  | "stage_change"
  | "bulk_update"
  | "search";

export interface AuditEntry {
  orgId: string;
  actorId: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string | null;
  /** The label AT THE TIME of the act, so the trail still reads correctly after
   *  the row is renamed, merged away, or deleted. */
  entityLabel?: string | null;
  metadata?: Record<string, unknown>;
}

/** Keys whose values must never reach the audit log. The trail records that
 *  something happened and to whom — it is not a second copy of the record, and
 *  a log an admin can read should not become a way to read private notes or
 *  contact details that the reader's own RLS would deny them. */
const REDACTED_KEYS = new Set([
  "email",
  "phone",
  "notes",
  "body",
  "note",
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
]);

const MAX_STRING = 500;
const MAX_KEYS = 40;

/**
 * Shrink and redact a metadata payload before it is written.
 *
 * Nested objects are walked so a redacted key is caught wherever it sits;
 * arrays keep their first 20 entries. Anything unserialisable becomes a string.
 */
export function sanitizeAuditMetadata(input: unknown, depth = 0): unknown {
  if (input === null || input === undefined) return null;
  if (depth > 4) return "[deep]";

  if (typeof input === "string") {
    return input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…` : input;
  }
  if (typeof input === "number" || typeof input === "boolean") return input;

  if (Array.isArray(input)) {
    return input.slice(0, 20).map((v) => sanitizeAuditMetadata(v, depth + 1));
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (n >= MAX_KEYS) break;
      n += 1;
      out[key] = REDACTED_KEYS.has(key.toLowerCase())
        ? "[redacted]"
        : sanitizeAuditMetadata(value, depth + 1);
    }
    return out;
  }

  return String(input);
}

/**
 * Record one audited act. Never throws.
 *
 * `client` must be the request-scoped Supabase client: the insert policy checks
 * `actor_id = auth.uid()`, which is what stops one member from writing trail
 * entries in another's name.
 */
export async function recordNetworkAudit(
  client: SupabaseClient,
  entry: AuditEntry,
): Promise<void> {
  try {
    const { error } = await client.from("network_audit_log").insert({
      organization_id: entry.orgId,
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType ?? "network_contact",
      entity_id: entry.entityId ?? null,
      entity_label: entry.entityLabel ?? null,
      metadata: sanitizeAuditMetadata(entry.metadata ?? {}),
    });
    if (error) throw error;
  } catch (err) {
    console.warn("[network-audit] failed to record", entry.action, err);
  }
}

/**
 * Record several acts in one round trip — the bulk and merge paths write one
 * entry per affected record, and doing that serially would cost more than the
 * operation being audited.
 */
export async function recordNetworkAuditBatch(
  client: SupabaseClient,
  entries: AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const { error } = await client.from("network_audit_log").insert(
      entries.slice(0, 500).map((entry) => ({
        organization_id: entry.orgId,
        actor_id: entry.actorId,
        action: entry.action,
        entity_type: entry.entityType ?? "network_contact",
        entity_id: entry.entityId ?? null,
        entity_label: entry.entityLabel ?? null,
        metadata: sanitizeAuditMetadata(entry.metadata ?? {}),
      })),
    );
    if (error) throw error;
  } catch (err) {
    console.warn("[network-audit] failed to record batch", entries.length, err);
  }
}
