// lib/earn/browser-operator/server.ts
//
// Server-only helpers that bind the pure browser-operator model to Supabase.
// Kept separate from the pure module (types/machine/policies) so the latter
// stays dependency-free and unit-testable. The API routes use these.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EarnBrowserSession } from "@/lib/supabase/database.types";
import type {
  EarnBrowserAuditAction,
  EarnBrowserSessionStatus,
  BrowserDataSource,
} from "./types";
import { nextOnEvent, type SessionEvent } from "./session-machine";

type Client = SupabaseClient<Database>;

export interface AuditInput {
  action: EarnBrowserAuditAction;
  url?: string | null;
  sourceType?: BrowserDataSource | null;
  summary?: string | null;
}

/** Append one audit row for a session. Best-effort — never throws. */
export async function writeAudit(
  supabase: Client,
  args: {
    orgId: string;
    sessionId: string;
    userId: string;
    input: AuditInput;
  },
): Promise<void> {
  try {
    await supabase.from("earn_browser_audit_logs").insert({
      organization_id: args.orgId,
      session_id: args.sessionId,
      user_id: args.userId,
      action: args.input.action,
      url: args.input.url ?? null,
      source_type: args.input.sourceType ?? null,
      summary: args.input.summary ?? null,
    });
  } catch {
    // Audit is best-effort; a logging failure must not break the action.
  }
}

/** Load a single session scoped to the caller's org (RLS also enforces this). */
export async function loadSession(
  supabase: Client,
  id: string,
  orgId: string,
): Promise<EarnBrowserSession | null> {
  const { data } = await supabase
    .from("earn_browser_sessions")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as EarnBrowserSession | null) ?? null;
}

export type TransitionResult =
  | { ok: true; session: EarnBrowserSession }
  | { ok: false; reason: "illegal_transition"; from: EarnBrowserSessionStatus }
  | { ok: false; reason: "db_error"; error: string };

/**
 * Move a session through the state machine. Rejects illegal transitions BEFORE
 * touching the DB (the caller maps this to a 409). Extra column updates are
 * merged into the same write.
 */
export async function transitionSession(
  supabase: Client,
  session: EarnBrowserSession,
  event: SessionEvent,
  patch: Partial<EarnBrowserSession> = {},
): Promise<TransitionResult> {
  const from = session.status as EarnBrowserSessionStatus;
  const next = nextOnEvent(from, event);
  if (!next) {
    return { ok: false, reason: "illegal_transition", from };
  }

  const terminal =
    next === "saved" || next === "rejected" || next === "cancelled" || next === "failed";

  const { data, error } = await supabase
    .from("earn_browser_sessions")
    .update({
      status: next,
      ...(terminal ? { completed_at: new Date().toISOString() } : {}),
      ...patch,
    })
    .eq("id", session.id)
    .eq("organization_id", session.organization_id)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, reason: "db_error", error: error?.message ?? "Update failed" };
  }
  return { ok: true, session: data as EarnBrowserSession };
}
