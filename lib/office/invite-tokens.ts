// lib/office/invite-tokens.ts
//
// Server-only mint + redeem for single-use Executive Floor invite tokens.
//
// Each floor / meeting invite email carries its own opaque token
// (`&invite=<token>`), backed by public.office_invite_tokens (migration
// 20260709120000_office_invite_tokens.sql). Redemption is server-enforced:
//   - the token must exist and not be expired,
//   - it is single-use (consuming it stamps used_at atomically),
//   - and, for a signed-in joiner, it is tied to the invited email.
//
// The table is service-role-only (RLS with no policies), so both mint and redeem
// go through createServiceClient. Everything is best-effort: with no service
// env, createInviteToken returns null (callers fall back to the shared link) and
// consumeInviteToken reports `unavailable` (callers let the join proceed as a
// plain shared link), so the office never hard-fails on a missing backend.
import { randomBytes } from "crypto";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

const TABLE = "office_invite_tokens";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type InviteTokenRow = {
  id: string;
  token: string;
  email: string;
  room: string | null;
  meet: boolean;
  deal: string | null;
  inviter_id: string | null;
  inviter_email: string | null;
  organization_id: string | null;
  expires_at: string;
  used_at: string | null;
  used_by_email: string | null;
  created_at: string;
};

// office_invite_tokens isn't in the generated Database types (regenerate once
// the migration is applied), so the strongly-typed from() overloads reject the
// name. A narrow loose facade keeps these service-role reads/writes compiling
// without weakening types elsewhere — same approach office-actions.ts uses.
type LooseErr = { message: string } | null;
type LooseFilter = {
  eq: (col: string, val: string) => LooseFilter;
  is: (col: string, val: null) => LooseFilter;
  select: (cols: string) => LooseFilter;
  maybeSingle: () => Promise<{ data: InviteTokenRow | null; error: LooseErr }>;
};
type LooseTable = {
  insert: (row: unknown) => Promise<{ error: LooseErr }>;
  update: (patch: unknown) => LooseFilter;
  select: (cols: string) => LooseFilter;
};
type LooseFrom = (table: string) => LooseTable;

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export type CreateInviteTokenInput = {
  /** The invitee's email — the token is bound to it. */
  email: string;
  room?: string | null;
  meet?: boolean;
  deal?: string | null;
  inviterId?: string | null;
  inviterEmail?: string | null;
  organizationId?: string | null;
  /** Lifetime in ms (default 7 days). */
  ttlMs?: number;
  /** Injectable clock for tests. */
  now?: number;
};

/**
 * Mint a single-use invite token for one recipient. Returns the token string,
 * or null when the service backend is unavailable / the insert fails — callers
 * then send the shared link (no `invite` param), preserving the old behavior.
 */
export async function createInviteToken(input: CreateInviteTokenInput): Promise<string | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const email = input.email.trim().toLowerCase();
  if (!email) return null;

  const token = generateInviteToken();
  const now = input.now ?? Date.now();
  const expiresAt = new Date(now + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString();

  try {
    const svc = createServiceClient();
    const from = svc.from.bind(svc) as unknown as LooseFrom;
    const { error } = await from(TABLE).insert({
      token,
      email,
      room: input.room ?? null,
      meet: input.meet ?? false,
      deal: input.deal ?? null,
      inviter_id: input.inviterId ?? null,
      inviter_email: input.inviterEmail ? input.inviterEmail.trim().toLowerCase() : null,
      organization_id: input.organizationId ?? null,
      expires_at: expiresAt,
    });
    if (error) return null;
    return token;
  } catch {
    return null;
  }
}

export type ConsumeInviteResult =
  | { ok: true; room: string | null; meet: boolean; deal: string | null; email: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "mismatch" | "unavailable" };

/**
 * Validate and consume an invite token on join. Single-use: the first successful
 * redemption stamps used_at; a later reopen succeeds only for the same invitee
 * (so a refresh doesn't lock them out) and is rejected for anyone else. When a
 * joiner email is supplied (a signed-in user), it must match the invited email.
 */
export async function consumeInviteToken(
  token: string,
  opts: { joinerEmail?: string | null; now?: number } = {},
): Promise<ConsumeInviteResult> {
  if (!hasSupabaseServiceEnv()) return { ok: false, reason: "unavailable" };
  const t = token.trim();
  if (!t) return { ok: false, reason: "invalid" };

  const now = opts.now ?? Date.now();
  const joiner = opts.joinerEmail?.trim().toLowerCase() || null;

  const ok = (r: InviteTokenRow): ConsumeInviteResult => ({
    ok: true,
    room: r.room,
    meet: r.meet,
    deal: r.deal,
    email: r.email,
  });

  try {
    const svc = createServiceClient();
    const from = svc.from.bind(svc) as unknown as LooseFrom;

    const { data: row } = await from(TABLE).select("*").eq("token", t).maybeSingle();
    if (!row) return { ok: false, reason: "invalid" };
    if (new Date(row.expires_at).getTime() < now) return { ok: false, reason: "expired" };

    // Already consumed — idempotent only for the same invitee (refresh / reopen).
    if (row.used_at) {
      if (row.used_by_email && row.used_by_email === (joiner ?? row.email)) return ok(row);
      return { ok: false, reason: "used" };
    }

    // Not yet used. A signed-in joiner must be the invited person.
    if (joiner && joiner !== row.email) return { ok: false, reason: "mismatch" };

    const usedBy = joiner ?? row.email;
    const { data: claimed } = await from(TABLE)
      .update({ used_at: new Date(now).toISOString(), used_by_email: usedBy })
      .eq("id", row.id)
      .is("used_at", null)
      .select("*")
      .maybeSingle();
    if (claimed) return ok(claimed);

    // Lost the single-use race — re-read and honor the same-invitee rule.
    const { data: after } = await from(TABLE).select("*").eq("token", t).maybeSingle();
    if (after?.used_by_email && after.used_by_email === usedBy) return ok(after);
    return { ok: false, reason: "used" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
